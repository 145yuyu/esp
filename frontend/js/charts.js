/* ============================================================
   城市公园环境监测系统 — Charts Engine v3
   渐变填充 / 发光描边 / 悬浮交互 / 空状态占位
   ============================================================ */

// ---- 全局配色（匹配 CSS 设计系统） ----
const CHART_COLORS = ['#38bdf8', '#22c55e', '#f97316', '#a855f7'];
const CHART_COLORS_GLOW = ['rgba(56,189,248,0.45)', 'rgba(34,197,94,0.45)', 'rgba(249,115,22,0.45)', 'rgba(168,85,247,0.45)'];
const CHART_BG_SEMI = ['rgba(56,189,248,0.12)', 'rgba(34,197,94,0.10)', 'rgba(249,115,22,0.10)', 'rgba(168,85,247,0.10)'];

// ---- Chart.js 全局默认 ----
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#1c2d45';
Chart.defaults.font.family = "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(19, 29, 50, 0.95)';
Chart.defaults.plugins.tooltip.borderColor = '#2d4a6b';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.titleFont = { weight: 'bold', size: 13 };
Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.animation = { duration: 600, easing: 'easeOutQuart' };

// ---- Canvas 渐变工具 ----
function createGradient(ctx, colorTop, colorBottom) {
    const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    g.addColorStop(0, colorTop);
    g.addColorStop(1, colorBottom || 'transparent');
    return g;
}

// ==================== 仪表盘趋势图 ====================
let dashTrendChart = null;
function initDashTrendChart(ctxCanvas) {
    if (dashTrendChart) dashTrendChart.destroy();
    const ctx = ctxCanvas.getContext('2d');

    dashTrendChart = new Chart(ctxCanvas, {
        type: 'line',
        data: {
            labels: [],
            datasets: ZONES.map((z, i) => ({
                label: z.name,
                data: [],
                borderColor: CHART_COLORS[i],
                backgroundColor: createGradient(ctx, CHART_COLORS_GLOW[i], 'rgba(0,0,0,0)'),
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: CHART_COLORS[i],
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2,
                tension: 0.35,
                fill: true,
            })),
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { usePointStyle: true, pointStyleWidth: 8, padding: 16, font: { size: 11 } },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(28,45,69,0.4)' },
                    ticks: { maxTicksLimit: 8, font: { size: 10 }, color: '#5e6f85' },
                },
                y: {
                    grid: { color: 'rgba(28,45,69,0.4)' },
                    ticks: { font: { size: 10 }, color: '#5e6f85' },
                    beginAtZero: false,
                },
            },
        },
    });
}

let currentDashType = 'dust';
function getChartValue(type, h) {
    switch (type) {
        case 'dust': return h.dust;
        case 'temp': return h.temp;
        case 'humidity': return h.hum;
        case 'dust_peak': return h.dust_peak;
    }
}
function getChartUnit(type) {
    switch (type) {
        case 'dust': return '粉尘浓度 (ug/m³)';
        case 'temp': return 'Temperature (C)';
        case 'humidity': return 'Humidity (%)';
        case 'dust_peak': return '粉尘峰值 (ug/m³)';
    }
}

function updateDashTrendChart() {
    if (!dashTrendChart) return;
    const allLabels = [];
    const maxLen = 60;

    ZONES.forEach((z, i) => {
        const hist = historicalData[i + 1];
        hist.slice(-maxLen).forEach(h => {
            const label = fmtTime(h.ts);
            if (!allLabels.includes(label)) allLabels.push(label);
        });
    });

    dashTrendChart.data.labels = allLabels.slice(-maxLen);
    dashTrendChart.options.scales.y.title = {
        display: true, text: getChartUnit(currentDashType), color: '#94a3b8',
    };

    ZONES.forEach((z, i) => {
        const hist = historicalData[i + 1];
        dashTrendChart.data.datasets[i].data = hist.slice(-maxLen).map(h => getChartValue(currentDashType, h));
    });
    dashTrendChart.update('none');
}

