/* ============================================================
   城市公园环境监测系统 — Data Engine v2.0
   模拟数据 + localStorage 持久化 + 完整业务逻辑
   ============================================================ */

// ---- 区域配置 ----
const ZONES = [
    { id: 1, name: '入口广场', icon: '', desc: '公园主入口区域，邻近城市道路，人流车流密集',
      lat: 30.5728, lng: 104.0668 },
    { id: 2, name: '健身活动区', icon: '', desc: '户外健身器材集中区，市民活动频繁',
      lat: 30.5735, lng: 104.0680 },
    { id: 3, name: '湖区周边', icon: '', desc: '人工湖沿岸带，湿度较高，生态环境良好',
      lat: 30.5715, lng: 104.0675 },
    { id: 4, name: '林荫步道', icon: '', desc: '公园绿化核心区，植被茂密，空气清新',
      lat: 30.5740, lng: 104.0660 },
];

// ---- 粉尘浓度等级 (ug/m³) ----
const DUST_LEVELS = [
    { max: 35,  label: '优', cls: 'pm-good', color: '#22c55e' },
    { max: 75,  label: '良', cls: 'pm-moderate', color: '#eab308' },
    { max: 115, label: '轻度污染', cls: 'pm-unhealthy', color: '#f97316' },
    { max: 150, label: '中度污染', cls: 'pm-very-unhealthy', color: '#ef4444' },
    { max: 999, label: '重度污染', cls: 'pm-hazardous', color: '#b91c1c' },
];

function getDustLevel(dust) {
    return DUST_LEVELS.find(l => dust <= l.max) || DUST_LEVELS[4];
}

// ---- 告警等级 ----
const ALERT_LEVEL_MAP = { 0: 'normal', 1: 'warning', 2: 'danger', 3: 'critical' };
const ALERT_LABELS = { normal: '正常', warning: '警告', danger: '危险', critical: '严重' };

// ---- 区域基线 ----
const ZONE_BASELINES = {
    1: { temp: 30.5, hum: 55, dust: 42, dust_peak: 58 },
    2: { temp: 31.2, hum: 50, dust: 38, dust_peak: 50 },
    3: { temp: 28.5, hum: 72, dust: 28, dust_peak: 38 },
    4: { temp: 27.8, hum: 68, dust: 22, dust_peak: 32 },
};

// ---- 全局状态 ----
let nodeStates = [];
let alertHistory = [];
let operationLogs = [];   // 系统运行日志
let alertArchive = [];    // 已处理告警归档

// historicalData: { nodeId: [{temp, hum, dust, dust_peak, ts}] }
let historicalData = {};
const MAX_HISTORY_POINTS = 1440; // 24小时（每分钟1条，实际2s一条会更密集）

// ---- 系统配置（可持久化） ----
let systemConfig = {
    dustWarning: 75,
    dustDanger: 115,
    tempWarning: 38,
    humWarning: 95,
    refreshInterval: 2,
    historyRetention: 86400,  // 秒
    heartbeatInterval: 10,
    filterWindow: 5,
    nodeCount: 4,
};

// ---- 滑动窗口滤波 ----
class MovingAverageFilter {
    constructor(size = 5) {
        this.buf = new Array(size).fill(0);
        this.idx = 0; this.count = 0; this.size = size;
    }
    update(val) {
        this.buf[this.idx] = val;
        this.idx = (this.idx + 1) % this.size;
        if (this.count < this.size) this.count++;
        return this.buf.slice(0, this.count).reduce((a, b) => a + b, 0) / this.count;
    }
    reset() { this.buf.fill(0); this.idx = 0; this.count = 0; }
}

const filters = {};

// ---- 工具 ----
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function round1(v) { return Math.round(v * 10) / 10; }
function now() { return Date.now(); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString('zh-CN'); }
function fmtDateTime(ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }

