import { TICKERS } from './data_list/tickers.js';
import { DERIVATIVES_CONFIG, SMOOTHING_OPTIONS } from './data_list/derivatives.js';
import { computeDerivatives, computeReturnsProfile } from './math.js';

// --- TIMEFRAME AGGREGATION ---
function getWeekStart(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().split('T')[0];
}

function getMonthStart(dateStr) {
    return dateStr.substring(0, 7) + '-01';
}

function aggregateOHLC(data, getGroupKey) {
    if (data.length === 0) return [];
    const groups = {};
    const keys = [];
    
    data.forEach(candle => {
        const key = getGroupKey(candle.time);
        if (!groups[key]) {
            groups[key] = {
                time: candle.time, // retain first day of group as time
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                value: candle.close
            };
            keys.push(key);
        } else {
            groups[key].high = Math.max(groups[key].high, candle.high);
            groups[key].low = Math.min(groups[key].low, candle.low);
            groups[key].close = candle.close;
            groups[key].value = candle.close;
        }
    });
    
    return keys.map(k => groups[k]);
}

// --- FETCH REAL DATA ---
async function fetchRealData(ticker, timeframe, lookbacks = {}, state = null) {
    try {
        const response = await fetch(`/api/data?ticker=${ticker}`);
        if (!response.ok) throw new Error('Network response was not ok');
        const text = await response.text();
        
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',');
        const dailyData = [];

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i]) continue;
            const cols = lines[i].split(',');
            const timeStr = cols[0];
            const open = parseFloat(cols[1]);
            const high = parseFloat(cols[2]);
            const low = parseFloat(cols[3]);
            // Use Adj Close (cols[5]) for all internal math and plotting
            const close = parseFloat(cols[5]) || parseFloat(cols[4]);
            
            dailyData.push({
                time: timeStr,
                open: open,
                high: high,
                low: low,
                close: close,
                value: close // for line chart fallback
            });
        }

        let aggregatedData = dailyData;
        if (timeframe === 'weekly') {
            aggregatedData = aggregateOHLC(dailyData, getWeekStart);
        } else if (timeframe === 'monthly') {
            aggregatedData = aggregateOHLC(dailyData, getMonthStart);
        }

        const derivData = computeDerivatives(aggregatedData, state, ticker);
        
        return { data: aggregatedData, derivData };
    } catch (error) {
        console.error('Error fetching data:', error);
        return { data: [], derivData: {} };
    }
}

// --- STATE MANAGER ---
const STATE_KEY = 'ohlcv_ui_state';
window.APP_CONFIG = {
    DEFAULT_WORKSPACE_NAME: 'Untitled'
};
window.ACTIVE_WORKSPACE = sessionStorage.getItem('active_workspace') || 'autosave';

function loadState() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (raw) {
        const state = JSON.parse(raw);
        state.lookbacks = state.lookbacks || {};
        state.markers = state.markers || {};
        state.timeframes = state.timeframes || {};
        state.sources = state.sources || {};
        
        // MIGRATION: Convert old state.derivatives to state.panels
        if (state.derivatives && !state.panels) {
            state.panels = state.derivatives.map(dId => {
                return { instanceId: dId + '_' + Math.floor(Math.random() * 1000000), derivId: dId };
            });
            
            // Map old lookbacks/sources/markers keyed by derivId to new instanceId
            if (state.stocks) {
                state.stocks.forEach(stock => {
                    if (state.lookbacks[stock]) {
                        const newLookbacks = {};
                        state.panels.forEach(p => {
                            if (state.lookbacks[stock][p.derivId]) {
                                newLookbacks[p.instanceId] = state.lookbacks[stock][p.derivId];
                            }
                        });
                        state.lookbacks[stock] = newLookbacks;
                    }
                    if (state.sources[stock]) {
                        const newSources = {};
                        state.panels.forEach(p => {
                            if (state.sources[stock][p.derivId]) {
                                newSources[p.instanceId] = state.sources[stock][p.derivId];
                            }
                        });
                        state.sources[stock] = newSources;
                    }
                    if (state.markers[stock]) {
                        state.markers[stock].forEach(m => {
                            const panel = state.panels.find(p => p.derivId === m.derivId);
                            if (panel) m.instanceId = panel.instanceId;
                        });
                    }
                });
            }
            delete state.derivatives;
        }
        
        state.panels = state.panels || [];
        
        // Convert old string timeframe to object if necessary
        if (typeof state.timeframe === 'string') {
            const tf = state.timeframe;
            state.timeframes = {};
            state.stocks.forEach(s => state.timeframes[s] = tf);
            delete state.timeframe;
        }
        return state;
    }
    
    const defaultInstanceId = 'roc_' + Math.floor(Math.random() * 1000000);
    return {
        timeframes: { 'TCS': 'weekly' },
        stocks: ['TCS'], // Default selected
        panels: [{ instanceId: defaultInstanceId, derivId: 'roc' }],
        lookbacks: { 'TCS': { [defaultInstanceId]: [54] } },
        plots: { 'TCS': 'line' },
        overlays: { 'TCS': { 'price': [{ type: 'linreg', period: 54 }] } },
        markers: {}
    };
}

