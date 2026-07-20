/* ============================================================
   数据源抽象层 — Data Source Abstraction Layer
   支持模式：
     - 'backend'    : 从后端 API 拉取（默认，相对路径，走ngrok/局域网皆可）
     - 'simulation' : 前端本地生成模拟数据（无需后端/无网络）
     - 'http'       : 直连 ESP32 中心节点 HTTP API
     - 'websocket'  : 直连 ESP32 中心节点 WebSocket 推送
   ============================================================ */

// ---- 数据源接口 ----
// 所有数据源必须实现：
//   init()          - 初始化
//   fetch(callback) - 获取数据，调用 callback(nodeDataArray)
//   close()         - 关闭连接
//
// callback 收到的数据格式：
// [
//   { node_id: 1, zone_id: 1, temperature: 30.5, humidity: 55.0,
//     dust_level: 42, dust_peak: 58, timestamp: 1700000000000, battery: 85 },
//   ...
// ]

// ==================== 0. 后端数据源（默认，走相对路径） ====================
class BackendDataSource {
    constructor() {
        this.name = '后端API';
        this.type = 'backend';
        this.ws = null;
        this.latestData = [];
        this.wsConnected = false;
    }

    init() {
        addLog('info', '数据源: 后端 API 模式（相对路径，支持 ngrok/局域网）');
        this._connectWS();
        return Promise.resolve(true);
    }

