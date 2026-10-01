/**
 * Pure Javascript Linear Regression & Market Derivative Engine
 */

export function rollingLinearRegression(prices, lookback) {
    const results = new Array(prices.length).fill(null);
    if (prices.length < lookback) return results;

    for (let i = lookback - 1; i < prices.length; i++) {
        const slice = prices.slice(i - lookback + 1, i + 1);
        if (slice.includes(null) || slice.includes(undefined)) {
            results[i] = null;
            continue;
        }

        const x = Array.from({ length: lookback }, (_, k) => k + 1);
        const y = slice;

        const n = lookback;
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((a, v, k) => a + v * y[k], 0);
        const sumX2 = x.reduce((a, b) => a + b * b, 0);

        const meanX = sumX / n;
        const meanY = sumY / n;

        const denominator = (n * sumX2 - sumX * sumX);
        const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
        const intercept = meanY - slope * meanX;

        // R-squared and Std of Residuals
        let ssTot = 0;
        let ssRes = 0;
        for (let j = 0; j < n; j++) {
            const yPred = slope * x[j] + intercept;
            ssRes += Math.pow(y[j] - yPred, 2);
            ssTot += Math.pow(y[j] - meanY, 2);
        }

        const r_squared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);
        const std_residual = Math.sqrt(ssRes / n);

        // Standard error of slope (for t-stat)
        let se_slope = 0;
        if (n > 2) {
            const sumXDevSq = x.reduce((a, v) => a + Math.pow(v - meanX, 2), 0);
            const mse = ssRes / (n - 2);
            se_slope = Math.sqrt(mse / sumXDevSq);
        }
        const t_stat = se_slope === 0 ? 0 : slope / se_slope;

        results[i] = {
            slope,
            intercept,
            r_squared,
            std_residual,
            t_stat,
            avg_price: meanY
        };
    }
    return results;
}

export function percentileRank(values, lookback = 100) {
    return values.map((value, index) => {
        if (value === null || !Number.isFinite(value)) return null;

        const start = Math.max(0, index - lookback + 1);
        const window = values.slice(start, index + 1).filter(v => v !== null && Number.isFinite(v));

        if (window.length === 0) return null;

        const belowOrEqual = window.filter(item => item <= value).length;
        return (belowOrEqual / window.length) * 100;
    });
}

export function rollingZScore(values, lookback = 100) {
    return values.map((value, index) => {
        if (value === null || !Number.isFinite(value)) return null;

        const start = Math.max(0, index - lookback + 1);
        const window = values.slice(start, index + 1).filter(v => v !== null && Number.isFinite(v));

        if (window.length < 2) return 0; // Cannot compute z-score on < 2 points

        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window.length;
        const std = Math.sqrt(variance);

        return std === 0 ? 0 : (value - mean) / std;
    });
}

export function rollingMinMax(values, lookback = 100) {
    return values.map((value, index) => {
        if (value === null || !Number.isFinite(value)) return null;

        const start = Math.max(0, index - lookback + 1);
        const window = values.slice(start, index + 1).filter(v => v !== null && Number.isFinite(v));

        if (window.length === 0) return null;

        const min = Math.min(...window);
        const max = Math.max(...window);

        if (max === min) return 0.5; // Avoid division by zero
        return (value - min) / (max - min);
    });
}