function saveState(state) {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    // Sync to server disk silently
    fetch(`/api/workspaces?name=${window.ACTIVE_WORKSPACE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
    }).catch(err => console.error('Failed to sync workspace to disk:', err));
}

function applyStateToUI(state) {
    const tfRadio = document.querySelector(`input[name="timeframe"][value="${state.timeframe}"]`);
    if (tfRadio) tfRadio.checked = true;

    document.querySelectorAll('input[name="stock"]').forEach(cb => {
        cb.checked = state.stocks.includes(cb.value);
    });
}

function gatherStateFromUI() {
    const currentState = loadState();
    const stocks = Array.from(document.querySelectorAll('input[name="stock"]:checked')).map(cb => cb.value);
    
    return { 
        timeframes: currentState.timeframes || {}, 
        stocks, 
        panels: currentState.panels || [], 
        lookbacks: currentState.lookbacks || {}, 
        plots: currentState.plots || {},
        overlays: currentState.overlays || {},
        markers: currentState.markers || {},
        sources: currentState.sources || {}
    };
}

// --- RENDER ENGINE ---
let globalChartObserver = null;

async function renderCharts(state) {
    const mainContainer = document.getElementById('main-chart-container');
    mainContainer.innerHTML = '';
    
    if (globalChartObserver) {
        globalChartObserver.disconnect();
    }

    if (state.stocks.length === 0) {
        mainContainer.innerHTML = '<p style="padding: 20px;">No stocks selected. Please select a ticker and click Apply.</p>';
        return;
    }

    
    // Generate HTML for each selected stock
    let html = '';
    state.stocks.forEach(stockSymbol => {
        const stockName = TICKERS.find(t => t.symbol === stockSymbol)?.name || stockSymbol;
        
        const tf = (state.timeframes && state.timeframes[stockSymbol]) || 'weekly';
        
        html += `
        <ul class="stock-card">
            <details open>
                <summary class="stock-header">
                    <span class="stock-title">${stockName}</span>
                    <button class="btn-icon danger" title="Close Stock" onclick="window.removeStock(this, '${stockSymbol}')">✕</button>
                </summary>
                
                <li class="chart-panel price-panel">
                    <header class="panel-header">
                        <div class="title-and-legend">
                            <span class="panel-title">Price Action</span>
                            
                            <div class="inspector-group">
                                <label class="inspector-label">Timeframe:</label>
                                <select class="inspector-input timeframe-input" data-stock="${stockSymbol}">
                                    <option value="daily" ${tf === 'daily' ? 'selected' : ''}>Daily</option>
                                    <option value="weekly" ${tf === 'weekly' ? 'selected' : ''}>Weekly</option>
                                    <option value="monthly" ${tf === 'monthly' ? 'selected' : ''}>Monthly</option>
                                </select>
                            </div>
                            
                            <div class="inspector-group">
                                <label class="inspector-label">Plot:</label>
                                <select id="select-plot-${stockSymbol}" class="inspector-input plot-input" data-stock="${stockSymbol}">
                                    <option value="candle" ${(!state.plots || state.plots[stockSymbol] !== 'line') ? 'selected' : ''}>Candlestick</option>
                                    <option value="line" ${(state.plots && state.plots[stockSymbol] === 'line') ? 'selected' : ''}>Line Chart</option>
                                </select>
                            </div>
                            
                            <div class="inspector-group">
                                <details class="overlay-dropdown" style="position: relative;">
                                    <summary class="inspector-input" style="cursor: pointer; user-select: none; border-radius: 4px; padding: 2px 6px;">Overlays ▼</summary>
                                    <div class="dropdown-menu" style="padding: 12px; width: 220px; z-index: 200;">
                                        ${['sma', 'wma', 'linreg'].map(type => {
                                            const colors = { sma: '#fbc02d', wma: '#ff5252', linreg: '#448aff' };
                                            const names = { sma: 'SMA', wma: 'WMA', linreg: 'LinReg' };
                                            const existing = (state.overlays && state.overlays[stockSymbol] && state.overlays[stockSymbol]['price']) 
                                                ? state.overlays[stockSymbol]['price'].find(o => o.type === type) 
                                                : null;
                                            
                                            const isChecked = existing ? 'checked' : '';
                                            const val = existing ? existing.period : '';
                                            const isDisabled = existing ? '' : 'disabled';
                                            const opacity = existing ? '1' : '0.5';
                                            
                                            return `
                                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                                <label style="display:flex; align-items:center;"><input type="checkbox" class="overlay-checkbox" value="${type}" onchange="window.toggleOverlayInput(this)" ${isChecked}> <span style="margin-left:4px;">${names[type]}</span></label>
                                                <div style="display:flex; align-items:center; opacity:${opacity}; transition: opacity 0.2s;" class="overlay-period-container">
                                                    <input type="color" class="overlay-color-picker" value="${existing && existing.color ? existing.color : colors[type]}" style="width:20px; height:20px; padding:0; border:none; margin-right:4px;" oninput="window.updateOverlayFromDropdown(this)" onchange="window.updateOverlayFromDropdown(this)" ${isDisabled}>
                                                    <input type="text" class="inspector-input overlay-period-input" data-stock="${stockSymbol}" data-panel="price" data-type="${type}" value="${val}" placeholder="20, 50" style="width: 80px;" onchange="window.updateOverlayFromDropdown(this)" ${isDisabled}>
                                                </div>
                                            </div>`;
                                        }).join('')}
                                    </div>
                                </details>
                            </div>
                            
                            <div class="inspector-group">
                                <details class="overlay-dropdown" style="position: relative; margin-left: 8px;">
                                    <summary class="inspector-input" style="cursor: pointer; user-select: none; border-radius: 4px; padding: 2px 6px;">Markers ▼</summary>
                                    <div class="dropdown-menu" style="padding: 12px; width: 280px; z-index: 200;">
                                        <div style="font-size:10px; margin-bottom:8px; color:var(--text-muted); font-weight:bold;">ADD MARKER TO PRICE CHART</div>
                                        <div style="margin-bottom: 8px;">
                                            <select class="inspector-input" style="width: 100%;" onchange="window.applyMarkerTemplate(this, '${stockSymbol}', 'price')">
                                                <option value="">-- Quick Templates --</option>
                                                <option value='{"op":">","val":0,"shape":"arrowDown","overrideDerivId":"pivot_high", "overrideLookback": "5:2:0"}'>Pivot Point High (5:2)</option>
                                                <option value='{"op":">","val":0,"shape":"arrowUp","overrideDerivId":"pivot_low", "overrideLookback": "5:2:0"}'>Pivot Point Low (5:2)</option>
                                            </select>
                                        </div>
                                        <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                                            <select class="inspector-input marker-operator" id="marker-op-${stockSymbol}-price" style="width: 45px;"><option value=">">&gt;</option><option value="<">&lt;</option></select>
                                            <input type="text" class="inspector-input marker-threshold" id="marker-val-${stockSymbol}-price" placeholder="Price" style="width: 60px;">
                                            <select class="inspector-input marker-shape" id="marker-shape-${stockSymbol}-price" style="width: 80px;">
                                                <option value="arrowUp">Up Arrow</option>
                                                <option value="arrowDown">Down Arrow</option>
                                            </select>
                                            <button onclick="window.addMarkerRule('${stockSymbol}', 'price')" class="btn" style="padding: 2px 8px;">Add</button>
                                            <button onclick="window.clearMarkers('${stockSymbol}', 'price')" class="btn danger" style="padding: 2px 8px; margin-left: 4px;">Clear</button>
                                        </div>
                                        <div style="font-size:10px; margin-top:12px; margin-bottom:8px; color:var(--text-muted); font-weight:bold;">CUSTOM PIVOT MARKER</div>
                                        <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                                            <select class="inspector-input" id="pivot-type-${stockSymbol}" style="width: 60px;">
                                                <option value="pivot_high">High</option>
                                                <option value="pivot_low">Low</option>
                                            </select>
                                            <input type="text" class="inspector-input" id="pivot-lb-${stockSymbol}" placeholder="5:2:0" style="width: 65px;" value="5:2:0">
                                            <button onclick="window.addPivotMarker('${stockSymbol}')" class="btn" style="padding: 2px 8px;">Add Pivot</button>
                                        </div>
                                        <div id="markers-list-${stockSymbol}-price" style="font-size:11px;"></div>
                                    </div>
                                </details>
                            </div>
                            
                            <span class="chart-legend" id="legend-${stockSymbol}-price"></span>
                        </div>
                        <div class="panel-controls" style="position: relative;">
                            <button class="btn-icon" title="Colors" onclick="window.toggleColorMenu(this, '${stockSymbol}', 'price')">🎨</button>
                            <button class="btn-icon" title="Minimize" onclick="this.closest('li').classList.toggle('minimized')">_</button>
                            <button class="btn-icon" title="Maximize" onclick="this.closest('li').classList.toggle('maximized')">□</button>
                            <button class="btn-icon danger" title="Close" onclick="window.removePanel(this)">✕</button>
                        </div>
                    </header>
                    <section id="chart-${stockSymbol}-price" class="chart-canvas price-chart"></section>
                </li>`;

        if (state.panels) {
            state.panels.forEach(panel => {
                const d = DERIVATIVES_CONFIG.find(c => c.id === panel.derivId);
                if (!d) return;
                const instanceId = panel.instanceId;
            if (d.id === 'returns_profile') {
                html += `
                <li class="chart-panel deriv-panel">
                    <header class="panel-header">
                        <div class="title-and-legend">
                            <span class="panel-title">Returns Profile</span>
                            <div class="inspector-group">
                                <label class="inspector-label">Periods (Days):</label>
                                <input type="text" id="returns-period-${stockSymbol}" class="inspector-input lookback" value="21" onchange="window.updateReturnsProfile('${stockSymbol}')" style="width: 60px;">
                            </div>
                        </div>
                        <div class="panel-controls">
                            <button class="btn-icon" title="Toggle Documentation" onclick="window.toggleDocs(this, '${stockSymbol}', '${instanceId}')">ℹ️</button>
                            <button class="btn-icon" title="Minimize" onclick="this.closest('li').classList.toggle('minimized')">_</button>
                            <button class="btn-icon" title="Maximize" onclick="this.closest('li').classList.toggle('maximized')">□</button>
                            <button class="btn-icon danger" title="Close" onclick="window.removePanel(this)">✕</button>
                        </div>
                    </header>
                    <section id="chart-${stockSymbol}-${instanceId}" class="chart-canvas" style="padding: 20px; background: var(--bg-surface); height: auto; min-height: 240px; position: relative;">
                        <div id="returns-content-${stockSymbol}">Loading profile...</div>
                    </section>
                    <section id="docs-${stockSymbol}-${instanceId}" class="docs-canvas" style="display:none; padding: 20px; background: var(--bg-surface); height: 100%; overflow-y: auto;">
                        <h3 style="margin-top: 0;">${d.name}</h3>
                        <p><strong>What is it?</strong><br>${d.what_is_it}</p>
                        <p><strong>Calculation:</strong><br>${d.calculation}</p>
                        <p><strong>Interpretation:</strong><br>${d.interpretation}</p>
                        <p><strong>Usage:</strong><br>${d.usage}</p>
                    </section>
                </li>`;
                return;
            }

            html += `
                <li class="chart-panel deriv-panel">
                    <header class="panel-header">
                        <div class="title-and-legend">
                            <span class="panel-title">${d.name}</span>
                            ${(() => {
                                let valStr = (state.lookbacks[stockSymbol] && state.lookbacks[stockSymbol][instanceId]) ? state.lookbacks[stockSymbol][instanceId].join(', ') : (d.config.lookback_options ? d.config.lookback_options.join(', ') : d.config.default_lookback);
                                
                                if (d.id.startsWith('pivots')) {
                                    let back = valStr;
                                    let ahead = valStr;
                                    let thresh = '0';
                                    if (typeof valStr === 'string' && valStr.includes(':')) {
                                        const parts = valStr.split(':');
                                        back = parts[0] || '5';
                                        ahead = parts[1] || back;
                                        thresh = parts[2] || '0';
                                    }
                                    return `
                                    <div class="inspector-group" style="display:flex; align-items:center;">
                                        <label class="inspector-label" style="margin-right:4px;">L-Back:</label>
                                        <input type="text" class="inspector-input lookback pivot-input-back" data-deriv="${instanceId}" data-stock="${stockSymbol}" value="${back}" style="width: 35px;" onchange="window.updatePivotLookback(this)">
                                        <label class="inspector-label" style="margin-left:8px; margin-right:4px;">L-Ahead:</label>
                                        <input type="text" class="inspector-input lookback pivot-input-ahead" data-deriv="${instanceId}" data-stock="${stockSymbol}" value="${ahead}" style="width: 35px;" onchange="window.updatePivotLookback(this)">
                                        <label class="inspector-label" style="margin-left:8px; margin-right:4px;">Thresh%:</label>
                                        <input type="text" class="inspector-input lookback pivot-input-thresh" data-deriv="${instanceId}" data-stock="${stockSymbol}" value="${thresh}" style="width: 35px;" onchange="window.updatePivotLookback(this)">
                                    </div>`;
                                } else {
                                    let htmlStr = '';
                                    if (d.config.allow_custom_source) {
                                        const currentSource = (state.sources && state.sources[stockSymbol] && state.sources[stockSymbol][instanceId]) ? state.sources[stockSymbol][instanceId].type : 'close';
                                        const currentSourceParam = (state.sources && state.sources[stockSymbol] && state.sources[stockSymbol][instanceId]) ? state.sources[stockSymbol][instanceId].param : '20';
                                        htmlStr += `
                                        <div class="inspector-group" style="margin-right: 12px; display: flex; align-items: center;">
                                            <label class="inspector-label">Src:</label>
                                            <select class="inspector-input source-select" data-deriv="${instanceId}" data-stock="${stockSymbol}" onchange="window.updateSource(this)">
                                                <option value="close" ${currentSource==='close'?'selected':''}>Close</option>
                                                <option value="high" ${currentSource==='high'?'selected':''}>High</option>
                                                <option value="low" ${currentSource==='low'?'selected':''}>Low</option>
                                                <option value="open" ${currentSource==='open'?'selected':''}>Open</option>
                                                <option value="linreg" ${currentSource==='linreg'?'selected':''}>LinReg</option>
                                            </select>
                                            <input type="text" class="inspector-input source-param" data-deriv="${instanceId}" data-stock="${stockSymbol}" value="${currentSourceParam}" style="width: 35px; margin-left: 4px; display: ${currentSource==='linreg' ? 'inline-block' : 'none'};" onchange="window.updateSource(this)">
                                        </div>`;
                                    }
                                    
                                    htmlStr += `
                                    <div class="inspector-group">
                                        <label class="inspector-label">Lookback:</label>
                                        <input type="text" class="inspector-input lookback lookback-input" data-deriv="${instanceId}" data-stock="${stockSymbol}" value="${valStr}" placeholder="e.g. 20, 60">
                                    </div>`;
                                    return htmlStr;
                                }
                            })()}
                            
                            <div class="inspector-group" style="margin-right: 12px; display: flex; align-items: center;">
                                ${(() => {
                                    const currentNorm = (state.normalizations && state.normalizations[stockSymbol] && state.normalizations[stockSymbol][instanceId]) ? state.normalizations[stockSymbol][instanceId].type : 'none';
                                    const currentNormPeriod = (state.normalizations && state.normalizations[stockSymbol] && state.normalizations[stockSymbol][instanceId]) ? state.normalizations[stockSymbol][instanceId].period : '100';
                                    return `
                                        <label class="inspector-label">Norm:</label>
                                        <select class="inspector-input norm-select" data-deriv="${instanceId}" data-stock="${stockSymbol}" onchange="window.updateNormalization(this)">
                                            <option value="none" ${currentNorm==='none'?'selected':''}>None</option>
                                            <option value="zscore" ${currentNorm==='zscore'?'selected':''}>Z-Score</option>
                                            <option value="minmax" ${currentNorm==='minmax'?'selected':''}>Min-Max</option>
                                            <option value="percentile" ${currentNorm==='percentile'?'selected':''}>Percentile Rank</option>
                                        </select>
                                        <input type="text" class="inspector-input norm-period" data-deriv="${instanceId}" data-stock="${stockSymbol}" value="${currentNormPeriod}" style="width: 35px; margin-left: 4px; display: ${currentNorm!=='none' ? 'inline-block' : 'none'};" onchange="window.updateNormalization(this)" placeholder="LBack">
                                    `;
                                })()}
                            </div>
                            
                            <div class="inspector-group">
                                <details class="overlay-dropdown" style="position: relative;">
                                    <summary class="inspector-input" style="cursor: pointer; user-select: none; border-radius: 4px; padding: 2px 6px;">Overlays ▼</summary>
                                    <div class="dropdown-menu" style="padding: 12px; width: 220px; z-index: 200;">
                                        ${['sma', 'wma', 'linreg'].map(type => {
                                            const colors = { sma: '#fbc02d', wma: '#ff5252', linreg: '#448aff' };
                                            const names = { sma: 'SMA', wma: 'WMA', linreg: 'LinReg' };
                                            const existing = (state.overlays && state.overlays[stockSymbol] && state.overlays[stockSymbol][instanceId]) 
                                                ? state.overlays[stockSymbol][instanceId].find(o => o.type === type) 
                                                : null;
                                            
                                            const isChecked = existing ? 'checked' : '';
                                            const val = existing ? existing.period : '';
                                            const isDisabled = existing ? '' : 'disabled';
                                            const opacity = existing ? '1' : '0.5';
                                            
                                            return `
                                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                                <label style="display:flex; align-items:center;"><input type="checkbox" class="overlay-checkbox" value="${type}" onchange="window.toggleOverlayInput(this)" ${isChecked}> <span style="margin-left:4px;">${names[type]}</span></label>
                                                <div style="display:flex; align-items:center; opacity:${opacity}; transition: opacity 0.2s;" class="overlay-period-container">
                                                    <input type="color" class="overlay-color-picker" value="${existing && existing.color ? existing.color : colors[type]}" style="width:20px; height:20px; padding:0; border:none; margin-right:4px;" oninput="window.updateOverlayFromDropdown(this)" onchange="window.updateOverlayFromDropdown(this)" ${isDisabled}>
                                                    <input type="text" class="inspector-input overlay-period-input" data-stock="${stockSymbol}" data-panel="${instanceId}" data-type="${type}" value="${val}" placeholder="20, 50" style="width: 80px;" onchange="window.updateOverlayFromDropdown(this)" ${isDisabled}>
                                                </div>
                                            </div>`;
                                        }).join('')}
                                    </div>
                                </details>
                            </div>
                            
                            <div class="inspector-group">
                                <details class="overlay-dropdown" style="position: relative; margin-left: 8px;">
                                    <summary class="inspector-input" style="cursor: pointer; user-select: none; border-radius: 4px; padding: 2px 6px;">Markers ▼</summary>
                                    <div class="dropdown-menu" style="padding: 12px; width: 280px; z-index: 200;">
                                        <div style="font-size:10px; margin-bottom:8px; color:var(--text-muted); font-weight:bold;">ADD MARKER TO PRICE CHART</div>
                                        <div style="margin-bottom: 8px;">
                                            <select class="inspector-input" style="width: 100%;" onchange="window.applyMarkerTemplate(this, '${stockSymbol}', '${instanceId}')">
                                                <option value="">-- Quick Templates --</option>
                                                <option value='{"op":">","val":0,"shape":"arrowDown","overrideDerivId":"pivot_high", "overrideLookback": "5:2:0"}'>Pivot Point High (5:2)</option>
                                                <option value='{"op":">","val":0,"shape":"arrowUp","overrideDerivId":"pivot_low", "overrideLookback": "5:2:0"}'>Pivot Point Low (5:2)</option>
                                            </select>
                                        </div>
                                        <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                                            <select class="inspector-input marker-operator" id="marker-op-${stockSymbol}-${instanceId}" style="width: 45px;"><option value=">">&gt;</option><option value="<">&lt;</option></select>
                                            <input type="text" class="inspector-input marker-threshold" id="marker-val-${stockSymbol}-${instanceId}" placeholder="Value" style="width: 60px;">
                                            <select class="inspector-input marker-shape" id="marker-shape-${stockSymbol}-${instanceId}" style="width: 80px;">
                                                <option value="arrowUp">Up Arrow</option>
                                                <option value="arrowDown">Down Arrow</option>
                                            </select>
                                            <button onclick="window.addMarkerRule('${stockSymbol}', '${instanceId}')" class="btn" style="padding: 2px 8px;">Add</button>
                                            <button onclick="window.clearMarkers('${stockSymbol}', '${instanceId}')" class="btn danger" style="padding: 2px 8px; margin-left: 4px;">Clear</button>
                                        </div>
                                        <div style="font-size:10px; margin-top:12px; margin-bottom:8px; color:var(--text-muted); font-weight:bold;">CUSTOM PIVOT MARKER</div>
                                        <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                                            <select class="inspector-input" id="pivot-type-${stockSymbol}-${instanceId}" style="width: 60px;">
                                                <option value="pivot_high">High</option>
                                                <option value="pivot_low">Low</option>
                                            </select>
                                            <input type="text" class="inspector-input" id="pivot-lb-${stockSymbol}-${instanceId}" placeholder="5:2:0" style="width: 65px;" value="5:2:0">
                                            <button onclick="window.addPivotMarker('${stockSymbol}', '${instanceId}')" class="btn" style="padding: 2px 8px;">Add Pivot</button>
                                        </div>
                                        <div id="markers-list-${stockSymbol}-${instanceId}" style="font-size:11px;"></div>
                                    </div>
                                </details>
                            </div>
                            <span class="chart-legend" id="legend-${stockSymbol}-${instanceId}"></span>
                        </div>
                        <div class="panel-controls" style="position: relative;">
                            <button class="btn-icon" title="Colors" onclick="window.toggleColorMenu(this, '${stockSymbol}', '${instanceId}')">🎨</button>
                            <button class="btn-icon" title="Toggle Documentation" onclick="window.toggleDocs(this, '${stockSymbol}', '${instanceId}')">ℹ️</button>
                            <button class="btn-icon" title="Minimize" onclick="this.closest('li').classList.toggle('minimized')">_</button>
                            <button class="btn-icon" title="Maximize" onclick="this.closest('li').classList.toggle('maximized')">□</button>
                            <button class="btn-icon danger" title="Close" onclick="window.removePanel(this)">✕</button>
                        </div>
                    </header>
                    <section id="chart-${stockSymbol}-${instanceId}" class="chart-canvas deriv-chart"></section>
                    <section id="docs-${stockSymbol}-${instanceId}" class="docs-canvas" style="display:none; padding: 20px; background: var(--bg-surface); height: 100%; overflow-y: auto;">
                        <h3 style="margin-top: 0;">${d.name}</h3>
                        <p><strong>What is it?</strong><br>${d.what_is_it}</p>
                        <p><strong>Calculation:</strong><br>${d.calculation}</p>
                        <p><strong>Interpretation:</strong><br>${d.interpretation}</p>
                        <p><strong>Usage:</strong><br>${d.usage}</p>
                    </section>
                </li>`;
            });
        }

        html += `
            </details>
        </ul>`;
    });

    mainContainer.innerHTML = html;

    // Load Returns Profile Data for all stocks
    state.stocks.forEach(stockSymbol => {
        if (window.updateReturnsProfile) {
            window.updateReturnsProfile(stockSymbol);
        }
    });

    // Instantiate Charts
    if (typeof LightweightCharts === 'undefined') return;

    globalChartObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
            if(entry.target._chartInstance) {
                entry.target._chartInstance.resize(entry.contentRect.width, entry.contentRect.height);
            }
        });
    });

    const commonChartConfig = {
        layout: { background: { color: '#ffffff' }, textColor: '#111111' },
        grid: { vertLines: { color: '#e5e5e5' }, horzLines: { color: '#e5e5e5' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        timeScale: { borderColor: '#b0b0b0' },
        rightPriceScale: { visible: false },
        leftPriceScale: { visible: true, borderColor: '#b0b0b0', minimumWidth: 60 }
    };

    // We instantiate independently for each stock grouping
    window.APP_DATA = window.APP_DATA || {};
    window.ACTIVE_RANGES = window.ACTIVE_RANGES || {};
    for (const stockSymbol of state.stocks) {
        const stockLookbacks = state.lookbacks[stockSymbol] || {};
        const tf = (state.timeframes && state.timeframes[stockSymbol]) || 'weekly';
        const dataset = await fetchRealData(stockSymbol, tf, stockLookbacks, state);
        window.APP_DATA[stockSymbol] = dataset.data;
        
        if (dataset.data.length === 0) {
            console.warn(`No data for ${stockSymbol}`);
            continue;
        }

        const stockCharts = []; // Sync charts only within the same stock

        // Price Chart
        const priceContainer = document.getElementById(`chart-${stockSymbol}-price`);
        const priceLegend = document.getElementById(`legend-${stockSymbol}-price`);
        const priceChart = LightweightCharts.createChart(priceContainer, {
            width: priceContainer.clientWidth, height: priceContainer.clientHeight, ...commonChartConfig
        });
        priceContainer._chartInstance = priceChart;
        priceContainer._mainData = dataset.data;
        globalChartObserver.observe(priceContainer);

        const plotType = (state.plots && state.plots[stockSymbol]) || 'candle';
        let currentPriceSeries;
        
        if (plotType === 'candle') {
            currentPriceSeries = priceChart.addSeries(LightweightCharts.CandlestickSeries, {
                upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350', priceScaleId: 'left'
            });
            currentPriceSeries.setData(dataset.data);
        } else {
            currentPriceSeries = priceChart.addSeries(LightweightCharts.LineSeries, { color: '#2962ff', lineWidth: 2, priceScaleId: 'left' });
            const lineData = dataset.data.map(d => ({ time: d.time, value: d.close }));
            currentPriceSeries.setData(lineData);
        }
        
        priceContainer._mainSeries = currentPriceSeries;
        stockCharts.push({ chart: priceChart, series: currentPriceSeries, isPrice: true, container: priceContainer, legend: priceLegend, panelId: 'price' });

        // Deriv Charts
        if (state.panels) {
            state.panels.forEach(panel => {
                const d = DERIVATIVES_CONFIG.find(c => c.id === panel.derivId);
                if (!d) return;
                const instanceId = panel.instanceId;
                
                if (d.id === 'returns_profile') return; // Handled separately
                
                const container = document.getElementById(`chart-${stockSymbol}-${instanceId}`);
                if (!container) return; // Might be returns profile which has a different container setup
                
                const legend = document.getElementById(`legend-${stockSymbol}-${instanceId}`);
                const chart = LightweightCharts.createChart(container, {
                    width: container.clientWidth, height: container.clientHeight, ...commonChartConfig
                });
                container._chartInstance = chart;
                const derivDataSets = dataset.derivData[instanceId] || [];
                container._mainData = derivDataSets[0]?.data || [];
                globalChartObserver.observe(container);
                const COLORS = ['#2962ff', '#ff6d00', '#00c853', '#d50000', '#aa00ff'];
                const seriesGroup = [];
                
                derivDataSets.forEach((ds, idx) => {
                    const color = COLORS[idx % COLORS.length];
                    const seriesOptions = { color, lineWidth: 2, priceScaleId: 'left' };
                    
                    if (d.config && d.config.fixed_scale) {
                        seriesOptions.autoscaleInfoProvider = () => ({
                            priceRange: {
                                minValue: d.config.fixed_scale.min,
                                maxValue: d.config.fixed_scale.max,
                            },
                            margins: { above: 0, below: 0 }
                        });
                    }
                    
                    const series = chart.addSeries(LightweightCharts.LineSeries, seriesOptions);
                    series.setData(ds.data);
                    
                    if (idx === 0 && d.config && d.config.reference_lines) {
                        d.config.reference_lines.forEach(line => {
                            series.createPriceLine({
                                price: line.price,
                                color: line.color,
                                lineWidth: 1,
                                lineStyle: line.style !== undefined ? line.style : 2,
                                axisLabelVisible: true,
                                title: line.title || ''
                            });
                        });
                    }
                    
                    seriesGroup.push({ series, lookback: ds.lookback, name: `Lookback ${ds.lookback}` });
                });
                
                container._derivSeriesGroup = seriesGroup;
                stockCharts.push({ chart, seriesGroup, isPrice: false, container, legend, dataRef: derivDataSets[0]?.data || [], panelId: instanceId });
            });
        }

        // Apply Markers
        if (state.markers && state.markers[stockSymbol] && currentPriceSeries) {
            const markersToDraw = [];
            state.markers[stockSymbol].forEach(rule => {
                let dData = [];
                if (rule.derivId === 'price') {
                    dData = dataset.data.map(d => ({ time: d.time, value: d.close }));
                } else {
                    const derivDataSets = dataset.derivData[rule.derivId];
                    if (!derivDataSets || derivDataSets.length === 0) return;
                    let targetDataset = derivDataSets[0]; // Use primary lookback
                    if (rule.overrideLookback) {
                        targetDataset = derivDataSets.find(ds => ds.lookback === rule.overrideLookback) || targetDataset;
                    }
                    dData = targetDataset.data;
                }
                
                dData.forEach((point) => {
                    if (point.value === null) return;
                    let triggered = false;
                    if (rule.operator === '>' && point.value > rule.threshold) triggered = true;
                    if (rule.operator === '<' && point.value < rule.threshold) triggered = true;
                    
                    if (triggered) {
                        let markerText = '';
                        if (rule.derivId === 'pivot_high') markerText = 'H';
                        else if (rule.derivId === 'pivot_low') markerText = 'L';
                        else markerText = rule.shape === 'arrowUp' ? '▲' : '▼';
                        
                        markersToDraw.push({
                            time: point.time,
                            position: rule.shape === 'arrowUp' ? 'belowBar' : 'aboveBar',
                            color: rule.shape === 'arrowUp' ? '#00e676' : '#ff1744',
                            shape: rule.shape,
                            text: markerText
                        });
                    }
                });
            });
            
            // LWC requires markers to be sorted by time
            markersToDraw.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
            
            // LWC also requires unique times per series. For simplicity, group by time.
            const uniqueMarkers = {};
            markersToDraw.forEach(m => {
                uniqueMarkers[m.time] = m;
            });
            const uniqueMarkersArray = Object.values(uniqueMarkers);
            if (currentPriceSeries.setMarkers) {
                currentPriceSeries.setMarkers(uniqueMarkersArray);
            } else if (LightweightCharts.createSeriesMarkers) {
                const markersPrimitive = LightweightCharts.createSeriesMarkers(currentPriceSeries, uniqueMarkersArray);
                if (currentPriceSeries.attachPrimitive) {
                    currentPriceSeries.attachPrimitive(markersPrimitive);
                }
            }
        }

        // Sync logic for this stock's charts
        stockCharts.forEach((source) => {
            // Restore previous zoom state if available
            if (window.ACTIVE_RANGES && window.ACTIVE_RANGES[stockSymbol]) {
                setTimeout(() => {
                    source.chart.timeScale().setVisibleLogicalRange(window.ACTIVE_RANGES[stockSymbol]);
                }, 10);
            }

            source.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
                if (!range) return;
                window.ACTIVE_RANGES[stockSymbol] = range;
                if (window.debouncedUpdateReturnsProfile) {
                    window.debouncedUpdateReturnsProfile(stockSymbol);
                }
                stockCharts.forEach(target => {
                    if (target.chart !== source.chart) target.chart.timeScale().setVisibleLogicalRange(range);
                });
            });

            source.chart.subscribeCrosshairMove((param) => {
                // Determine if crosshair is actually on chart
                const isOnChart = param.point && param.time && param.point.x >= 0 && param.point.x <= source.container.clientWidth;
                
                if (isOnChart) {
                        if (source.isPrice) {
                            const srcCandle = param.seriesData.get(source.series);
                            if (srcCandle) {
                            // Find current index to get previous close for return calculation
                            const targetData = dataset.data;
                            const idx = targetData.findIndex(d => d.time === param.time);
                            let retStr = '';
                            if (idx > 0 && targetData[idx - 1]) {
                                const prevClose = targetData[idx - 1].close;
                                const currClose = srcCandle.close || srcCandle.value;
                                const ret = ((currClose - prevClose) / prevClose * 100).toFixed(2);
                                const retColor = ret >= 0 ? '#26a69a' : '#ef5350';
                                retStr = ` <span style="color: ${retColor}">Ret: ${ret > 0 ? '+' : ''}${ret}%</span>`;
                            }

                            if (srcCandle.open !== undefined) {
                                source.legend.innerHTML = `O: ${srcCandle.open} H: ${srcCandle.high} L: ${srcCandle.low} C: ${srcCandle.close}${retStr}`;
                            } else {
                                source.legend.innerHTML = `C: ${srcCandle.value}${retStr}`;
                            }
                        }
                    } else {
                        let legStr = '';
                            source.seriesGroup.forEach(grp => {
                                const candle = param.seriesData.get(grp.series);
                                if (candle) legStr += `L${grp.lookback}: ${candle.value.toFixed(2)}  `;
                            });
                            source.legend.innerHTML = legStr || 'No Data';
                        }
                    }
                stockCharts.forEach(target => {
                    if (target.chart !== source.chart) {
                        if (!isOnChart) {
                            if (target.chart.clearCrosshairPosition) target.chart.clearCrosshairPosition();
                        } else {
                            const targetData = target.isPrice ? dataset.data : target.dataRef;
                            const targetPoint = targetData.find(dt => dt.time === param.time);
                            if (targetPoint && target.chart.setCrosshairPosition) {
                                const price = targetPoint.value !== undefined ? targetPoint.value : targetPoint.close;
                                const mainSeries = target.isPrice ? target.series : (target.seriesGroup && target.seriesGroup[0]?.series);
                                if (mainSeries) target.chart.setCrosshairPosition(price, param.time, mainSeries);
                            }
                        }
                    }
                });
            });
        });
    }

    // Trigger all active overlays to plot automatically
    document.querySelectorAll('.overlay-checkbox:checked').forEach(cb => {
        window.toggleOverlayInput(cb);
    });
}

// --- BULK ACTIONS ---
function wireBulkActions(triggerUpdate) {
    document.querySelectorAll('.bulk-actions').forEach(container => {
        const selectAll = container.querySelector('.btn-select-all');
        const clearAll = container.querySelector('.btn-deselect-all');
        const form = container.closest('form');
        
        selectAll.addEventListener('click', async () => {
            form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (cb.parentElement.style.display !== 'none') {
                    cb.checked = true;
                }
            });
            await triggerUpdate();
        });
        
        clearAll.addEventListener('click', async () => {
            form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (cb.parentElement.style.display !== 'none') {
                    cb.checked = false;
                }
            });
            await triggerUpdate();
        });
    });
}

// --- GLOBALS ---
window.switchTab = (btn) => {
    const targetId = btn.getAttribute('data-target');
    const stockCard = btn.closest('.stock-card');
    
    // Deactivate all buttons
    stockCard.querySelectorAll('.tab-btn').forEach(b => {
        b.style.background = 'none';
        b.style.fontWeight = 'normal';
    });
    
    // Hide all panes
    stockCard.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    
    // Activate clicked button and pane
    btn.style.background = 'var(--bg-hover)';
    btn.style.fontWeight = 'bold';
    document.getElementById(targetId).style.display = 'block';

    // If it's the returns tab, auto-load if empty
    if (targetId.startsWith('returns-')) {
        const symbol = targetId.replace('returns-', '');
        if (document.getElementById(`returns-content-${symbol}`).innerHTML === 'Loading profile...') {
            window.updateReturnsProfile(symbol);
        }
    }
};

window._returnsProfileDebounce = {};
window.debouncedUpdateReturnsProfile = (symbol) => {
    if (window._returnsProfileDebounce[symbol]) clearTimeout(window._returnsProfileDebounce[symbol]);
    window._returnsProfileDebounce[symbol] = setTimeout(() => {
        window.updateReturnsProfile(symbol);
    }, 150);
};

window.updateReturnsProfile = async (symbol) => {
    const container = document.getElementById(`returns-content-${symbol}`);
    const input = document.getElementById(`returns-period-${symbol}`);
    if (!container || !input) return;

    // Use the first valid integer if multiple are typed
    const periodStrs = input.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    if (periodStrs.length === 0) return;
    const period = periodStrs[0]; 
    
    try {
        const fullData = window.APP_DATA && window.APP_DATA[symbol];
        if (!fullData || fullData.length === 0) {
            container.innerHTML = '<p>No data available</p>';
            return;
        }

        let activeData = fullData;
        const range = window.ACTIVE_RANGES && window.ACTIVE_RANGES[symbol];
        
        // Sync to the visible logical range of the chart
        if (range && range.from !== null && range.to !== null) {
            const startIdx = Math.max(0, Math.floor(range.from));
            const endIdx = Math.min(fullData.length, Math.ceil(range.to));
            if (endIdx - startIdx > period) {
                activeData = fullData.slice(startIdx, endIdx);
            }
        }

        const profile = computeReturnsProfile(activeData, period);
        
        if (!profile) {
            container.innerHTML = '<p style="color: var(--text-muted); text-align: center; margin-top: 50px;">Not enough visible data points to calculate a ' + period + '-day return.</p>';
            return;
        }

        const maxCount = Math.max(...Object.values(profile.bins));
        const binKeys = Object.keys(profile.bins).sort((a,b)=>a-b);
        const minBin = parseFloat(binKeys[0]);
        const maxBin = parseFloat(binKeys[binKeys.length - 1]);
        
        // Calculate dynamic width based on number of bins
        const numBins = binKeys.length;
        const barWidth = Math.max(4, Math.min(20, 800 / numBins));

        let bars = '';
        binKeys.forEach(binStr => {
            const bin = parseFloat(binStr);
            const count = profile.bins[bin];
            const height = (count / maxCount) * 100;
            const color = bin < 0 ? 'var(--danger)' : 'var(--success)';
            bars += `<div style="flex-shrink:0; width:${barWidth}px; background:${color}; height:${height}%; margin-right:1px; border-radius:2px 2px 0 0;" title="Return: ${bin}% to ${bin+1}%\nOccurrences: ${count}"></div>`;
        });

        container.innerHTML = `
            <div style="position: relative; width: 100%;">
                
                <!-- Chart Area (Full Width) -->
                <div style="display: flex; margin-top: 10px; width: 100%;">
                    <!-- Y-Axis -->
                    <div style="display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; padding-right: 8px; border-right: 1px solid var(--border-color); color: var(--text-muted); font-size: 11px; height: 200px; min-width: 40px;">
                        <span>${maxCount}</span>
                        <span>${Math.round(maxCount * 0.75)}</span>
                        <span>${Math.round(maxCount * 0.5)}</span>
                        <span>${Math.round(maxCount * 0.25)}</span>
                        <span>0</span>
                    </div>
                    
                    <!-- Histogram Bars -->
                    <div style="flex-grow: 1; display: flex; flex-direction: column; padding-left: 8px;">
                        <div style="height: 200px; display:flex; justify-content: center; align-items:flex-end; border-bottom:1px solid var(--border-color); overflow-x:hidden; padding-bottom:0;">
                            ${bars}
                        </div>
                        
                        <!-- X-Axis -->
                        <div style="display:flex; justify-content: space-between; margin-top: 6px; color: var(--text-muted); font-size: 11px; padding: 0 10px;">
                            <span>${minBin}%</span>
                            <span style="color: var(--text-main); font-weight: bold;">0%</span>
                            <span>+${maxBin}%</span>
                        </div>
                    </div>
                </div>

                <!-- Overlay Summary Table -->
                <div style="position: absolute; top: 10px; right: 20px; width: 220px; background: rgba(255, 255, 255, 0.95); box-shadow: 0 4px 12px rgba(0,0,0,0.1); border-radius: 8px; border: 1px solid var(--border-color); z-index: 10;">
                    <table style="width:100%; border-collapse:collapse; font-size: 11px;">
                        <tr style="border-bottom:1px solid var(--border-color); background: var(--bg-panel);">
                            <th style="padding:8px; text-align:left; border-radius: 8px 0 0 0;">${period}-Day Summary</th>
                            <th style="padding:8px; text-align:right; border-radius: 0 8px 0 0;"></th>
                        </tr>
                        <tr style="border-bottom:1px solid #f0f0f0;">
                            <td style="padding:6px 8px;">Win Rate</td>
                            <td style="padding:6px 8px; text-align:right; font-weight:bold; color: ${profile.winRate > 50 ? 'var(--success)' : 'var(--danger)'}">${profile.winRate.toFixed(1)}%</td>
                        </tr>
                        <tr style="border-bottom:1px solid #f0f0f0;">
                            <td style="padding:6px 8px;">Expected Return</td>
                            <td style="padding:6px 8px; text-align:right; font-weight:bold;">${profile.mean.toFixed(2)}%</td>
                        </tr>
                        <tr style="border-bottom:1px solid #f0f0f0;">
                            <td style="padding:6px 8px;">Worst Drop</td>
                            <td style="padding:6px 8px; text-align:right; font-weight:bold; color: var(--danger)">${profile.min.toFixed(2)}%</td>
                        </tr>
                        <tr>
                            <td style="padding:6px 8px;">Best Gain</td>
                            <td style="padding:6px 8px; text-align:right; font-weight:bold; color: var(--success)">${profile.max.toFixed(2)}%</td>
                        </tr>
                    </table>
                </div>
            </div>
        `;
    } catch (e) {
        console.error(e);
        container.innerHTML = '<p>Error loading data</p>';
    }
};

window.removeStock = (btn, stockSymbol) => {
    // Uncheck in sidebar
    const checkbox = document.querySelector(`input[name="stock"][value="${stockSymbol}"]`);
    if (checkbox) checkbox.checked = false;
    
    // Update State
    const state = loadState();
    state.stocks = state.stocks.filter(s => s !== stockSymbol);
    saveState(state);
    
    // Rerender
    if (window.triggerUpdate) {
        window.triggerUpdate();
    }
};

window.removePanel = (btn) => {
    const li = btn.closest('li');
    if (!li) return;
    
    const section = li.querySelector('.chart-canvas');
    if (section && section.id) {
        // e.g. chart-TCS-roc_12345
        const parts = section.id.split('-');
        if (parts.length >= 3) {
            const instanceId = parts.slice(2).join('-');
            
            // Save state
            const state = loadState();
            state.panels = state.panels.filter(p => p.instanceId !== instanceId);
            saveState(state);
            renderCharts(state);
        }
    }
    
    if (globalChartObserver && section) {
        globalChartObserver.unobserve(section);
    }
    li.remove();
};

window.toggleDocs = (btn, stockSymbol, derivId) => {
    const chart = document.getElementById(`chart-${stockSymbol}-${derivId}`);
    const docs = document.getElementById(`docs-${stockSymbol}-${derivId}`);
    
    if (!chart || !docs) {
        console.error("Missing chart or docs container for", stockSymbol, derivId);
        return;
    }
    
    const isDocsVisible = docs.style.display === 'block';
    
    if (isDocsVisible) {
        docs.style.display = 'none';
        chart.style.display = 'block';
        btn.style.background = '';
    } else {
        chart.style.display = 'none';
        docs.style.display = 'block';
        btn.style.background = 'var(--bg-hover)';
    }
};

window.toggleOverlayInput = (checkbox) => {
    const row = checkbox.closest('div');
    const container = row.querySelector('.overlay-period-container');
    const input = container.querySelector('.overlay-period-input');
    const colorPicker = container.querySelector('.overlay-color-picker');
    
    if (checkbox.checked) {
        input.disabled = false;
        if (colorPicker) colorPicker.disabled = false;
        container.style.opacity = '1';
        if (!input.value) input.value = '20'; // default
    } else {
        input.disabled = true;
        if (colorPicker) colorPicker.disabled = true;
        container.style.opacity = '0.5';
    }
    window.updateOverlayFromDropdown(input);
};

window.updateOverlayFromDropdown = (elem) => {
    if (typeof event !== 'undefined' && event && event.stopPropagation) {
        event.stopPropagation();
    }
    
    const rowDivForData = elem.closest('div').parentElement;
    const dataInput = rowDivForData.querySelector('.overlay-period-input') || elem;
    
    const stockSymbol = dataInput.dataset.stock;
    const panelId = dataInput.dataset.panel;
    const container = document.getElementById(`chart-${stockSymbol}-${panelId}`);
    if (!container || !container._chartInstance || !container._mainData) return;

    if (container._overlaySeriesGroup) {
        container._overlaySeriesGroup.forEach(grp => container._chartInstance.removeSeries(grp.series));
        container._overlaySeriesGroup = [];
    } else {
        container._overlaySeriesGroup = [];
    }

    const dropdown = elem.closest('.dropdown-menu');
    const checkedBoxes = dropdown.querySelectorAll('.overlay-checkbox:checked');
    
    // We do NOT return early if length is 0, because we need to save the empty array to state!

    const data = container._mainData;
    const COLORS = ['#fbc02d', '#ff5252', '#448aff', '#69f0ae', '#e040fb', '#1de9b6'];
    let colorIdx = 0;

    checkedBoxes.forEach(box => {
        const type = box.value;
        const rowDiv = box.closest('div');
        const containerDiv = rowDiv.querySelector('.overlay-period-container');
        const input = containerDiv.querySelector('.overlay-period-input');
        const colorPicker = containerDiv.querySelector('.overlay-color-picker');
        if (!input.value) return;

        const baseColor = colorPicker ? colorPicker.value : COLORS[colorIdx % COLORS.length];
        const periods = input.value.split(',').map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 0);

        periods.forEach((period, pIdx) => {
            let overlayData = [];

            if (type === 'sma') {
                for (let i = 0; i < data.length; i++) {
                    if (i < period - 1) {
                        overlayData.push({ time: data[i].time, value: null });
                        continue;
                    }
                    let sum = 0;
                    for (let j = i - period + 1; j <= i; j++) {
                        sum += data[j].close !== undefined ? data[j].close : data[j].value;
                    }
                    overlayData.push({ time: data[i].time, value: sum / period });
                }
            } else if (type === 'wma') {
                const weightSum = (period * (period + 1)) / 2;
                for (let i = 0; i < data.length; i++) {
                    if (i < period - 1) {
                        overlayData.push({ time: data[i].time, value: null });
                        continue;
                    }
                    let sum = 0;
                    let w = 1;
                    for (let j = i - period + 1; j <= i; j++) {
                        const val = data[j].close !== undefined ? data[j].close : data[j].value;
                        sum += val * w;
                        w++;
                    }
                    overlayData.push({ time: data[i].time, value: sum / weightSum });
                }
            } else if (type === 'linreg') {
                for (let i = 0; i < data.length; i++) {
                    if (i < period - 1) {
                        overlayData.push({ time: data[i].time, value: null });
                        continue;
                    }
                    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
                    for (let j = 0; j < period; j++) {
                        const idxData = i - period + 1 + j;
                        const y = data[idxData].close !== undefined ? data[idxData].close : data[idxData].value;
                        const x = j;
                        sumX += x;
                        sumY += y;
                        sumXY += x * y;
                        sumX2 += x * x;
                    }
                    const slope = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
                    const intercept = (sumY - slope * sumX) / period;
                    const endPoint = slope * (period - 1) + intercept;
                    overlayData.push({ time: data[i].time, value: endPoint });
                }
            }

            overlayData = overlayData.filter(d => d.value !== null && !isNaN(d.value));

            if (overlayData.length > 0) {
                // First period gets the dropdown color, subsequent periods get auto-colors so they don't blend together
                const seriesColor = (pIdx === 0) ? baseColor : COLORS[colorIdx % COLORS.length];
                
                const series = container._chartInstance.addSeries(LightweightCharts.LineSeries, {
                    color: seriesColor,
                    lineWidth: 2,
                    priceScaleId: 'left',
                    lineStyle: 0
                });
                series.setData(overlayData);
                container._overlaySeriesGroup.push({ series, name: `${type.toUpperCase()} ${period}` });
                colorIdx++;
            }
        });
    });

    // Save to state
    const state = loadState();
    state.overlays = state.overlays || {};
    state.overlays[stockSymbol] = state.overlays[stockSymbol] || {};
    state.overlays[stockSymbol][panelId] = [];
    
    checkedBoxes.forEach(box => {
        const type = box.value;
        const rowDiv = box.closest('div');
        const containerDiv = rowDiv.querySelector('.overlay-period-container');
        const input = containerDiv.querySelector('.overlay-period-input');
        const colorPicker = containerDiv.querySelector('.overlay-color-picker');
        if (!input.value) return;
        state.overlays[stockSymbol][panelId].push({ type, period: input.value, color: colorPicker ? colorPicker.value : undefined });
    });
    
    saveState(state);
};

window.toggleColorMenu = (btn, stockSymbol, panelId) => {
    let menu = document.getElementById(`color-menu-${stockSymbol}-${panelId}`);
    if (!menu) {
        menu = document.createElement('div');
        menu.id = `color-menu-${stockSymbol}-${panelId}`;
        menu.className = 'dropdown-menu';
        menu.style.position = 'absolute';
        menu.style.top = '100%';
        menu.style.right = '0';
        menu.style.padding = '12px';
        menu.style.width = 'max-content';
        menu.style.minWidth = '150px';
        menu.style.zIndex = '300';
        btn.parentElement.appendChild(menu);
    }

    if (menu.style.display === 'block') {
        menu.style.display = 'none';
        return;
    }
    
    // Close other open color menus
    document.querySelectorAll('.dropdown-menu[id^="color-menu-"]').forEach(m => m.style.display = 'none');
    
    const container = document.getElementById(`chart-${stockSymbol}-${panelId}`);
    if (!container) return;

    let html = '<h4 style="margin:0 0 10px 0; font-size:12px; color:var(--text-muted);">Line Colors</h4>';

    if (container._mainSeries && container._mainSeries.options().color) {
        html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <label style="font-size:11px; margin-right:10px;">Line Plot</label>
            <input type="color" value="${container._mainSeries.options().color}" onchange="window.updateSeriesColor('${stockSymbol}', '${panelId}', 'main', 0, this.value)" style="cursor:pointer; width:24px; height:24px; padding:0; border:none; border-radius:4px;">
        </div>`;
    }

    if (container._derivSeriesGroup) {
        container._derivSeriesGroup.forEach((grp, i) => {
            html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <label style="font-size:11px; margin-right:10px;">${grp.name}</label>
                <input type="color" value="${grp.series.options().color}" onchange="window.updateSeriesColor('${stockSymbol}', '${panelId}', 'deriv', ${i}, this.value)" style="cursor:pointer; width:24px; height:24px; padding:0; border:none; border-radius:4px;">
            </div>`;
        });
    }

    if (container._overlaySeriesGroup) {
        container._overlaySeriesGroup.forEach((grp, i) => {
            html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <label style="font-size:11px; margin-right:10px;">${grp.name}</label>
                <input type="color" value="${grp.series.options().color}" onchange="window.updateSeriesColor('${stockSymbol}', '${panelId}', 'overlay', ${i}, this.value)" style="cursor:pointer; width:24px; height:24px; padding:0; border:none; border-radius:4px;">
            </div>`;
        });
    }

    if (html === '<h4 style="margin:0 0 10px 0; font-size:12px; color:var(--text-muted);">Line Colors</h4>') {
        html += '<span style="font-size:11px; color:var(--text-muted);">No customizable lines active</span>';
    }

    menu.innerHTML = html;
    menu.style.display = 'block';
};