    _connectWS() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${location.host}/ws`;
        try {
            this.ws = new WebSocket(wsUrl);
            this.ws.onopen = () => {
                this.wsConnected = true;
                addLog('info', 'WebSocket 已连接后端实时推送');
            };
            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'sensor_update' && msg.data) {
                        this.latestData = (Array.isArray(msg.data) ? msg.data : [msg.data]).map(d => ({
                            node_id: d.node_id, zone_id: d.zone_id,
                            temperature: parseFloat(d.temperature || 0),
                            humidity: parseFloat(d.humidity || 0),
                            dust_level: parseInt(d.dust_level || 0),
                            dust_peak: parseInt(d.dust_peak || 0),
                            timestamp: d.timestamp || Date.now(),
                            battery: parseInt(d.battery || 100),
                            online: true,
                        }));
                    }
                } catch (e) { /* ignore parse errors */ }
            };
            this.ws.onclose = () => {
                this.wsConnected = false;
                // 5秒后重连
                setTimeout(() => this._connectWS(), 5000);
            };
            this.ws.onerror = () => { this.wsConnected = false; };
        } catch (e) {
            this.wsConnected = false;
        }
    }

    async fetch(callback) {
        // 优先用 WebSocket 缓存（实时性最好）
        if (this.latestData.length > 0 && this.wsConnected) {
            callback(this.latestData);
            return;
        }
        // 降级：HTTP 轮询
        try {
            const resp = await fetch('/api/sensors/latest');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            const nodes = json.data || [];
            const normalized = nodes.map(d => ({
                node_id: d.node_id, zone_id: d.zone_id,
                temperature: d.temperature, humidity: d.humidity,
                dust_level: d.dust_level, dust_peak: d.dust_peak || 0,
                timestamp: d.timestamp || Date.now(),
                battery: d.battery || 100, online: true,
            }));
            callback(normalized);
        } catch (e) {
            // 后端不可达，返回空数据
            callback([]);
        }
    }

    // 查询后端 SQLite 历史数据
    async fetchHistory(nodeFilter, startTs, endTs, limit = 500) {
        try {
            const params = new URLSearchParams({
                start: startTs, end: endTs, limit: String(limit),
            });
            if (nodeFilter && nodeFilter !== 'all') params.set('node_id', nodeFilter);

            const resp = await fetch('/api/sensors/history?' + params.toString());
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            const rows = json.data || [];

            return rows.map(r => ({
                time: r.timestamp, nodeId: r.node_id,
                zoneName: r.zone_name || '',
                temp: r.temperature, hum: r.humidity,
                dust: r.dust_level, dust_peak: r.dust_peak || 0,
            }));
        } catch (e) {
            console.warn('fetchHistory failed, falling back to local data', e.message);
            return null;  // caller should fall back to local historicalData
        }
    }

    close() {
        if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    }
}

// ==================== 1. 模拟数据源 ====================
class SimulationDataSource {
    constructor() {
        this.name = '模拟数据';
        this.type = 'simulation';
    }

    init() {
        addLog('info', '数据源: 模拟模式（本地生成传感器数据）');
        return Promise.resolve();
    }

    // 从本地 historicalData 读取历史（模拟模式）
    async fetchHistory(nodeFilter, startTs, endTs, _limit) {
        const rows = [];
        ZONES.forEach((z, i) => {
            if (nodeFilter && nodeFilter !== 'all' && (i + 1) !== parseInt(nodeFilter)) return;
            const hist = historicalData[i + 1] || [];
            hist.forEach(h => {
                if (h.ts >= startTs && h.ts <= endTs) {
                    rows.push({
                        time: h.ts, nodeId: i + 1, zoneName: z.name,
                        temp: h.temp, hum: h.hum, dust: h.dust, dust_peak: h.dust_peak,
                    });
                }
            });
        });
        rows.sort((a, b) => b.time - a.time);
        return rows;
    }

    fetch(callback) {
        const data = [];
        ZONES.forEach((z, i) => {
            const nodeId = i + 1;
            const node = nodeStates[i];
            if (!node || !node.online) {
                // 离线节点也返回，标记为空
                data.push({
                    node_id: nodeId, zone_id: z.id,
                    temperature: 0, humidity: 0,
                    dust_level: 0, dust_peak: 0,
                    timestamp: Date.now(), battery: 0,
                    online: false,
                });
                return;
            }
            const raw = generateSensorData(nodeId);
            const f = filters[nodeId];
            data.push({
                node_id: nodeId, zone_id: z.id,
                temperature: round1(f.temp.update(raw.temp)),
                humidity: round1(f.hum.update(raw.hum)),
                dust_level: Math.round(f.dust.update(raw.dust)),
                dust_peak: Math.round(raw.dust_peak),
                timestamp: Date.now(),
                battery: Math.floor(65 + Math.random() * 35),
                online: true,
            });
        });
        callback(data);
    }

    close() {}
}

// ==================== 2. HTTP 数据源（ESP32 中心节点） ====================
class HttpDataSource {
    constructor(url = 'http://192.168.1.100/api/sensors') {
        this.name = 'ESP32 HTTP';
        this.type = 'http';
        this.url = url;
        this.pollingInterval = 2000;
        this.timer = null;
        this.consecutiveErrors = 0;
        this.maxErrors = 5;
    }

    init() {
        addLog('info', `数据源: HTTP 模式 (${this.url})`);
        // 测试连接
        return this._testConnection();
    }

    async _testConnection() {
        try {
            const resp = await fetch(this.url, { signal: AbortSignal.timeout(3000) });
            if (resp.ok) {
                addLog('info', `ESP32 中心节点连接成功`);
                return true;
            }
        } catch (e) {
            addLog('warn', `ESP32 中心节点连接失败: ${e.message}，将使用缓存数据`);
        }
        return false;
    }

    async fetch(callback) {
        try {
            const resp = await fetch(this.url, { signal: AbortSignal.timeout(3000) });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            this.consecutiveErrors = 0;

            // ESP32 返回格式（匹配文档 5.2 节数据帧）：
            // {
            //   "nodes": [
            //     { "node_id": 1, "zone_id": 1, "temperature": 30.5, ... },
            //     ...
            //   ],
            //   "timestamp": 1700000000
            // }
            const nodes = json.nodes || json.data || json;
            const data = Array.isArray(nodes) ? nodes : [nodes];

            // 标准化数据格式
            const normalized = data.map(d => ({
                node_id: d.node_id || d.nodeId || 1,
                zone_id: d.zone_id || d.zoneId || d.node_id || 1,
                temperature: parseFloat(d.temperature || d.temp || 0),
                humidity: parseFloat(d.humidity || d.hum || 0),
                dust_level: parseInt(d.dust_level || d.dust || 0),
                dust_peak: parseInt(d.dust_peak || 0),
                timestamp: d.timestamp || Date.now(),
                battery: parseInt(d.battery || d.bat || 100),
                online: true,
            }));

            callback(normalized);
        } catch (e) {
            this.consecutiveErrors++;
            addLog('error', `数据拉取失败 (${this.consecutiveErrors}/${this.maxErrors}): ${e.message}`);
            if (this.consecutiveErrors >= this.maxErrors) {
                addLog('error', '连续失败过多，请检查 ESP32 中心节点连接');
            }
            // 返回空，UI 将标记节点离线
            callback([]);
        }
    }

    // ESP32 has no history endpoint — fall back to local
    async fetchHistory(_nodeFilter, _startTs, _endTs, _limit) {
        return null;
    }

    close() {
        if (this.timer) clearInterval(this.timer);
    }
}

// ==================== 3. WebSocket 数据源（ESP32 推送） ====================
class WebSocketDataSource {
    constructor(url = 'ws://192.168.1.100:81') {
        this.name = 'ESP32 WebSocket';
        this.type = 'websocket';
        this.url = url;
        this.ws = null;
        this.latestData = [];
        this.reconnectTimer = null;
    }

    init() {
        addLog('info', `数据源: WebSocket 模式 (${this.url})`);
        return this._connect();
    }

    _connect() {
        return new Promise((resolve) => {
            try {
                this.ws = new WebSocket(this.url);
                this.ws.onopen = () => {
                    addLog('info', 'WebSocket 已连接 ESP32 中心节点');
                    resolve(true);
                };
                this.ws.onmessage = (event) => {
                    try {
                        const json = JSON.parse(event.data);
                        const nodes = json.nodes || json.data || json;
                        this.latestData = (Array.isArray(nodes) ? nodes : [nodes]).map(d => ({
                            node_id: d.node_id || d.nodeId || 1,
                            zone_id: d.zone_id || d.zoneId || d.node_id || 1,
                            temperature: parseFloat(d.temperature || d.temp || 0),
                            humidity: parseFloat(d.humidity || d.hum || 0),
                            dust_level: parseInt(d.dust_level || d.dust || 0),
                            dust_peak: parseInt(d.dust_peak || 0),
                            timestamp: d.timestamp || Date.now(),
                            battery: parseInt(d.battery || d.bat || 100),
                            online: true,
                        }));
                    } catch (e) {
                        addLog('error', `WebSocket 数据解析错误: ${e.message}`);
                    }
                };
                this.ws.onerror = () => {
                    addLog('error', 'WebSocket 连接错误');
                    resolve(false);
                };
                this.ws.onclose = () => {
                    addLog('warn', 'WebSocket 断开，5秒后重连...');
                    this._scheduleReconnect();
                };
            } catch (e) {
                addLog('error', `WebSocket 创建失败: ${e.message}`);
                resolve(false);
            }
        });
    }

    _scheduleReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this._connect(), 5000);
    }

    fetch(callback) {
        // WebSocket 是推送模式，fetch 直接返回缓存的最新数据
        callback(this.latestData);
    }

    // ESP32 has no history endpoint — fall back to local
    async fetchHistory(_nodeFilter, _startTs, _endTs, _limit) {
        return null;
    }

    close() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.ws) {
            this.ws.onclose = null; // 阻止自动重连
            this.ws.close();
        }
    }
}

// ==================== 数据源管理器 ====================
let dataSource = null;

function createDataSource(type, config = {}) {
    switch (type) {
        case 'http':
            return new HttpDataSource(config.url || 'http://192.168.1.100/api/sensors');
        case 'websocket':
            return new WebSocketDataSource(config.url || 'ws://192.168.1.100:81');
        case 'simulation':
            return new SimulationDataSource();
        case 'backend':
        default:
            return new BackendDataSource();
    }
}

async function switchDataSource(type, config = {}) {
    // 关闭旧数据源
    if (dataSource) {
        dataSource.close();
    }
    // 创建新数据源
    dataSource = createDataSource(type, config);
    await dataSource.init();

    // 如果切换到模拟模式，重置滤波器
    if (type === 'simulation') {
        ZONES.forEach((_, i) => {
            const id = i + 1;
            ['temp', 'hum', 'dust'].forEach(k => {
                filters[id][k].reset();
            });
        });
    }

    // 更新系统配置
    systemConfig.dataSourceType = type;
    systemConfig.dataSourceConfig = config;
    saveState();

    return dataSource;
}

async function initDataSource() {
    const type = systemConfig.dataSourceType || 'backend';
    const config = systemConfig.dataSourceConfig || {};
    await switchDataSource(type, config);
}

// ---- 从数据源获取数据并更新节点状态 ----
function fetchFromDataSource() {
    if (!dataSource) return;

    dataSource.fetch((nodeDataArray) => {
        if (!nodeDataArray || nodeDataArray.length === 0) {
            // 无数据：标记所有节点为通信异常
            heartbeatCheck();
            return;
        }

        nodeDataArray.forEach(d => {
            const idx = d.node_id - 1;
            if (idx < 0 || idx >= nodeStates.length) return;

            const node = nodeStates[idx];

            if (!d.online) {
                node.online = false;
                node.timeoutCount = Math.min(node.timeoutCount + 1, 10);
                return;
            }

            // 节点在线，更新数据
            node.online = true;
            node.timeoutCount = 0;
            node.lastResponse = Date.now();

            const point = {
                temp: d.temperature, hum: d.humidity,
                dust: d.dust_level, dust_peak: d.dust_peak, ts: d.timestamp,
            };

            node.currentData = d;

            // 存入历史
            historicalData[d.node_id].push(point);
            const cutoff = Date.now() - systemConfig.historyRetention * 1000;
            while (historicalData[d.node_id].length > 0 && historicalData[d.node_id][0].ts < cutoff) {
                historicalData[d.node_id].shift();
            }
            while (historicalData[d.node_id].length > MAX_HISTORY_POINTS) {
                historicalData[d.node_id].shift();
            }

            // 检查告警
            const alerts = checkAlerts(d.node_id, d);
            alerts.forEach(a => {
                const entry = {
                    time: Date.now(), nodeId: d.node_id,
                    zoneName: ZONES[idx].name,
                    level: ALERT_LEVEL_MAP[a.level], type: a.type,
                    msg: `[${ZONES[idx].name}] ${a.msg}`,
                    icon: a.icon, handled: false,
                };
                alertHistory.unshift(entry);
                alertArchive.push({ ...entry });
            });
        });

        // 心跳检测
        heartbeatCheck();
    });
}

// ---- ESP32 中心节点 HTTP API 参考实现 ----
// 在 ESP32 中心节点上运行的 HTTP 服务器代码（Arduino）：
//
// #include <WiFi.h>
// #include <WebServer.h>
// WebServer server(80);
//
// void setup() {
//     WiFi.softAP("ParkMonitor", "12345678");
//     server.on("/api/sensors", handleSensors);
//     server.begin();
// }
//
// void handleSensors() {
//     String json = "[";
//     for (int i = 0; i < node_count; i++) {
//         if (i > 0) json += ",";
//         json += "{";
//         json += "\"node_id\":" + String(node_data[i].node_id) + ",";
//         json += "\"zone_id\":" + String(node_data[i].zone_id) + ",";
//         json += "\"temperature\":" + String(node_data[i].temperature, 1) + ",";
//         json += "\"humidity\":" + String(node_data[i].humidity, 1) + ",";
//         json += "\"smoke_level\":" + String(node_data[i].smoke_level) + ",";
//         json += "\"smoke_peak\":" + String(node_data[i].smoke_peak) + ",";
//         json += "\"timestamp\":" + String(millis());
//         json += "}";
//     }
//     json += "]";
//     server.send(200, "application/json", json);
// }
//
// 前端配置：
//   数据源类型: HTTP
//   ESP32 地址: http://192.168.4.1/api/sensors (AP模式)
//   或: http://[中心节点IP]/api/sensors (STA模式)
