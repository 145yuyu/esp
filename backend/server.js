/**
 * 城市公园环境监测系统 — 后端服务器
 * 全链路数据中转：ESP32 ← HTTP → Backend ← HTTP/WS → Frontend
 *
 * 启动: node server.js
 * 开发: node --watch server.js
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');

const { initWebSocket } = require('./websocket');
const { initDb, addLog, startCleanup, createCompatDb } = require('./db');
const dbModule = require('./db');
const sensorsRouter = require('./routes/sensors');
const alarmsRouter = require('./routes/alarms');
const statsRouter = require('./routes/stats');

const PORT = process.env.PORT || 3000;
const app = express();

// ---- 中间件 ----
app.use(cors());
app.use(express.json());

// 跳过 ngrok 免费版确认页面（直接展示内容）
app.use((_req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    next();
});

// 请求日志
app.use((req, _res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

// ---- API 路由 ----
app.use('/api/sensors', sensorsRouter);
app.use('/api/alarms', alarmsRouter);
app.use('/api/stats', statsRouter);

// ---- 健康检查 ----
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

// ---- 静态文件（生产环境：前端直接走后端） ----
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));
app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// ---- 启动 ----
async function start() {
    // 初始化数据库（sql.js WASM）
    const rawDb = await initDb();
    // 暴露兼容包装层给 stats.js 等模块的内联查询（db.prepare().get/all/run）
    dbModule.db = createCompatDb(rawDb);

    const server = http.createServer(app);

    // 初始化 WebSocket（复用 HTTP server）
    initWebSocket(server);

    // 定期清理旧传感器数据（每10分钟，保留7天）
    startCleanup(600000, 86400 * 7);

    server.listen(PORT, () => {
        const os = require('os');
        const ifaces = os.networkInterfaces();
        const ips = [];
        Object.values(ifaces).forEach(iface => {
            iface.forEach(addr => {
                if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
            });
        });

        console.log('');
        console.log('╔══════════════════════════════════════════════╗');
        console.log('║    城市公园环境监测系统 — 后端服务        ║');
        console.log('╠══════════════════════════════════════════════╣');
        console.log(`║   本机访问:  http://localhost:${PORT}           ║`);
        ips.forEach(ip => {
            const url = `http://${ip}:${PORT}`;
            console.log(`║   局域网:    ${url}`.padEnd(49) + '║');
        });
        console.log('╠══════════════════════════════════════════════╣');
        console.log('║   公网访问（任选其一）:                     ║');
        console.log('║   ① ngrok:  ngrok http ' + String(PORT) + '       (免费)    ║');
        console.log('║   ② 同一WiFi下直接用局域网地址             ║');
        console.log('║   ③ 部署到云服务器 (详见 deploy/)          ║');
        console.log('╚══════════════════════════════════════════════╝');
        console.log('');
        addLog('info', `服务器启动，端口 ${PORT}`);

        // 自动启动模拟数据
        if (process.argv.includes('--sim') || process.env.SIMULATE === '1') {
            startSimulation();
        }
    });
}

start().catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
});

// ---- 模拟数据生成器（无 ESP32 硬件时使用） ----
const ZONE_BASELINES = [
    { name: '入口广场', temp: 30.5, hum: 55, dust: 42, dust_peak: 58 },
    { name: '健身活动区', temp: 31.2, hum: 50, dust: 38, dust_peak: 50 },
    { name: '湖区周边', temp: 28.5, hum: 72, dust: 28, dust_peak: 38 },
    { name: '林荫步道', temp: 27.8, hum: 68, dust: 22, dust_peak: 32 },
];

function generateSimData() {
    const h = new Date().getHours();
    const hourFactor = Math.sin((h - 6) / 24 * Math.PI);
    const ns = () => (Math.random() - 0.5) * 2;

    return ZONE_BASELINES.map((base, i) => {
        let dust = base.dust + ns() * 5;
        if (h >= 7 && h <= 9) dust += 12;
        if (h >= 17 && h <= 19) dust += 8;
        return {
            node_id: i + 1, zone_id: i + 1, zone_name: base.name,
            temperature: Math.round((base.temp + hourFactor * 4 + ns()) * 10) / 10,
            humidity: Math.round(Math.max(20, Math.min(100, base.hum - hourFactor * 8 + ns() * 3)) * 10) / 10,
            dust_level: Math.round(Math.max(5, dust)),
            dust_peak: Math.round(Math.max(8, base.dust_peak + ns() * 8)),
            battery: Math.floor(65 + Math.random() * 35),
            timestamp: Date.now(),
        };
    });
}

// 无 ESP32 时自动生成模拟数据，每 2 秒通过 POST /api/sensors/ingest 写入
let simInterval = null;

function startSimulation() {
    simInterval = setInterval(() => {
        const data = generateSimData();
        const body = JSON.stringify({ nodes: data });

        const req = http.request({
            hostname: 'localhost', port: PORT,
            path: '/api/sensors/ingest',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }, (res) => {
            // 静默处理
        });
        req.on('error', () => {});
        req.write(body);
        req.end();
    }, 2000);
    console.log('[SIM] 模拟数据生成器已启动（2秒/次）');
}

// 模拟数据启动已集成到 async start() 中（数据库初始化完成后自动判断）