window.updateSeriesColor = (stockSymbol, panelId, type, idx, color) => {
    const container = document.getElementById(`chart-${stockSymbol}-${panelId}`);
    if (!container) return;

    if (type === 'main' && container._mainSeries) {
        container._mainSeries.applyOptions({ color });
    } else if (type === 'deriv' && container._derivSeriesGroup && container._derivSeriesGroup[idx]) {
        container._derivSeriesGroup[idx].series.applyOptions({ color });
    } else if (type === 'overlay' && container._overlaySeriesGroup && container._overlaySeriesGroup[idx]) {
        container._overlaySeriesGroup[idx].series.applyOptions({ color });
    }
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    // Populate UI options
    const tickerContainer = document.getElementById('ticker-list-container');
    const tickerFrag = document.createDocumentFragment();
    TICKERS.forEach(stock => {
        const label = document.createElement('label');
        label.innerHTML = `<input type="checkbox" name="stock" value="${stock.symbol}"> ${stock.name}`;
        tickerFrag.appendChild(label);
    });
    tickerContainer.appendChild(tickerFrag);

    const derivForm = document.getElementById('dropdown-derivatives');
    
    // Inject Group Header for 1st Order
    const header1 = document.createElement('div');
    header1.style.cssText = 'padding: 4px 12px; font-weight: bold; background: var(--bg-surface); font-size: 10px; color: var(--text-muted); margin-top: 4px;';
    header1.textContent = '1ST ORDER';
    derivForm.appendChild(header1);
    
    DERIVATIVES_CONFIG.filter(d => d.category === '1st_order').forEach(deriv => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'drawer-btn';
        btn.style.cssText = 'width: 100%; text-align: left; padding: 6px 12px; margin-bottom: 2px; background: none; border: none; color: var(--text-color); cursor: pointer; border-radius: 4px;';
        btn.title = `${deriv.what_is_it}\n\nCalc: ${deriv.calculation}\nUsage: ${deriv.usage}`;
        btn.innerHTML = `+ Add ${deriv.name}`;
        btn.onclick = () => window.addPanelInstance(deriv.id);
        
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--bg-surface)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'none');
        
        derivForm.appendChild(btn);
    });

    // Inject Group Header for 2nd Order
    const header2 = document.createElement('div');
    header2.style.cssText = 'padding: 4px 12px; font-weight: bold; background: var(--bg-surface); font-size: 10px; color: var(--text-muted); margin-top: 8px;';
    header2.textContent = '2ND ORDER';
    derivForm.appendChild(header2);
    
    DERIVATIVES_CONFIG.filter(d => d.category === '2nd_order').forEach(deriv => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'drawer-btn';
        btn.style.cssText = 'width: 100%; text-align: left; padding: 6px 12px; margin-bottom: 2px; background: none; border: none; color: var(--text-color); cursor: pointer; border-radius: 4px;';
        btn.title = `${deriv.what_is_it}\n\nCalc: ${deriv.calculation}\nUsage: ${deriv.usage}`;
        btn.innerHTML = `+ Add ${deriv.name}`;
        btn.onclick = () => window.addPanelInstance(deriv.id);
        
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--bg-surface)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'none');
        
        derivForm.appendChild(btn);
    });

    // Inject Group Header for 3rd Order
    const header3 = document.createElement('div');
    header3.style.cssText = 'padding: 4px 12px; font-weight: bold; background: var(--bg-surface); font-size: 10px; color: var(--text-muted); margin-top: 8px;';
    header3.textContent = '3RD ORDER';
    derivForm.appendChild(header3);
    
    DERIVATIVES_CONFIG.filter(d => d.category === '3rd_order').forEach(deriv => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'drawer-btn';
        btn.style.cssText = 'width: 100%; text-align: left; padding: 6px 12px; margin-bottom: 2px; background: none; border: none; color: var(--text-color); cursor: pointer; border-radius: 4px;';
        btn.title = `${deriv.what_is_it}\n\nCalc: ${deriv.calculation}\nUsage: ${deriv.usage}`;
        btn.innerHTML = `+ Add ${deriv.name}`;
        btn.onclick = () => window.addPanelInstance(deriv.id);
        
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--bg-surface)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'none');
        
        derivForm.appendChild(btn);
    });

    const triggerUpdate = async () => {
        const newState = gatherStateFromUI();
        saveState(newState);
        await renderCharts(newState);
    };
    
    window.triggerUpdate = triggerUpdate;
    window.addPanelInstance = async (derivId) => {
        const state = loadState();
        state.panels = state.panels || [];
        state.panels.push({ instanceId: derivId + '_' + Math.floor(Math.random() * 1000000), derivId });
        saveState(state);
        await renderCharts(state);
    };

    wireBulkActions(triggerUpdate);

    // Auto-update on any selection change
    document.querySelectorAll('header form').forEach(form => {
        form.addEventListener('change', triggerUpdate);
    });

    document.getElementById('main-chart-container').addEventListener('change', async (e) => {
        if (e.target.classList.contains('lookback-input')) {
            const derivId = e.target.getAttribute('data-deriv');
            const stockSymbol = e.target.getAttribute('data-stock');
            const vals = e.target.value.split(',').map(v => {
                const trimmed = v.trim();
                if (trimmed.includes(':')) return trimmed;
                return parseInt(trimmed);
            }).filter(v => typeof v === 'string' || !isNaN(v));
            if (vals.length > 0) {
                const state = loadState();
                state.lookbacks = state.lookbacks || {};
                state.lookbacks[stockSymbol] = state.lookbacks[stockSymbol] || {};
                state.lookbacks[stockSymbol][derivId] = vals;
                saveState(state);
                await renderCharts(state);
            }
        } else if (e.target.classList.contains('plot-input')) {
            const stock = e.target.getAttribute('data-stock');
            const state = loadState();
            state.plots = state.plots || {};
            state.plots[stock] = e.target.value;
            saveState(state);
            await renderCharts(state);
        } else if (e.target.classList.contains('timeframe-input')) {
            const stock = e.target.getAttribute('data-stock');
            const state = loadState();
            state.timeframes = state.timeframes || {};
            state.timeframes[stock] = e.target.value;
            saveState(state);
            await renderCharts(state);
        }
    });

    // Drawer Logic
    const brandToggle = document.getElementById('brand-toggle');
    const closeDrawerBtn = document.getElementById('close-drawer');
    const drawerBackdrop = document.getElementById('drawer-backdrop');

    const openDrawer = () => document.body.classList.add('drawer-open');
    const closeDrawer = () => document.body.classList.remove('drawer-open');

    if (brandToggle) brandToggle.addEventListener('click', openDrawer);
    if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);
    if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);

    // Workspace Management Logic
    const loadTemplates = async () => {
        try {
            const res = await fetch('/api/workspaces');
            const files = await res.json();
            const container = document.getElementById('template-list-container');
            if (!container) return;
            container.innerHTML = files.filter(f => f !== 'autosave').map(f => `
                <li style="display:flex; justify-content:space-between; align-items:center;">
                    <button class="workspace-btn" data-file="${f}" style="flex-grow:1; text-align:left; background:transparent; border:none; color:inherit; cursor:pointer;">${f}</button>
                    <button data-delete="${f}" class="btn-icon danger delete-workspace" style="display:none; padding: 2px 6px; font-size:10px;">✕</button>
                </li>
            `).join('');
            
            // Hover effects
            container.querySelectorAll('li').forEach(li => {
                li.addEventListener('mouseenter', () => li.querySelector('.delete-workspace').style.display = 'block');
                li.addEventListener('mouseleave', () => li.querySelector('.delete-workspace').style.display = 'none');
            });
            
            // Delete handler
            container.querySelectorAll('.delete-workspace').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const file = e.target.getAttribute('data-delete');
                    if(confirm('Delete workspace: ' + file + '?')) {
                        await fetch('/api/workspaces?name=' + file, { method: 'DELETE' });
                        loadTemplates(); // reload UI
                    }
                });
            });

            container.querySelectorAll('.workspace-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const file = e.target.getAttribute('data-file');
                    const res = await fetch(`/api/workspaces?name=${file}`);
                    const state = await res.json();
                    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
                    window.ACTIVE_WORKSPACE = file;
                    sessionStorage.setItem('active_workspace', file);
                    applyStateToUI(state);
                    renderCharts(state);
                    closeDrawer();
                });
            });
        } catch (err) {
            console.error('Error loading templates', err);
        }
    };

    document.getElementById('btn-workspace-new')?.addEventListener('click', async () => {
        // Calculate next Untitled index
        let nextIndex = 1;
        try {
            const res = await fetch('/api/workspaces');
            const files = await res.json();
            const untitledFiles = files.filter(f => f.startsWith(window.APP_CONFIG.DEFAULT_WORKSPACE_NAME + '_'));
            if (untitledFiles.length > 0) {
                const indices = untitledFiles.map(f => parseInt(f.replace(window.APP_CONFIG.DEFAULT_WORKSPACE_NAME + '_', ''))).filter(n => !isNaN(n));
                if (indices.length > 0) nextIndex = Math.max(...indices) + 1;
            }
        } catch (e) {}

        const suggestedName = `${window.APP_CONFIG.DEFAULT_WORKSPACE_NAME}_${nextIndex}`;
        const name = prompt('Create new workspace:', suggestedName);
        
        if (name) {
            window.ACTIVE_WORKSPACE = name;
            sessionStorage.setItem('active_workspace', name);
            const emptyState = { timeframes: {}, stocks: [], panels: [], lookbacks: {} };
            sessionStorage.setItem(STATE_KEY, JSON.stringify(emptyState));
            // Save to server immediately to create the file
            await fetch(`/api/workspaces?name=${name}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(emptyState)
            });
            
            applyStateToUI(emptyState);
            renderCharts(emptyState);
            loadTemplates();
            closeDrawer();
        }
    });

    document.getElementById('btn-workspace-export')?.addEventListener('click', async () => {
        const name = prompt('Enter a name for this workspace template:');
        if (name) {
            const state = loadState();
            await fetch(`/api/workspaces?name=${name}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state)
            });
            loadTemplates();
            alert(`Workspace "${name}" saved successfully!`);
        }
    });

    // Load initial state from server and render
    try {
        const response = await fetch(`/api/workspaces?name=${window.ACTIVE_WORKSPACE}`);
        if (response.ok) {
            const serverState = await response.json();
            sessionStorage.setItem(STATE_KEY, JSON.stringify(serverState));
        }
    } catch (err) {
        console.warn('Could not load autosave from server, falling back to local defaults.');
    }

    const initialState = loadState();
    applyStateToUI(initialState);
    renderCharts(initialState);
    loadTemplates();
});