// ---- 模拟传感器数据 ----
function generateSensorData(nodeId) {
    const base = ZONE_BASELINES[nodeId];
    const h = new Date().getHours();
    const hourFactor = Math.sin((h - 6) / 24 * Math.PI);
    const noise = () => (Math.random() - 0.5) * 2;

    let temp = base.temp + hourFactor * 4 + noise();
    let hum = base.hum - hourFactor * 8 + noise() * 3;
    let dust = base.dust + noise() * 5;
    let dust_peak = base.dust_peak + noise() * 8;

    // 早高峰（7-9点）
    if (h >= 7 && h <= 9) { dust += 12; dust_peak += 15; }
    // 傍晚（17-19）
    if (h >= 17 && h <= 19) { dust += 8; dust_peak += 10; }
    // 偶尔随机波动（传感器抖动）
    if (Math.random() < 0.03) { dust += Math.random() * 25; }

    hum = Math.max(20, Math.min(100, hum));
    dust = Math.round(Math.max(5, dust));
    dust_peak = Math.round(Math.max(8, dust_peak));

    return { temp: round1(temp), hum: round1(hum), dust, dust_peak };
}

// ---- 告警检测 ----
function checkAlerts(nodeId, data) {
    const alerts = [];
    const cfg = systemConfig;

    if (data.dust > cfg.dustDanger) {
        alerts.push({ level: 3, type: 'dust', msg: `粉尘浓度严重超标: ${data.dust} ug/m³`, icon: '' });
    } else if (data.dust > cfg.dustWarning) {
        alerts.push({ level: 1, type: 'dust', msg: `粉尘浓度偏高: ${data.dust} ug/m³`, icon: '' });
    }
    if (data.temp > cfg.tempWarning) {
        alerts.push({ level: 2, type: 'temp', msg: `高温预警: ${data.temp.toFixed(1)}°C`, icon: '' });
    }
    if (data.hum > cfg.humWarning) {
        alerts.push({ level: 2, type: 'hum', msg: `湿度过高: ${data.hum.toFixed(1)}%`, icon: '' });
    }
    return alerts;
}

// ---- 心跳故障检测 ----;
function heartbeatCheck() {
    const now = Date.now();
    nodeStates.forEach(node => {
        if (!node.online) return;
        if (Math.random() < 0.015) {
            node.timeoutCount++;
            if (node.timeoutCount >= 3) {
                node.online = false;
                const entry = {
                    time: now, nodeId: node.id, zoneName: node.zone.name,
                    level: 'fault', type: 'offline',
                    msg: `节点${node.id}（${node.zone.name}）通信超时，判定离线`,
                    icon: '', handled: false,
                };
                alertHistory.unshift(entry);
                alertArchive.push({ ...entry });
                addLog('warn', `节点${node.id} 离线（连续${node.timeoutCount}次无响应）`);
            }
        } else {
            if (node.timeoutCount > 0) {
                addLog('info', `节点${node.id} 通信恢复`);
            }
            node.timeoutCount = 0;
            node.online = true;
            node.lastResponse = now;
        }
    });
    // 自动恢复
    nodeStates.forEach(node => {
        if (!node.online && Math.random() < 0.04) {
            node.online = true;
            node.timeoutCount = 0;
            node.lastResponse = now;
            const entry = {
                time: now, nodeId: node.id, zoneName: node.zone.name,
                level: 'info', type: 'recovery',
                msg: `节点${node.id}（${node.zone.name}）已恢复在线`,
                icon: '', handled: false,
            };
            alertHistory.unshift(entry);
            alertArchive.push({ ...entry });
            addLog('info', `节点${node.id} 自动恢复在线`);
        }
    });
}

// ---- 运行日志 ----
function addLog(level, msg) {
    operationLogs.unshift({ time: now(), level, msg });
    if (operationLogs.length > 500) operationLogs.length = 500;
}

