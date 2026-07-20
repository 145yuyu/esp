/**
 * WebSocket 实时推送服务
 * 与前端保持长连接，推送实时传感器数据和告警
 */

const { WebSocketServer } = require('ws');

let wss = null;
const clients = new Set();

function initWebSocket(httpServer) {
    wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress;
        clients.add(ws);
        console.log(`[WS] 客户端连接 (${ip})，当前在线: ${clients.size}`);

        ws.on('close', () => {
            clients.delete(ws);
            console.log(`[WS] 客户端断开 (${ip})，当前在线: ${clients.size}`);
        });

        ws.on('error', (err) => {
            clients.delete(ws);
        });

        // 发送欢迎消息
        ws.send(JSON.stringify({
            type: 'connected',
            message: '城市公园环境监测系统 — 实时数据通道已建立',
            timestamp: Date.now(),
        }));
    });

    console.log('[WS] WebSocket 服务已启动 (path: /ws)');
    return wss;
}

// 广播传感器数据给所有前端客户端
function broadcastSensorData(data) {
    if (!wss || clients.size === 0) return;
    const msg = JSON.stringify({ type: 'sensor_update', data, timestamp: Date.now() });
    clients.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
    });
}

// 广播告警
function broadcastAlert(alert) {
    if (!wss || clients.size === 0) return;
    const msg = JSON.stringify({ type: 'alert', data: alert, timestamp: Date.now() });
    clients.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
    });
}

// 广播节点状态变化
function broadcastNodeStatus(statuses) {
    if (!wss || clients.size === 0) return;
    const msg = JSON.stringify({ type: 'node_status', data: statuses, timestamp: Date.now() });
    clients.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
    });
}

module.exports = { initWebSocket, broadcastSensorData, broadcastAlert, broadcastNodeStatus };