// --- MARKERS SYSTEM ---
window.addMarkerRule = function(stockSymbol, derivId) {
    const op = document.getElementById('marker-op-' + stockSymbol + '-' + derivId).value;
    const val = parseFloat(document.getElementById('marker-val-' + stockSymbol + '-' + derivId).value);
    const shape = document.getElementById('marker-shape-' + stockSymbol + '-' + derivId).value;
    
    if (isNaN(val)) {
        alert('Please enter a valid number for the threshold.');
        return;
    }

    const state = loadState();
    if (!state.markers) state.markers = {};
    if (!state.markers[stockSymbol]) state.markers[stockSymbol] = [];
    
    state.markers[stockSymbol].push({
        derivId: derivId,
        originPanelId: derivId,
        operator: op,
        threshold: val,
        shape: shape
    });
    
    saveState(state);
    window.triggerUpdate();
};

window.addPivotMarker = function(stockSymbol, panelId = 'price') {
    const idSuffix = (panelId === 'price') ? stockSymbol : (stockSymbol + '-' + panelId);
    const type = document.getElementById('pivot-type-' + idSuffix).value;
    const lb = document.getElementById('pivot-lb-' + idSuffix).value || "5:2:0";
    
    const state = loadState();
    if (!state.markers) state.markers = {};
    if (!state.markers[stockSymbol]) state.markers[stockSymbol] = [];
    
    state.markers[stockSymbol].push({
        derivId: type,
        originPanelId: panelId,
        operator: type === 'pivot_high' ? '>' : '<', // High plots arrowDown natively
        threshold: 0, // Pivot thresholds are 0 relative, not price relative!
        shape: type === 'pivot_high' ? 'arrowDown' : 'arrowUp',
        overrideLookback: lb
    });
    
    saveState(state);
    window.triggerUpdate();
};