// ---- 更新所有节点（默认：数据源驱动） ----
function updateAllNodes() {
    // 优先使用数据源抽象层（支持模拟/HTTP/WebSocket切换）
    if (typeof fetchFromDataSource === 'function' && dataSource) {
        fetchFromDataSource();
        return;
    }
    // 降级：直接模拟（向后兼容）
    _updateAllNodesLegacy();
}

// 旧的直接模拟方式（仅作为降级使用）
function _updateAllNodesLegacy() {
    ZONES.forEach((z, i) => {
        const nodeId = i + 1;
        const node = nodeStates[i];
        if (!node.online) return;
        const raw = generateSensorData(nodeId);
        const f = filters[nodeId];
        const data = {
            node_id: nodeId, zone_id: z.id,
            temperature: f.temp.update(raw.temp),
            humidity: f.hum.update(raw.hum),
            dust_level: f.dust.update(raw.dust),
            dust_peak: round1(raw.dust_peak),
            timestamp: now(),
            battery: Math.floor(65 + Math.random() * 35),
        };
        node.currentData = data;
        const point = { temp: data.temperature, hum: data.humidity, dust: data.dust_level, dust_peak: data.dust_peak, ts: data.timestamp };
        historicalData[nodeId].push(point);
        const cutoff = now() - systemConfig.historyRetention * 1000;
        while (historicalData[nodeId].length > 0 && historicalData[nodeId][0].ts < cutoff) historicalData[nodeId].shift();
        while (historicalData[nodeId].length > MAX_HISTORY_POINTS) historicalData[nodeId].shift();
        const alerts = checkAlerts(nodeId, data);
        alerts.forEach(a => {
            const entry = { time: now(), nodeId, zoneName: z.name, level: ALERT_LEVEL_MAP[a.level], type: a.type, msg: `[${z.name}] ${a.msg}`, icon: a.icon, handled: false };
            alertHistory.unshift(entry); alertArchive.push({ ...entry });
        });
    });
    heartbeatCheck();
}

// ---- 分区统计 ----
function getZoneStats(nodeId) {
    const hist = historicalData[nodeId];
    if (!hist || hist.length === 0) return null;
    const temps = hist.map(h => h.temp);
    const hums = hist.map(h => h.hum);
    const dusts = hist.map(h => h.dust);
    return {
        temp: { avg: round1(avg(temps)), max: round1(Math.max(...temps)), min: round1(Math.min(...temps)) },
        hum: { avg: round1(avg(hums)), max: round1(Math.max(...hums)), min: round1(Math.min(...hums)) },
        dust: { avg: round1(avg(dusts)), max: Math.round(Math.max(...dusts)), min: Math.round(Math.min(...dusts)) },
        count: hist.length,
    };
}

// ---- CSV 导出 ----
function exportCSV(data, filename) {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const csv = [keys.join(','), ...data.map(row => keys.map(k => {
        const v = row[k];
        if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) return `"${v.replace(/"/g, '""')}"`;
        return v;
    }).join(','))].join('\n');

    const BOM = '﻿';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function exportAllHistoryCSV() {
    const rows = [];
    ZONES.forEach((z, i) => {
        const hist = historicalData[i + 1];
        hist.forEach(h => {
            rows.push({
                时间: fmtDateTime(h.ts), 节点ID: i + 1, 区域: z.name,
                温度: h.temp, 湿度: h.hum, '粉尘浓度': h.dust, 粉尘峰值: h.dust_peak,
            });
        });
    });
    exportCSV(rows, `环境监测历史数据_${fmtDate(now())}.csv`);
}

function exportAlarmsCSV() {
    exportCSV(alertArchive.map(a => ({
        时间: fmtDateTime(a.time), 级别: a.level, 节点: a.nodeId,
        区域: a.zoneName, 内容: a.msg, 已处理: a.handled ? '是' : '否',
    })), `告警记录_${fmtDate(now())}.csv`);
}

