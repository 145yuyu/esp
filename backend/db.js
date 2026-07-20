/**
 * 数据库层 — SQLite 持久化存储 (基于 sql.js WASM, 无需原生编译)
 * 表: sensor_records | alarms | node_status | system_logs
 * 传感器: DHT22 (温湿度) + GP2Y1014AU (粉尘浓度 ug/m³)
 *
 * API 与 better-sqlite3 兼容，现有路由无需修改
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'park_monitor.db');
let db = null;  // 原始 sql.js Database 对象

// ---- 持久化到磁盘 ----
function saveToDisk() {
    if (!db) return;
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ---- 辅助: 给命名参数 key 自动添加 @ 前缀 ----
function prefixParams(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return params || {};
    const prefixed = {};
    for (const [k, v] of Object.entries(params)) {
        prefixed[k.startsWith('@') || k.startsWith(':') || k.startsWith('$') ? k : '@' + k] = v;
    }
    return prefixed;
}

// ---- sql.js → better-sqlite3 兼容包装 ----
// 为每个 SQL 语句创建兼容的 Statement 对象
// 注意: 这里使用原始 db.prepare() (返回 sql.js Statement，有 .bind/.step/.getAsObject/.free)
function _stmt(sql) {
    return {
        run: (...args) => {
            const params = prefixParams(args[0]);
            db.run(sql, params);           // sql.js db.run(sql, params) 直接执行
            const changes = db.getRowsModified();
            const lastIdRow = db.exec('SELECT last_insert_rowid() AS id');
            const lastInsertRowid = lastIdRow.length > 0 && lastIdRow[0].values.length > 0
                ? lastIdRow[0].values[0][0] : 0;
            saveToDisk();
            return { changes, lastInsertRowid };
        },
        get: (...args) => {
            const params = prefixParams(args[0]);
            const stmt = db.prepare(sql);
            if (params && typeof params === 'object' && Object.keys(params).length > 0) {
                stmt.bind(params);
            }
            let result = null;
            if (stmt.step()) result = stmt.getAsObject();
            stmt.free();
            return result;
        },
        all: (...args) => {
            const params = prefixParams(args[0]);
            const stmt = db.prepare(sql);
            if (params && typeof params === 'object' && Object.keys(params).length > 0) {
                stmt.bind(params);
            }
            const results = [];
            while (stmt.step()) results.push(stmt.getAsObject());
            stmt.free();
            return results;
        },
    };
}

// ---- 初始化数据库 ----
async function initDb() {
    if (db) return db;

    const SQL = await initSqlJs();

    // 尝试加载已有数据库文件
    if (fs.existsSync(DB_PATH)) {
        try {
            const buffer = fs.readFileSync(DB_PATH);
            if (buffer.length > 0) {
                db = new SQL.Database(buffer);
            }
        } catch (e) {
            console.warn('[DB] 加载已有数据库失败，将创建新库');
        }
    }
    if (!db) {
        db = new SQL.Database();
    }

    // ---- 建表 ----
    db.run(`
        CREATE TABLE IF NOT EXISTS sensor_records (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id   INTEGER NOT NULL,
            zone_id   INTEGER NOT NULL,
            zone_name TEXT,
            temperature REAL,
            humidity    REAL,
            dust_level        INTEGER,
            dust_peak         INTEGER,
            battery     INTEGER,
            timestamp   INTEGER NOT NULL,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_sensor_ts   ON sensor_records(timestamp)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sensor_node ON sensor_records(node_id, timestamp)');

    db.run(`
        CREATE TABLE IF NOT EXISTS alarms (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id   INTEGER,
            zone_name TEXT,
            level     TEXT,
            type      TEXT,
            message   TEXT,
            handled   INTEGER DEFAULT 0,
            timestamp INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_alarms_ts ON alarms(timestamp)');

    db.run(`
        CREATE TABLE IF NOT EXISTS node_status (
            node_id   INTEGER PRIMARY KEY,
            zone_name TEXT,
            online    INTEGER DEFAULT 1,
            last_seen INTEGER,
            battery   INTEGER
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS system_logs (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            level     TEXT,
            message   TEXT,
            timestamp INTEGER NOT NULL
        )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_logs_ts ON system_logs(timestamp)');

    saveToDisk();
    console.log('[DB] SQLite 数据库已就绪 (sql.js)');
    return db;
}

// ==================== 预编译语句 (兼容包装) ====================

const stmts = {
    // 传感器记录
    insertRecord: _stmt(`
        INSERT INTO sensor_records
        (node_id, zone_id, zone_name, temperature, humidity, dust_level, dust_peak, battery, timestamp)
        VALUES (@node_id, @zone_id, @zone_name, @temperature, @humidity, @dust_level, @dust_peak, @battery, @timestamp)
    `),

    queryRecords: (nodeId, startTs, endTs, limit = 500) => {
        let sql = 'SELECT * FROM sensor_records WHERE timestamp BETWEEN ? AND ?';
        const params = [startTs, endTs];
        if (nodeId && nodeId !== 'all') {
            sql += ' AND node_id = ?';
            params.push(parseInt(nodeId));
        }
        sql += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(limit);
        const stmt = db.prepare(sql, params);
        const results = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
    },

    latestRecords: _stmt(`
        SELECT s.* FROM sensor_records s
        INNER JOIN (
            SELECT node_id, MAX(timestamp) AS max_ts
            FROM sensor_records GROUP BY node_id
        ) latest ON s.node_id = latest.node_id AND s.timestamp = latest.max_ts
        ORDER BY s.node_id
    `),

    cleanOldRecords: _stmt('DELETE FROM sensor_records WHERE timestamp < @cutoff'),

    // 告警
    insertAlarm: _stmt(`
        INSERT INTO alarms (node_id, zone_name, level, type, message, timestamp)
        VALUES (@node_id, @zone_name, @level, @type, @message, @timestamp)
    `),

    queryAlarms: (level, limit = 200) => {
        let sql = 'SELECT * FROM alarms';
        const params = [];
        if (level && level !== 'all') {
            sql += ' WHERE level = ?';
            params.push(level);
        }
        sql += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(limit);
        const stmt = db.prepare(sql, params);
        const results = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
    },

    markAlarmHandled: _stmt('UPDATE alarms SET handled = 1 WHERE id = @id'),
    clearHandledAlarms: _stmt('DELETE FROM alarms WHERE handled = 1'),

    alarmStats: _stmt(`
        SELECT level, COUNT(*) as count FROM alarms
        WHERE timestamp > @cutoff GROUP BY level
    `),

    // 节点状态
    upsertNodeStatus: _stmt(`
        INSERT OR REPLACE INTO node_status (node_id, zone_name, online, last_seen, battery)
        VALUES (@node_id, @zone_name, @online, @last_seen, @battery)
    `),

    allNodeStatus: _stmt('SELECT * FROM node_status ORDER BY node_id'),

    // 日志
    insertLog: _stmt('INSERT INTO system_logs (level, message, timestamp) VALUES (@level, @message, @timestamp)'),

    queryLogs: (level, limit = 200) => {
        let sql = 'SELECT * FROM system_logs';
        const params = [];
        if (level && level !== 'all') {
            sql += ' WHERE level = ?';
            params.push(level);
        }
        sql += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(limit);
        const stmt = db.prepare(sql, params);
        const results = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
    },
    clearLogs: _stmt('DELETE FROM system_logs'),
};

// ---- 公开 API (与 better-sqlite3 兼容) ----
function insertSensorData(node) {
    return stmts.insertRecord.run({
        node_id: node.node_id,
        zone_id: node.zone_id,
        zone_name: node.zone_name || '',
        temperature: node.temperature,
        humidity: node.humidity,
        dust_level: node.dust_level,
        dust_peak: node.dust_peak || 0,
        battery: node.battery || 0,
        timestamp: node.timestamp || Date.now(),
    });
}

function insertAlarm(nodeId, zoneName, level, type, msg, ts) {
    return stmts.insertAlarm.run({
        node_id: nodeId,
        zone_name: zoneName,
        level,
        type,
        message: msg,
        timestamp: ts || Date.now(),
    });
}

function addLog(level, msg) {
    return stmts.insertLog.run({ level, message: msg, timestamp: Date.now() });
}

// 定期清理旧数据
let cleanupTimer = null;
function startCleanup(intervalMs = 600000, retentionSec = 86400 * 7) {
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = setInterval(() => {
        const cutoff = Date.now() - retentionSec * 1000;
        stmts.cleanOldRecords.run({ cutoff });
        saveToDisk();
    }, intervalMs);
}

// ---- 兼容包装层 (供 stats.js 等模块的内联 db.prepare() 查询) ----
// 返回一个代理对象，其 .prepare() 返回 better-sqlite3 风格的 {run, get, all}
function createCompatDb(rawDb) {
    return {
        prepare: function (sql) {
            const stmt = rawDb.prepare(sql);
            return {
                run: (...args) => {
                    bindCompat(stmt, args[0]);
                    stmt.step();
                    const changes = rawDb.getRowsModified();
                    stmt.free();
                    saveToDisk();
                    return { changes };
                },
                get: (...args) => {
                    bindCompat(stmt, args[0]);
                    let result = null;
                    if (stmt.step()) result = stmt.getAsObject();
                    stmt.free();
                    return result;
                },
                all: (...args) => {
                    bindCompat(stmt, args[0]);
                    const results = [];
                    while (stmt.step()) results.push(stmt.getAsObject());
                    stmt.free();
                    return results;
                },
            };
        },
    };
}

// 兼容不同参数类型: 基本类型 → [值], 数组/对象 → 直接传
function bindCompat(stmt, params) {
    if (params === undefined || params === null) return;
    if (typeof params === 'object' && !Array.isArray(params)) {
        stmt.bind(prefixParams(params));   // 命名参数: {key: val}
    } else if (Array.isArray(params)) {
        stmt.bind(params);                 // 位置参数: [?]
    } else {
        stmt.bind([params]);               // 单值: number/string
    }
}

module.exports = { initDb, db: null, stmts, createCompatDb, insertSensorData, insertAlarm, addLog, startCleanup, saveToDisk };