// ==================== 仪表盘柱状图 ====================
let dashBarChart = null;
function initDashBarChart(ctxCanvas) {
    if (dashBarChart) dashBarChart.destroy();
    const ctx = ctxCanvas.getContext('2d');

    dashBarChart = new Chart(ctxCanvas, {
        type: 'bar',
        data: {
            labels: ZONES.map(z => z.name),
            datasets: [{
                label: '粉尘浓度 (ug/m³)',
                data: [],
                backgroundColor: ZONES.map((_, i) => {
                    const g = ctx.createLinearGradient(0, 0, 0, ctxCanvas.height);
                    g.addColorStop(0, CHART_COLORS[i] + '99');
                    g.addColorStop(1, CHART_COLORS[i] + '22');
                    return g;
                }),
                borderColor: CHART_COLORS,
                borderWidth: 1.5,
                borderRadius: 6,
                borderSkipped: false,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` 粉尘浓度: ${ctx.parsed.y} ug/m³`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#94a3b8' },
                },
                y: {
                    grid: { color: 'rgba(28,45,69,0.4)' },
                    ticks: { font: { size: 10 }, color: '#5e6f85' },
                },
            },
        },
    });
}

function updateDashBarChart() {
    if (!dashBarChart) return;
    const vals = ZONES.map((z, i) => {
        const hist = historicalData[i + 1];
        return hist.length > 0 ? hist[hist.length - 1].dust : 0;
    });
    dashBarChart.data.datasets[0].data = vals;
    dashBarChart.update('none');
}

// ==================== 历史数据图表 ====================
let histChart = null;
function initHistChart(ctxCanvas) {
    if (histChart) histChart.destroy();
    const ctx = ctxCanvas.getContext('2d');

    histChart = new Chart(ctxCanvas, {
        type: 'line',
        data: {
            labels: [],
            datasets: ZONES.map((z, i) => ({
                label: z.name, data: [],
                borderColor: CHART_COLORS[i],
                backgroundColor: createGradient(ctx, CHART_COLORS_GLOW[i], 'rgba(0,0,0,0)'),
                borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
                pointHoverBackgroundColor: CHART_COLORS[i],
                pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
                tension: 0.25, fill: true, spanGaps: true,
            })),
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { usePointStyle: true, pointStyleWidth: 8, padding: 16, font: { size: 11 } },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(28,45,69,0.4)' },
                    ticks: { maxTicksLimit: 12, font: { size: 10 }, color: '#5e6f85' },
                },
                y: {
                    grid: { color: 'rgba(28,45,69,0.4)' },
                    ticks: { font: { size: 10 }, color: '#5e6f85' },
                },
            },
        },
    });
}

function queryHistChart(nodeFilter, metric, startTs, endTs, preFetchedRows) {
    if (!histChart) return;

    // Use pre-fetched backend rows if available, otherwise read local historicalData
    let flatRows;
    if (preFetchedRows) {
        flatRows = preFetchedRows.filter(r => r.time >= startTs && r.time <= endTs);
    } else {
        flatRows = [];
        ZONES.forEach((z, i) => {
            if (nodeFilter !== 'all' && (i + 1) !== parseInt(nodeFilter)) return;
            historicalData[i + 1].forEach(h => {
                if (h.ts >= startTs && h.ts <= endTs) {
                    flatRows.push({ time: h.ts, nodeId: i + 1, temp: h.temp, hum: h.hum, dust: h.dust, dust_peak: h.dust_peak });
                }
            });
        });
    }

    // Collect labels and build datasets from flatRows
    const allLabels = new Set();
    const activeNodes = nodeFilter === 'all'
        ? [1, 2, 3, 4]
        : [parseInt(nodeFilter)];

    flatRows.forEach(r => { allLabels.add(fmtTime(r.time)); });
    const sortedLabels = [...allLabels].sort();

    histChart.data.labels = sortedLabels;
    histChart.data.datasets = activeNodes.map((nodeId, i) => {
        const histMap = {};
        flatRows
            .filter(r => r.nodeId === nodeId)
            .forEach(r => { histMap[fmtTime(r.time)] = getChartValue(metric, r); });
        const actualIdx = nodeId - 1;
        return {
            label: ZONES[actualIdx].name,
            data: sortedLabels.map(l => histMap[l] || null),
            borderColor: CHART_COLORS[actualIdx],
            backgroundColor: CHART_BG_SEMI[actualIdx],
            borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
            pointHoverBackgroundColor: CHART_COLORS[actualIdx],
            pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
            tension: 0.25, fill: true, spanGaps: true,
        };
    });

    histChart.options.scales.y.title = { display: true, text: getChartUnit(metric), color: '#94a3b8' };
    histChart.update();
}