export function computeDerivatives(dataset, state = null, ticker = '') {
    const panels = (state && state.panels) ? state.panels : [];
    const lookbacksConfig = (state && state.lookbacks && state.lookbacks[ticker]) ? state.lookbacks[ticker] : {};
    const sourcesConfig = (state && state.sources && state.sources[ticker]) ? state.sources[ticker] : {};

    const prices = dataset.map(d => d.close);
    const timeKeys = dataset.map(d => d.time);

    const results = {};

    const getSourceData = (instanceId) => {
        const config = sourcesConfig[instanceId];
        if (!config) return prices; // default to close
        
        const type = config.type;
        if (type === 'high') return dataset.map(d => d.high);
        if (type === 'low') return dataset.map(d => d.low);
        if (type === 'open') return dataset.map(d => d.open);
        if (type === 'linreg') {
            const lb = parseInt(config.param) || 20;
            const reg = rollingLinearRegression(prices, lb);
            return reg.map((r, i) => {
                if (!r || r.slope === undefined) return dataset[i].close; // fallback if not enough data
                const endPoint = r.slope * (lb - 1) + r.intercept;
                return endPoint;
            });
        }
        return prices;
    };

    const normalizationsConfig = (state && state.normalizations && state.normalizations[ticker]) ? state.normalizations[ticker] : {};

    // Helper to generate multiple series per derivative instance
    const generateSeries = (derivId, defaultLookbacks, computerFunc) => {
        const activePanels = panels.filter(p => p.derivId === derivId);
        
        const activeMarkers = (state && state.markers && state.markers[ticker]) 
            ? state.markers[ticker].filter(m => m.derivId === derivId)
            : [];
            
        if (activePanels.length === 0 && activeMarkers.length > 0) {
            activePanels.push({ derivId: derivId, instanceId: derivId });
        }
        
        activePanels.forEach(panel => {
            const instanceId = panel.instanceId;
            results[instanceId] = [];
            const lbs = lookbacksConfig[instanceId] || defaultLookbacks;
            const norm = normalizationsConfig[instanceId];
            const markerLbs = activeMarkers.map(m => m.overrideLookback).filter(Boolean);
            const allLbs = [...new Set([...lbs, ...markerLbs])];
            
            allLbs.forEach(lb => {
                let seriesData = computerFunc(lb, instanceId);

                if (norm && norm.type && norm.type !== 'none') {
                    const rawValues = seriesData.map(d => d.value);
                    let normValues = rawValues;
                    
                    const normLookback = parseInt(norm.period) || 100;
                    if (norm.type === 'zscore') normValues = rollingZScore(rawValues, normLookback);
                    else if (norm.type === 'minmax') normValues = rollingMinMax(rawValues, normLookback);
                    else if (norm.type === 'percentile') normValues = percentileRank(rawValues, normLookback);
                    
                    seriesData = seriesData.map((d, i) => ({ time: d.time, value: normValues[i] }));
                }

                results[instanceId].push({
                    lookback: lb,
                    data: seriesData.map(d => d.value !== null ? d : { time: d.time })
                });
            });
        });
    };

    // 1st order computers
    generateSeries('normalized_slope', [20, 60, 200], (lb, instanceId) => {
        const sourceData = getSourceData(instanceId);
        const reg = rollingLinearRegression(sourceData, lb);
        const raw = reg.map((r) => (r && r.avg_price !== 0) ? (r.slope / r.avg_price) * 252 * 100 : null);
        const ranked = percentileRank(raw, 100); // 100-day rank window

        return ranked.map((val, i) => ({
            time: timeKeys[i],
            value: val
        }));
    });

    generateSeries('r_squared', [20, 60, 200], (lb) => {
        const reg = rollingLinearRegression(prices, lb);
        return reg.map((r, i) => ({
            time: timeKeys[i],
            value: (r && r.avg_price !== 0) ? r.r_squared * 100 : null
        }));
    });

    generateSeries('std_residual', [20, 60, 200], (lb) => {
        const reg = rollingLinearRegression(prices, lb);
        return reg.map((r, i) => ({
            time: timeKeys[i],
            value: (r && r.avg_price !== 0) ? (r.std_residual / r.avg_price) * Math.sqrt(252) * 100 : null
        }));
    });

    generateSeries('t_stat', [20, 60, 200], (lb) => {
        const reg = rollingLinearRegression(prices, lb);
        return reg.map((r, i) => ({
            time: timeKeys[i],
            value: (r && r.avg_price !== 0) ? r.t_stat : null
        }));
    });

    generateSeries('efficiency_ratio', [10, 20, 60], (lb) => {
        return prices.map((p, i) => {
            if (i < lb) return { time: timeKeys[i], value: null };
            
            const netChange = Math.abs(prices[i] - prices[i - lb]);
            let sumAbsChange = 0;
            
            for (let j = i - lb + 1; j <= i; j++) {
                sumAbsChange += Math.abs(prices[j] - prices[j - 1]);
            }
            
            return {
                time: timeKeys[i],
                value: sumAbsChange === 0 ? 0 : (netChange / sumAbsChange)
            };
        });
    });

    generateSeries('historical_volatility', [10, 20, 60], (lb) => {
        // First pre-calculate daily log returns
        const logReturns = [0];
        for (let i = 1; i < prices.length; i++) {
            logReturns[i] = Math.log(prices[i] / prices[i - 1]);
        }
        
        return prices.map((p, i) => {
            if (i < lb) return { time: timeKeys[i], value: null };
            
            let sum = 0;
            for (let j = i - lb + 1; j <= i; j++) {
                sum += logReturns[j];
            }
            const mean = sum / lb;
            
            let variance = 0;
            for (let j = i - lb + 1; j <= i; j++) {
                variance += Math.pow(logReturns[j] - mean, 2);
            }
            const stdDev = Math.sqrt(variance / lb);
            
            // Annualize and convert to percentage
            const hv = stdDev * Math.sqrt(252) * 100;
            
            return {
                time: timeKeys[i],
                value: hv
            };
        });
    });

    generateSeries('rolling_winrate', [3, 8, 21], (lb) => {
        const rollingWindow = 100; // Fixed 100-day evaluation window
        const holdPeriod = lb; // The input parameter controls the hold period
        return prices.map((p, i) => {
            if (i < rollingWindow + holdPeriod) return { time: timeKeys[i], value: null };
            
            let wins = 0;
            
            // Look back over the last 'rollingWindow' days
            for (let j = i - rollingWindow + 1; j <= i; j++) {
                const pastPrice = prices[j - holdPeriod];
                const currentPrice = prices[j];
                if (pastPrice && currentPrice > pastPrice) {
                    wins++;
                }
            }
            
            return {
                time: timeKeys[i],
                value: (wins / rollingWindow) * 100
            };
        });
    });

    // 2nd order computers
    generateSeries('acceleration', [5, 10, 20], (lb2, instanceId) => {
        const config = sourcesConfig[instanceId];
        let baseData;
        if (config) {
            baseData = getSourceData(instanceId);
        } else {
            const sourceLb = lookbacksConfig['normalized_slope'] ? lookbacksConfig['normalized_slope'][0] : 20;
            const reg1 = rollingLinearRegression(prices, sourceLb);
            baseData = reg1.map(r => (r && r.avg_price !== 0) ? (r.slope / r.avg_price) * 252 * 100 : null);
        }

        const reg2 = rollingLinearRegression(baseData, lb2);
        return reg2.map((r, i) => ({
            time: timeKeys[i],
            value: r ? r.slope * 252 : null
        }));
    });

    generateSeries('jerk', [5, 10, 20], (lb3, instanceId) => {
        const config = sourcesConfig[instanceId];
        let baseData;
        if (config) {
            baseData = getSourceData(instanceId);
        } else {
            // Default acceleration calculation
            const sourceLb = 20;
            const reg1 = rollingLinearRegression(prices, sourceLb);
            const normSlope = reg1.map(r => (r && r.avg_price !== 0) ? (r.slope / r.avg_price) * 252 * 100 : null);
            const reg2 = rollingLinearRegression(normSlope, 10);
            baseData = reg2.map(r => r ? r.slope * 252 : null);
        }

        const reg3 = rollingLinearRegression(baseData, lb3);
        return reg3.map((r, i) => ({
            time: timeKeys[i],
            value: r ? r.slope * 252 : null
        }));
    });

    generateSeries('volatility_coil', [10, 20, 40], (lb2) => {
        const sourceLb = lookbacksConfig['std_residual'] ? lookbacksConfig['std_residual'][0] : 20;
        const reg1 = rollingLinearRegression(prices, sourceLb);
        const noise = reg1.map(r => (r && r.avg_price !== 0) ? (r.std_residual / r.avg_price) * Math.sqrt(252) * 100 : null);

        const reg2 = rollingLinearRegression(noise, lb2);
        return reg2.map((r, i) => ({
            time: timeKeys[i],
            value: r ? r.slope : null
        }));
    });

    generateSeries('consistency_delta', [20], (lb2) => {
        const microReg = rollingLinearRegression(prices, 20);
        const macroReg = rollingLinearRegression(prices, 200);

        return microReg.map((r, i) => {
            const macroR = macroReg[i];
            if (!r || !macroR) return { time: timeKeys[i], value: null };
            return {
                time: timeKeys[i],
                value: (r.r_squared - macroR.r_squared) * 100
            };
        });
    });
    generateSeries('rsi', [14], (lb, instanceId) => {
        const sourceData = getSourceData(instanceId);
        let avgGain = 0;
        let avgLoss = 0;
        
        return sourceData.map((p, i) => {
            if (i === 0) return { time: timeKeys[i], value: null };
            
            const diff = sourceData[i] - sourceData[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            
            if (i < lb) {
                avgGain += gain;
                avgLoss += loss;
                return { time: timeKeys[i], value: null };
            } else if (i === lb) {
                avgGain = avgGain / lb;
                avgLoss = avgLoss / lb;
            } else {
                avgGain = ((avgGain * (lb - 1)) + gain) / lb;
                avgLoss = ((avgLoss * (lb - 1)) + loss) / lb;
            }
            
            if (avgLoss === 0) return { time: timeKeys[i], value: 100 };
            const rs = avgGain / avgLoss;
            const rsi = 100 - (100 / (1 + rs));
            return { time: timeKeys[i], value: rsi };
        });
    });

    generateSeries('roc', [10, 20, 60], (lb, instanceId) => {
        const sourceData = getSourceData(instanceId);
        return sourceData.map((p, i) => {
            if (i < lb) return { time: timeKeys[i], value: null };
            const roc = ((sourceData[i] - sourceData[i - lb]) / sourceData[i - lb]) * 100;
            return { time: timeKeys[i], value: roc };
        });
    });

    generateSeries('roc_acceleration', [10, 20], (lb, instanceId) => {
        const sourceData = getSourceData(instanceId);
        return sourceData.map((p, i) => {
            if (i < lb * 2) return { time: timeKeys[i], value: null };
            const rocToday = ((sourceData[i] - sourceData[i - lb]) / sourceData[i - lb]) * 100;
            const rocPast = ((sourceData[i - lb] - sourceData[i - lb * 2]) / sourceData[i - lb * 2]) * 100;
            const accel = rocToday - rocPast;
            return { time: timeKeys[i], value: accel };
        });
    });

    const pivot_high = (lb, instanceId) => {
        let lookback = lb;
        let lookahead = lb;
        let threshold = 0;
        if (typeof lb === 'string' && lb.includes(':')) {
            const parts = lb.split(':');
            lookback = parseInt(parts[0]) || 5;
            lookahead = parseInt(parts[1]) || lookback;
            threshold = parseFloat(parts[2]) || 0;
        } else {
            lookback = parseInt(lb) || 5;
            lookahead = lookback;
        }

        const sourceData = instanceId ? getSourceData(instanceId) : dataset.map(d => d.high);

        return dataset.map((d, i) => {
            if (i < lookback || i > dataset.length - 1 - lookahead) return { time: timeKeys[i], value: null };
            let isHigh = true;
            const threshVal = Math.abs(sourceData[i] * (threshold / 100));
            
            for (let j = 1; j <= lookback; j++) {
                if (sourceData[i] <= sourceData[i - j] + threshVal) isHigh = false;
            }
            for (let j = 1; j <= lookahead; j++) {
                if (sourceData[i] <= sourceData[i + j] + threshVal) isHigh = false;
            }
            if (isHigh) return { time: timeKeys[i], value: sourceData[i] };
            return { time: timeKeys[i], value: null };
        });
    };

    const pivot_low = (lb, instanceId) => {
        let lookback = lb;
        let lookahead = lb;
        let threshold = 0;
        if (typeof lb === 'string' && lb.includes(':')) {
            const parts = lb.split(':');
            lookback = parseInt(parts[0]) || 5;
            lookahead = parseInt(parts[1]) || lookback;
            threshold = parseFloat(parts[2]) || 0;
        } else {
            lookback = parseInt(lb) || 5;
            lookahead = lookback;
        }

        const sourceData = instanceId ? getSourceData(instanceId) : dataset.map(d => d.low);

        return dataset.map((d, i) => {
            if (i < lookback || i > dataset.length - 1 - lookahead) return { time: timeKeys[i], value: null };
            let isLow = true;
            const threshVal = Math.abs(sourceData[i] * (threshold / 100));
            
            for (let j = 1; j <= lookback; j++) {
                if (sourceData[i] >= sourceData[i - j] - threshVal) isLow = false;
            }
            for (let j = 1; j <= lookahead; j++) {
                if (sourceData[i] >= sourceData[i + j] - threshVal) isLow = false;
            }
            if (isLow) return { time: timeKeys[i], value: sourceData[i] };
            return { time: timeKeys[i], value: null };
        });
    };

    generateSeries('pivot_high', ["5:5"], pivot_high);
    generateSeries('pivot_low', ["5:5"], pivot_low);

    return results;
}

export function computeReturnsProfile(dataset, period) {
    const returns = [];
    for (let i = period; i < dataset.length; i++) {
        const past = dataset[i - period].close;
        const current = dataset[i].close;
        const ret = ((current - past) / past) * 100;
        returns.push(ret);
    }
    
    if (returns.length === 0) return null;

    returns.sort((a, b) => a - b);
    const winRate = returns.filter(r => r > 0).length / returns.length * 100;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const min = returns[0];
    const max = returns[returns.length - 1];

    // Compute bins
    const bins = {};
    const binSize = 1; // 1% bins
    returns.forEach(r => {
        const bin = Math.floor(r / binSize) * binSize;
        bins[bin] = (bins[bin] || 0) + 1;
    });

    return { winRate, mean, min, max, bins, total: returns.length };
}