window.removeMarkerRule = function(stockSymbol, index) {
    const state = loadState();
    if (state.markers && state.markers[stockSymbol]) {
        state.markers[stockSymbol].splice(index, 1);
        saveState(state);
        window.triggerUpdate();
    }
};

window.updateMarkerRule = function(stockSymbol, index, opId, valId, shapeId, lbId) {
    const state = loadState();
    if (state.markers && state.markers[stockSymbol]) {
        const rule = state.markers[stockSymbol][index];
        if (rule) {
            rule.operator = document.getElementById(opId).value;
            rule.threshold = parseFloat(document.getElementById(valId).value) || 0;
            rule.shape = document.getElementById(shapeId).value;
            const lbElem = document.getElementById(lbId);
            if (lbElem) rule.overrideLookback = lbElem.value;
            saveState(state);
            window.triggerUpdate();
        }
    }
};

window.clearMarkers = function(stockSymbol, derivId) {
    const state = loadState();
    if (state.markers && state.markers[stockSymbol]) {
        state.markers[stockSymbol] = state.markers[stockSymbol].filter(m => {
            const safeDerivId = m.derivId || '';
            const mPanelId = m.originPanelId || (safeDerivId.startsWith('pivot') ? 'price' : safeDerivId) || 'price';
            return mPanelId !== derivId;
        });
        saveState(state);
        window.triggerUpdate();
    }
};