// ==================== 分区对比柱状图 ====================
let analyticsTempBar = null, analyticsSmokeBar = null, analyticsRadar = null;

function initAnalyticsTempBar(ctxCanvas) {
    if (analyticsTempBar) analyticsTempBar.destroy();
    analyticsTempBar = new Chart(ctxCanvas, {
        type: 'bar',
        data: {
            labels: ZONES.map(z => z.name),
            datasets: [
                {
                    label: 'Avg Temp', data: [],
                    backgroundColor: '#f9731699', borderColor: '#f97316',
                    borderWidth: 1.5, borderRadius: 6, borderSkipped: false,
                },
                {
                    label: 'Max Temp', data: [],
                    backgroundColor: '#ef444499', borderColor: '#ef4444',
                    borderWidth: 1.5, borderRadius: 6, borderSkipped: false,
                },
                {
                    label: 'Min Temp', data: [],
                    backgroundColor: '#38bdf899', borderColor: '#38bdf8',
                    borderWidth: 1.5, borderRadius: 6, borderSkipped: false,
                },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { font: { size: 10 }, usePointStyle: true, pointStyleWidth: 8, padding: 12 },
                },
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8' } },
                y: {
                    grid: { color: 'rgba(28,45,69,0.4)' },
                    title: { display: true, text: 'Temp (C)', color: '#94a3b8' },
                    ticks: { font: { size: 10 }, color: '#5e6f85' },
                },
            },
        },
    });
}

function initAnalyticsSmokeBar(ctxCanvas) {
    if (analyticsSmokeBar) analyticsSmokeBar.destroy();
    analyticsSmokeBar = new Chart(ctxCanvas, {
        type: 'bar',
        data: {
            labels: ZONES.map(z => z.name),
            datasets: [
                {
                    label: '平均粉尘浓度', data: [],
                    backgroundColor: '#a855f799', borderColor: '#a855f7',
                    borderWidth: 1.5, borderRadius: 6, borderSkipped: false,
                },
                {
                    label: '最高粉尘浓度', data: [],
                    backgroundColor: '#ef444499', borderColor: '#ef4444',
                    borderWidth: 1.5, borderRadius: 6, borderSkipped: false,
                },
                {
                    label: '最低粉尘浓度', data: [],
                    backgroundColor: '#22c55e99', borderColor: '#22c55e',
                    borderWidth: 1.5, borderRadius: 6, borderSkipped: false,
                },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { font: { size: 10 }, usePointStyle: true, pointStyleWidth: 8, padding: 12 },
                },
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8' } },
                y: {
                    grid: { color: 'rgba(28,45,69,0.4)' },
                    title: { display: true, text: '粉尘浓度 (ug/m³)', color: '#94a3b8' },
                    ticks: { font: { size: 10 }, color: '#5e6f85' },
                },
            },
        },
    });
}

