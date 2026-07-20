/**
 * 统计数据 API
 * GET /api/stats/zones    — 分区统计
 * GET /api/stats/overview — 概览
 */

const express = require('express');
const router = express.Router();
const dbModule = require('../db');
const { stmts } = dbModule;

// GET /api/stats/overview
router.get('/overview', (req, res) => {
    const now = Date.now();
    const hourAgo = now - 3600000;

    const latest = stmts.latestRecords.all();
    const alarmCount = dbModule.db.prepare(
        'SELECT COUNT(*) as c FROM alarms WHERE timestamp > ? AND handled = 0'
    ).get(hourAgo);
    const onlineCount = dbModule.db.prepare(
        'SELECT COUNT(*) as c FROM node_status WHERE online = 1'
    ).get();

    let avgTemp = 0, avgHum = 0, avgDust = 0;
    if (latest.length > 0) {
        avgTemp = latest.reduce((s, r) => s + r.temperature, 0) / latest.length;
        avgHum  = latest.reduce((s, r) => s + r.humidity, 0) / latest.length;
        avgDust = latest.reduce((s, r) => s + r.dust_level, 0) / latest.length;
    }

    res.json({
        success: true,
        data: {
            avg_temperature: Math.round(avgTemp * 10) / 10,
            avg_humidity: Math.round(avgHum * 10) / 10,
            avg_dust: Math.round(avgDust),
            active_alarms: alarmCount ? alarmCount.c : 0,
            online_nodes: onlineCount ? onlineCount.c : 0,
            total_records_1h: dbModule.db.prepare(
                'SELECT COUNT(*) as c FROM sensor_records WHERE timestamp > ?'
            ).get(hourAgo)?.c || 0,
        },
        timestamp: now,
    });
});

// GET /api/stats/zones
router.get('/zones', (req, res) => {
    const now = Date.now();
    const dayAgo = now - 86400000;

    const stats = dbModule.db.prepare(`
        SELECT
            node_id, zone_name,
            ROUND(AVG(temperature), 1) AS avg_temp,
            MAX(temperature) AS max_temp,
            MIN(temperature) AS min_temp,
            ROUND(AVG(humidity), 1) AS avg_hum,
            MAX(humidity) AS max_hum,
            MIN(humidity) AS min_hum,
            ROUND(AVG(dust_level)) AS avg_dust,
            MAX(dust_level) AS max_dust,
            MIN(dust_level) AS min_dust,
            COUNT(*) AS sample_count
        FROM sensor_records
        WHERE timestamp > ?
        GROUP BY node_id
        ORDER BY node_id
    `).all(dayAgo);

    res.json({ success: true, data: stats, period: '24h', timestamp: now });
});

module.exports = router;
