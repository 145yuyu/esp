/**
 * 传感器数据 API
 * GET  /api/sensors/latest     — 最新数据
 * GET  /api/sensors/history    — 历史查询
 * POST /api/sensors/ingest     — ESP32 中心节点上报数据
 */

const express = require('express');
const router = express.Router();
const { stmts, insertSensorData, insertAlarm, addLog } = require('../db');
const { broadcastSensorData, broadcastAlert, broadcastNodeStatus } = require('../websocket');

// 预警阈值 (GP2Y1014AU 粉尘传感器 + DHT22)
const THRESHOLDS = {
    dust_warning: 75,    // 粉尘浓度警告阈值 ug/m³
    dust_danger: 115,     // 粉尘浓度危险阈值 ug/m³
    temp_warning: 38,     // 高温预警阈值 °C
    hum_warning: 95,      // 高湿预警阈值 %
};

// 区域名映射
const ZONE_NAMES = ['', '入口广场', '健身活动区', '湖区周边', '林荫步道'];

function checkAlerts(node) {
    const alerts = [];
    const dust = node.dust_level;
    if (dust > THRESHOLDS.dust_danger) {
        alerts.push({ level: 'critical', type: 'dust', msg: `粉尘浓度严重超标: ${dust} ug/m³` });
    } else if (dust > THRESHOLDS.dust_warning) {
        alerts.push({ level: 'warning', type: 'dust', msg: `粉尘浓度偏高: ${dust} ug/m³` });
    }
    if (node.temperature > THRESHOLDS.temp_warning) {
        alerts.push({ level: 'danger', type: 'temp', msg: `高温预警: ${node.temperature.toFixed(1)}°C` });
    }
    if (node.humidity > THRESHOLDS.hum_warning) {
        alerts.push({ level: 'danger', type: 'hum', msg: `湿度过高: ${node.humidity.toFixed(1)}%` });
    }
    return alerts;
}

// GET /api/sensors/latest — 所有节点最新数据
router.get('/latest', (req, res) => {
    const rows = stmts.latestRecords.all();
    res.json({ success: true, data: rows, timestamp: Date.now() });
});

// GET /api/sensors/history — 历史查询
router.get('/history', (req, res) => {
    const { node_id, start, end, limit } = req.query;
    const startTs = parseInt(start) || Date.now() - 3600000;
    const endTs = parseInt(end) || Date.now();
    const maxLimit = Math.min(parseInt(limit) || 500, 2000);
    const rows = stmts.queryRecords(node_id || 'all', startTs, endTs, maxLimit);
    res.json({ success: true, data: rows, count: rows.length });
});

// POST /api/sensors/ingest — ESP32 中心节点上报数据
router.post('/ingest', (req, res) => {
    const body = req.body;
    const nodes = body.nodes || (Array.isArray(body) ? body : [body]);
    const now = Date.now();

    if (!Array.isArray(nodes) || nodes.length === 0) {
        return res.status(400).json({ success: false, error: '请求体需包含 nodes 数组' });
    }

    const results = [];
    const allAlerts = [];

    nodes.forEach(node => {
        node.timestamp = node.timestamp || now;
        node.zone_name = node.zone_name || ZONE_NAMES[node.zone_id] || `区域${node.zone_id}`;

        // 存数据库
        const result = insertSensorData(node);
        results.push({ node_id: node.node_id, id: result.lastInsertRowid });

        // 更新节点在线状态
        stmts.upsertNodeStatus.run({
            node_id: node.node_id,
            zone_name: node.zone_name,
            online: 1,
            last_seen: now,
            battery: node.battery || 0,
        });

        // 告警检测
        const alerts = checkAlerts(node);
        alerts.forEach(a => {
            insertAlarm(node.node_id, node.zone_name, a.level, a.type, a.msg, now);
            allAlerts.push({ node_id: node.node_id, zone_name: node.zone_name, ...a });
        });
    });

    // WebSocket 广播
    broadcastSensorData(nodes);
    if (allAlerts.length > 0) {
        allAlerts.forEach(a => broadcastAlert(a));
    }

    const statuses = stmts.allNodeStatus.all();
    broadcastNodeStatus(statuses);

    addLog('info', `收到 ${nodes.length} 个节点数据，触发 ${allAlerts.length} 条告警`);

    res.json({
        success: true,
        ingested: results.length,
        alerts_triggered: allAlerts.length,
        alerts: allAlerts,
        timestamp: now,
    });
});

module.exports = router;