function initAnalyticsRadar(ctxCanvas) {
    if (analyticsRadar) analyticsRadar.destroy();
    analyticsRadar = new Chart(ctxCanvas, {
        type: 'radar',
        data: {
            labels: ['Temp Comfort', 'Hum Comfort', 'Air Quality', 'Stability', 'Signal'],
            datasets: ZONES.map((z, i) => ({
                label: z.name, data: [],
                borderColor: CHART_COLORS[i],
                backgroundColor: CHART_BG_SEMI[i],
                borderWidth: 2.5,
                pointRadius: 4,
                pointBackgroundColor: CHART_COLORS[i],
                pointBorderColor: '#fff',
                pointBorderWidth: 1,
                pointHoverRadius: 6,
            })),
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { font: { size: 10 }, usePointStyle: true, pointStyleWidth: 8, padding: 12 },
                },
            },
            scales: {
                r: {
                    min: 0, max: 100,
                    grid: { color: 'rgba(28,45,69,0.6)' },
                    angleLines: { color: 'rgba(28,45,69,0.6)' },
                    pointLabels: { color: '#94a3b8', font: { size: 10 } },
                    ticks: { display: false, stepSize: 20 },
                },
            },
        },
    });
}

function updateAnalyticsCharts() {
    const stats = ZONES.map((_, i) => getZoneStats(i + 1)).filter(Boolean);

    if (analyticsTempBar) {
        analyticsTempBar.data.datasets[0].data = stats.map(s => s.temp.avg);
        analyticsTempBar.data.datasets[1].data = stats.map(s => s.temp.max);
        analyticsTempBar.data.datasets[2].data = stats.map(s => s.temp.min);
        analyticsTempBar.update('none');
    }
    if (analyticsSmokeBar) {
        analyticsSmokeBar.data.datasets[0].data = stats.map(s => s.dust.avg);
        analyticsSmokeBar.data.datasets[1].data = stats.map(s => s.dust.max);
        analyticsSmokeBar.data.datasets[2].data = stats.map(s => s.dust.min);
        analyticsSmokeBar.update('none');
    }
    if (analyticsRadar) {
        analyticsRadar.data.datasets.forEach((ds, i) => {
            if (!stats[i]) return;
            const s = stats[i];
            const tempScore = Math.max(0, 100 - Math.abs(s.temp.avg - 25) * 5);
            const humScore = Math.max(0, 100 - Math.abs(s.hum.avg - 55) * 2);
            const airScore = Math.max(0, 100 - s.dust.avg);
            const stability = Math.max(0, 100 - (s.temp.max - s.temp.min) * 10);
            const commQuality = nodeStates[i].online ? Math.max(0, 95 - nodeStates[i].timeoutCount * 10) : 20;
            ds.data = [
                Math.round(tempScore), Math.round(humScore),
                Math.round(airScore), Math.round(stability), Math.round(commQuality),
            ];
        });
        analyticsRadar.update('none');
    }
}

// ==================== 节点管理页仪表盘 ====================
function createNodeGauge(canvas, value, max, label, color) {
    // Destroy existing chart on this canvas
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    const pct = Math.min(1, Math.max(0, value / max));
    new Chart(canvas, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [pct, 1 - pct],
                backgroundColor: [color, '#1a2438'],
                borderWidth: 0,
                circumference: 270,
                rotation: 225,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: true,
            cutout: '78%',
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: { animateRotate: true, duration: 800, easing: 'easeOutQuart' },
        },
        plugins: [{
            id: 'gaugeText',
            afterDraw(chart) {
                const { ctx, width, height } = chart;
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#e8edf4';
                ctx.font = 'bold 24px Cascadia Code, Fira Code, Consolas, monospace';
                ctx.fillText(value, width / 2, height / 2 - 4);
                ctx.fillStyle = '#94a3b8';
                ctx.font = '10px Segoe UI, PingFang SC, sans-serif';
                ctx.fillText(label, width / 2, height / 2 + 18);
                ctx.restore();
            },
        }],
    });
}