function exportLogsCSV() {
    exportCSV(operationLogs.map(l => ({
        时间: fmtDateTime(l.time), 级别: l.level, 内容: l.msg,
    })), `运行日志_${fmtDate(now())}.csv`);
}

// ---- localStorage 持久化 ----
function saveState() {
    try {
        const state = {
            historicalData,
            alertArchive: alertArchive.slice(0, 500),
            operationLogs: operationLogs.slice(0, 500),
            systemConfig,
        };
        localStorage.setItem('park_monitor_state', JSON.stringify(state));
    } catch (e) { /* quota exceeded, ignore */ }
}

function loadState() {
    try {
        const raw = localStorage.getItem('park_monitor_state');
        if (raw) {
            const state = JSON.parse(raw);
            if (state.historicalData) historicalData = state.historicalData;
            if (state.alertArchive) alertArchive = state.alertArchive;
            if (state.operationLogs) operationLogs = state.operationLogs;
            if (state.systemConfig) systemConfig = { ...systemConfig, ...state.systemConfig };
        }
    } catch (e) { /* ignore */ }
}

function clearAllData() {
    ZONES.forEach((_, i) => { historicalData[i + 1] = []; });
    alertArchive = [];
    alertHistory = [];
    operationLogs = [];
    localStorage.removeItem('park_monitor_state');
    addLog('info', '所有历史数据已清除');
}

// ---- 自动保存（每30秒） ----
let autoSaveInterval = null;
function startAutoSave() {
    autoSaveInterval = setInterval(saveState, 30000);
}

// ---- 初始化 ----
async function initDataEngine() {
    // 加载持久化数据
    loadState();

    // 如果没历史数据，初始化空数组
    ZONES.forEach((_, i) => {
        if (!historicalData[i + 1]) historicalData[i + 1] = [];
    });

    // 初始化节点状态
    nodeStates = ZONES.map((z, i) => {
        const existingData = historicalData[i + 1];
        const lastData = existingData && existingData.length > 0
            ? existingData[existingData.length - 1] : null;
        return {
            id: i + 1, zone: z, online: true,
            timeoutCount: 0, lastResponse: now(),
            currentData: lastData ? {
                node_id: i + 1, zone_id: z.id,
                temperature: lastData.temp, humidity: lastData.hum,
                dust_level: lastData.dust, dust_peak: lastData.dust_peak,
                timestamp: lastData.ts, battery: 85,
            } : null,
        };
    });

    // 初始化滤波器
    ZONES.forEach((_, i) => {
        const id = i + 1;
        filters[id] = {
            temp: new MovingAverageFilter(systemConfig.filterWindow),
            hum: new MovingAverageFilter(systemConfig.filterWindow),
            dust: new MovingAverageFilter(systemConfig.filterWindow),
        };
    });

    alertHistory = alertArchive.slice(0, 50);

    // 初始化数据源（模拟 / HTTP / WebSocket）
    await initDataSource();

    startAutoSave();
    addLog('info', `系统初始化完成，数据源: ${dataSource ? dataSource.name : '未知'}`);
}

// ---- 生成预填充历史数据（首次加载） ----
function generateInitialHistory() {
    let hasData = false;
    ZONES.forEach((_, i) => { if (historicalData[i + 1] && historicalData[i + 1].length > 0) hasData = true; });
    if (hasData) return; // 已有持久化数据，跳过

    const nowTs = now();
    for (let t = nowTs - 3600000; t <= nowTs; t += 60000) { // 过去1小时，每分钟1条
        ZONES.forEach((_, i) => {
            const nodeId = i + 1;
            const raw = generateSensorData(nodeId);
            historicalData[nodeId].push({
                temp: raw.temp, hum: raw.hum,
                dust: raw.dust, dust_peak: raw.dust_peak, ts: t,
            });
        });
    }
    addLog('info', '已生成初始历史数据（过去1小时）');
}
