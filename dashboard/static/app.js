let priceChart, distanceChart, efficiencyChart;
let priceSeries, distanceSeries, efficiencySeries;

document.addEventListener('DOMContentLoaded', () => {
    
    fetch('/api/stocks')
        .then(res => res.json())
        .then(stocks => {
            const select = document.getElementById('stock-select');
            select.innerHTML = '';
            stocks.forEach(stock => {
                const option = document.createElement('option');
                option.value = stock;
                option.textContent = stock;
                select.appendChild(option);
            });
        });

    document.getElementById('load-btn').addEventListener('click', () => {
        const symbol = document.getElementById('stock-select').value;
        if (!symbol) return;
        
        document.querySelector('main > article > header > h2').textContent = `Calculating paths for ${symbol}...`;

        fetch(`/api/data/${symbol}`)
            .then(res => res.json())
            .then(data => {
                if(data.error) {
                    alert(data.error);
                    return;
                }
                document.querySelector('main > article > header > h2').textContent = `${symbol} - Dynamic Regime`;
                renderCharts(data);
            });
    });
});

const chartOptions = {
    layout: {
        background: { type: 'solid', color: '#0f172a' },
        textColor: '#94a3b8',
    },
    grid: {
        vertLines: { color: '#334155' },
        horzLines: { color: '#334155' },
    },
    crosshair: {
        mode: 0, // Normal
    },
    rightPriceScale: {
        borderColor: '#334155',
    },
    timeScale: {
        borderColor: '#334155',
    },
};

function renderCharts(data) {
    if(priceChart) { priceChart.remove(); distanceChart.remove(); efficiencyChart.remove(); }

    const priceContainer = document.getElementById('chart-price');
    const distanceContainer = document.getElementById('chart-distance');
    const efficiencyContainer = document.getElementById('chart-efficiency');

    // Create charts - height and width will be updated by resize observer
    priceChart = LightweightCharts.createChart(priceContainer, chartOptions);
    distanceChart = LightweightCharts.createChart(distanceContainer, chartOptions);
    efficiencyChart = LightweightCharts.createChart(efficiencyContainer, chartOptions);

    priceSeries = priceChart.addLineSeries({ color: '#10B981', lineWidth: 2 });
    distanceSeries = distanceChart.addLineSeries({ color: '#F59E0B', lineWidth: 2 });
    efficiencySeries = efficiencyChart.addLineSeries({ color: '#3B82F6', lineWidth: 2 });

    const priceData = [];
    const distanceData = [];
    const effData = [];
    
    for(let i=0; i<data.dates.length; i++) {
        const t = data.dates[i];
        priceData.push({time: t, value: data.close[i]});
        
        if(data.distance_travelled[i] !== null) {
            distanceData.push({time: t, value: data.distance_travelled[i]});
            effData.push({time: t, value: data.efficiency_ratio[i]});
        }
    }

    priceSeries.setData(priceData);
    distanceSeries.setData(distanceData);
    efficiencySeries.setData(effData);
    
    efficiencySeries.createPriceLine({
        price: 0, color: '#9CA3AF', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '0'
    });
    efficiencySeries.createPriceLine({
        price: 0.3, color: '#10B981', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '+0.3'
    });
    efficiencySeries.createPriceLine({
        price: -0.3, color: '#EF4444', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '-0.3'
    });

    const total = priceData.length;
    if(total > 90) {
        priceChart.timeScale().setVisibleLogicalRange({ from: total - 90, to: total - 1 });
    } else {
        priceChart.timeScale().fitContent();
    }

    // SYNC CHARTS VISIBLE RANGE
    function getSyncHandler(sourceChart, targetCharts) {
        return (timeRange) => {
            if(!timeRange) return;
            targetCharts.forEach(targetChart => {
                const targetRange = targetChart.timeScale().getVisibleLogicalRange();
                if(targetRange === null || targetRange.from !== timeRange.from || targetRange.to !== timeRange.to) {
                    targetChart.timeScale().setVisibleLogicalRange(timeRange);
                }
            });
        };
    }

    const priceHandler = getSyncHandler(priceChart, [distanceChart, efficiencyChart]);
    const distHandler = getSyncHandler(distanceChart, [priceChart, efficiencyChart]);
    const effHandler = getSyncHandler(efficiencyChart, [priceChart, distanceChart]);

    priceChart.timeScale().subscribeVisibleLogicalRangeChange(priceHandler);
    distanceChart.timeScale().subscribeVisibleLogicalRangeChange(distHandler);
    efficiencyChart.timeScale().subscribeVisibleLogicalRangeChange(effHandler);

    // Sync Crosshairs
    function getCrosshairHandler(sourceChart, sourceSeries, targetCharts, targetSeriesList) {
        return (param) => {
            if (!param.time || param.point.x < 0 || param.point.y < 0) {
                targetCharts.forEach(chart => chart.clearCrosshairPosition());
                return;
            }
            
            // To sync crosshairs in lightweight charts perfectly we need the timestamp,
            // then we find the data point in the target series at that timestamp.
            // A simplified sync for crosshair is complex in standalone without direct API support for external crosshair setting.
            // Wait, we can use `chart.setCrosshairPosition` if it exists in v5.2, but otherwise time sync is enough.
        };
    }
    
    // Resize Observer to keep charts full width
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            if (entry.target === priceContainer) priceChart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
            if (entry.target === distanceContainer) distanceChart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
            if (entry.target === efficiencyContainer) efficiencyChart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
        }
    });
    
    resizeObserver.observe(priceContainer);
    resizeObserver.observe(distanceContainer);
    resizeObserver.observe(efficiencyContainer);
}
