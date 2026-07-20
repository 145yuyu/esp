/**
 * 告警管理 API
 * GET  /api/alarms              — 告警列表
 * PUT  /api/alarms/:id/handle   — 标记已处理
 * DELETE /api/alarms/handled     — 清空已处理
 */

const express = require('express');
const router = express.Router();
const { stmts } = require('../db');

// GET /api/alarms
router.get('/', (req, res) => {
    const { level, limit } = req.query;
    const rows = stmts.queryAlarms(level || 'all', parseInt(limit) || 200);
    const stats = stmts.alarmStats.all(Date.now() - 86400000);
    res.json({ success: true, data: rows, stats, timestamp: Date.now() });
});

// PUT /api/alarms/:id/handle
router.put('/:id/handle', (req, res) => {
    stmts.markAlarmHandled.run(parseInt(req.params.id));
    res.json({ success: true, message: '已标记处理' });
});

// DELETE /api/alarms/handled
router.delete('/handled', (req, res) => {
    stmts.clearHandledAlarms.run();
    res.json({ success: true, message: '已清空已处理告警' });
});

module.exports = router;