window.applyMarkerTemplate = function(selectElement, stockSymbol, derivId) {
    if (!selectElement.value) return;
    const template = JSON.parse(selectElement.value);
    
    const state = loadState();
    if (!state.markers) state.markers = {};
    if (!state.markers[stockSymbol]) state.markers[stockSymbol] = [];
    
    state.markers[stockSymbol].push({
        derivId: template.overrideDerivId || derivId,
        originPanelId: derivId,
        operator: template.op,
        threshold: template.val,
        shape: template.shape,
        overrideLookback: template.overrideLookback || null
    });
    
    saveState(state);
    window.triggerUpdate();
    selectElement.value = ""; 
};

window.renderActiveMarkers = function(stockSymbol) {
    const state = loadState();
    const rules = (state.markers && state.markers[stockSymbol]) || [];
    
    const grouped = {};
    rules.forEach((r, i) => {
        const safeDerivId = r.derivId || '';
        const panelId = r.originPanelId || (safeDerivId.startsWith('pivot') ? 'price' : safeDerivId) || 'price';
        if (!grouped[panelId]) grouped[panelId] = [];
        grouped[panelId].push({ ...r, index: i });
    });
    
    Object.keys(grouped).forEach(panelId => {
        const listDiv = document.getElementById('markers-list-' + stockSymbol + '-' + panelId);
        if (listDiv) {
            listDiv.innerHTML = grouped[panelId].map(r => {
                const prefix = (r.derivId && r.derivId !== panelId) ? r.derivId : '';
                const opId = `m-upd-op-${stockSymbol}-${r.index}`;
                const valId = `m-upd-val-${stockSymbol}-${r.index}`;
                const shapeId = `m-upd-shape-${stockSymbol}-${r.index}`;
                const lbId = `m-upd-lb-${stockSymbol}-${r.index}`;
                
                let lbHtml = '';
                if (r.overrideLookback || (r.derivId && r.derivId.startsWith('pivot'))) {
                    lbHtml = `<input type="text" class="inspector-input" id="${lbId}" value="${r.overrideLookback || '5:2:0'}" style="width:50px; padding:2px; font-size:9px;" title="Lookback">`;
                }

                return '<div style="display:flex; flex-direction:column; margin-top:6px; padding:6px; background:rgba(255,255,255,0.05); border-radius:4px; gap:4px;">' +
                    (prefix ? '<div style="font-size:9px; font-weight:bold; color:var(--text-muted);">' + prefix + '</div>' : '') +
                    '<div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">' +
                        `<select class="inspector-input" id="${opId}" style="width:35px; padding:2px; font-size:10px;">
                            <option value=">" ${r.operator === '>' ? 'selected' : ''}>&gt;</option>
                            <option value="<" ${r.operator === '<' ? 'selected' : ''}>&lt;</option>
                        </select>` +
                        `<input type="text" class="inspector-input" id="${valId}" value="${r.threshold}" style="width:45px; padding:2px; font-size:10px;" title="Threshold">` +
                        lbHtml +
                        `<select class="inspector-input" id="${shapeId}" style="width:50px; padding:2px; font-size:10px;">
                            <option value="arrowUp" ${r.shape === 'arrowUp' ? 'selected' : ''}>Up</option>
                            <option value="arrowDown" ${r.shape === 'arrowDown' ? 'selected' : ''}>Dn</option>
                        </select>` +
                        `<button onclick="window.updateMarkerRule('${stockSymbol}', ${r.index}, '${opId}', '${valId}', '${shapeId}', '${lbId}')" class="btn" style="padding:2px 4px; font-size:10px;">Upd</button>` +
                        `<button onclick="window.removeMarkerRule('${stockSymbol}', ${r.index})" style="background:none; border:none; color:#ff5252; cursor:pointer; font-size:10px; padding:2px;">✕</button>` +
                    '</div>' +
                '</div>';
            }).join('');
        }
    });
};

window.updateSource = function(elem) {
    const stock = elem.dataset.stock;
    const derivId = elem.dataset.deriv;
    const container = elem.closest('.inspector-group');
    const select = container.querySelector('.source-select');
    const paramInput = container.querySelector('.source-param');
    
    if (select.value === 'linreg') {
        paramInput.style.display = 'inline-block';
    } else {
        paramInput.style.display = 'none';
    }
    
    const state = loadState();
    state.sources = state.sources || {};
    state.sources[stock] = state.sources[stock] || {};
    state.sources[stock][derivId] = {
        type: select.value,
        param: paramInput.value || '20'
    };
    saveState(state);
    
    // Refresh chart to apply new data
    renderCharts(state);
};

window.updateNormalization = function(elem) {
    const stock = elem.dataset.stock;
    const derivId = elem.dataset.deriv;
    const container = elem.closest('.inspector-group');
    const select = container.querySelector('.norm-select');
    const periodInput = container.querySelector('.norm-period');
    
    if (select.value !== 'none') {
        periodInput.style.display = 'inline-block';
    } else {
        periodInput.style.display = 'none';
    }
    
    const state = loadState();
    state.normalizations = state.normalizations || {};
    state.normalizations[stock] = state.normalizations[stock] || {};
    state.normalizations[stock][derivId] = {
        type: select.value,
        period: periodInput.value || '100'
    };
    saveState(state);
    
    renderCharts(state);
};

window.updatePivotLookback = function(inputEl) {
    const derivId = inputEl.getAttribute('data-deriv');
    const stockSymbol = inputEl.getAttribute('data-stock');
    
    const group = inputEl.closest('.inspector-group');
    const backEl = group.querySelector('.pivot-input-back');
    const aheadEl = group.querySelector('.pivot-input-ahead');
    const threshEl = group.querySelector('.pivot-input-thresh');
    
    const back = parseInt(backEl.value.trim()) || 5;
    const ahead = parseInt(aheadEl.value.trim()) || back;
    const thresh = parseFloat(threshEl.value.trim()) || 0;
    
    const val = back + ':' + ahead + ':' + thresh;
    
    const state = loadState();
    state.lookbacks = state.lookbacks || {};
    state.lookbacks[stockSymbol] = state.lookbacks[stockSymbol] || {};
    state.lookbacks[stockSymbol][derivId] = [val]; 
    saveState(state);
    window.triggerUpdate();
};
