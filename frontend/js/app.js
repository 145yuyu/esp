/* ============================================================
   城市公园环境监测系统 — Main Application
   SPA 路由、页面渲染、交互逻辑
   ============================================================ */

// ---- DOM 捷径 ----
const Q = (s, p) => (p || document).querySelector(s);
const QA = (s, p) => (p || document).querySelectorAll(s);

// ---- 页面路由 ----
let currentPage = 'dashboard';
let refreshTimer = null;
let startTime = Date.now();

function navigateTo(page) {
    currentPage = page;
    QA('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
    QA('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
    Q('#pageTitle').textContent = {
        dashboard: '实时监控仪表盘',
        history: '历史数据查询',
        alarms: '告警管理',
        analytics: '分区对比分析',
        nodes: '节点管理',
        settings: '系统配置',
        logs: '运行日志',
    }[page] || '';

    // 页面切换时初始化对应图表
    if (page === 'dashboard') {
        setTimeout(() => {
            initDashTrendChart(Q('#dashTrendChart'));
            initDashBarChart(Q('#dashBarChart'));
            updateDashTrendChart();
            updateDashBarChart();
            renderDashboard();
        }, 50);
    } else if (page === 'history') {
        setTimeout(() => {
            initHistChart(Q('#histChart'));
            renderHistory();
        }, 50);
    } else if (page === 'analytics') {
        setTimeout(() => {
            initAnalyticsTempBar(Q('#analyticsTempBar'));
            initAnalyticsSmokeBar(Q('#analyticsSmokeBar'));
            initAnalyticsRadar(Q('#analyticsRadar'));
            updateAnalyticsCharts();
            renderAnalyticsTable();
        }, 50);
    } else if (page === 'nodes') {
        renderNodesPage();
    } else if (page === 'alarms') {
        renderAlarmsPage();
    } else if (page === 'logs') {
        renderLogsPage();
    }
}

// 导航点击
QA('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.page));
});

// ---- 时钟 ----
function updateClock() {
    const n = new Date();
    Q('#topbarClock').textContent = n.toLocaleTimeString('zh-CN', { hour12: false });
    Q('#topbarDate').textContent = n.toLocaleDateString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    });
    // 运行时长
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = uptime % 60;
    Q('#sysUptime').textContent = `运行 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ==================== DASHBOARD ====================
function renderDashboard() {
    // 统计卡片
    let allTemps = [], allHums = [], allDusts = [];
    ZONES.forEach((_, i) => {
        const hist = historicalData[i + 1];
        if (hist.length > 0) {
            const last = hist[hist.length - 1];
            allTemps.push(last.temp); allHums.push(last.hum); allDusts.push(last.dust);
        }
    });

    if (allTemps.length > 0) {
        Q('#statAvgTemp').textContent = round1(avg(allTemps)) + '°C';
        Q('#statTempRange').textContent = `${round1(Math.min(...allTemps))}° ~ ${round1(Math.max(...allTemps))}°`;
        Q('#statAvgHum').textContent = round1(avg(allHums)) + '%';
        Q('#statHumRange').textContent = `${round1(Math.min(...allHums))}% ~ ${round1(Math.max(...allHums))}%`;
        Q('#statAvgSmoke').textContent = Math.round(avg(allDusts)) + ' ug/m³';
        Q('#statSmokeLabel').textContent = getDustLevel(Math.round(avg(allDusts))).label;
    }

    const activeAlarms = alertHistory.filter(a => !a.handled && a.level !== 'info' && a.level !== 'fault').length;
    const faultAlarms = nodeStates.filter(n => !n.online).length;
    Q('#statAlarmCount').textContent = activeAlarms + faultAlarms;
    Q('#statAlarmSub').textContent = faultAlarms > 0 ? `${faultAlarms} 节点离线` : '无严重告警';

    const onlineCount = nodeStates.filter(n => n.online).length;
    Q('#statOnlineNodes').textContent = `${onlineCount}/${ZONES.length}`;
    Q('#statCommStatus').textContent = onlineCount === ZONES.length ? '通信正常' : '部分离线';

    // Dynamic stat card status classes
    const statCards = QA('.stat-card');
    if (statCards.length >= 5) {
        if (allTemps.length > 0 && avg(allTemps) > 35) statCards[0].classList.add('warn');
        else statCards[0].classList.remove('warn');
        if (allDusts.length > 0) {
            const avgDust = Math.round(avg(allDusts));
            statCards[2].classList.remove('warn', 'critical');
            if (avgDust > 115) statCards[2].classList.add('critical');
            else if (avgDust > 75) statCards[2].classList.add('warn');
        }
        statCards[3].classList.toggle('critical', (activeAlarms + faultAlarms) > 0);
        statCards[4].classList.toggle('warn', onlineCount < ZONES.length);
    }

    // 节点列表
    Q('#dashNodeList').innerHTML = nodeStates.map(node => {
        const d = node.currentData;
        if (!node.online) {
            return `<div class="node-card offline">
                <div class="node-card-header">
                    <span class="node-name"><span class="node-dot off"></span>节点${node.id}</span>
                    <span class="node-zone-tag">${node.zone.icon} ${node.zone.name}</span>
                </div>
                <div class="node-readings-row">
                    <div><div class="node-reading-val" style="font-size:13px;color:#64748b">离线</div></div>
                </div>
                <div class="node-card-footer" style="color:var(--red)">超时${node.timeoutCount}次</div>
            </div>`;
        }
        const pmLevel = getDustLevel(d.dust_level);
        let alertCls = '';
        if (d.dust_level > systemConfig.dustDanger || d.temperature > systemConfig.tempWarning) alertCls = 'alert-critical';
        else if (d.dust_level > systemConfig.dustWarning) alertCls = 'alert-warning';

        return `<div class="node-card ${alertCls}" onclick="openNodeModal(${node.id})">
            <div class="node-card-header">
                <span class="node-name"><span class="node-dot on"></span>节点${node.id}</span>
                <span class="node-zone-tag">${node.zone.icon} ${node.zone.name}</span>
            </div>
            <div class="node-readings-row">
                <div><div class="node-reading-label">温度</div>
                     <div class="node-reading-val" style="color:#f97316">${d.temperature.toFixed(1)}<span class="node-reading-unit">°C</span></div></div>
                <div><div class="node-reading-label">湿度</div>
                     <div class="node-reading-val" style="color:#38bdf8">${d.humidity.toFixed(1)}<span class="node-reading-unit">%</span></div></div>
                <div><div class="node-reading-label">粉尘浓度</div>
                     <div class="node-reading-val" style="color:${pmLevel.color}">${d.dust_level}<span class="node-reading-unit">ug/m³</span></div></div>
            </div>
            <div class="node-card-footer">
                <span>粉尘峰值: ${d.dust_peak} ug/m³</span>
                <span>${d.battery}%</span>
                <span class="pm-tag ${pmLevel.cls}">${pmLevel.label}</span>
            </div>
        </div>`;
    }).join('');

    // 迷你告警列表
    const recentAlerts = alertHistory.filter(a => a.level !== 'info').slice(0, 10);
    Q('#dashAlertMini').innerHTML = recentAlerts.length === 0
        ? '<div class="mini-alert-empty">当前无告警</div>'
        : recentAlerts.map(a => `
            <div class="mini-alert ${a.level}">
                <span>${a.icon}</span>
                <div>
                    <div>${a.msg}</div>
                    <div style="font-size:9px;color:var(--text-muted)">${fmtTime(a.time)}</div>
                </div>
            </div>`).join('');

    // 告警徽章 & 系统状态点
    updateAlarmBadge();
    const hasCritical = nodeStates.filter(n => !n.online).length > 0;
    const hasWarning = alertHistory.filter(a => a.level === 'critical' && !a.handled).length > 0;
    const dot = Q('#sysStatusDot');
    if (hasCritical || hasWarning) { dot.className = 'system-status-dot-sm error'; Q('#sysStatusText').textContent = '系统异常'; }
    else if (alertHistory.filter(a => a.level === 'danger' && !a.handled).length > 0) { dot.className = 'system-status-dot-sm warn'; Q('#sysStatusText').textContent = '有待处理告警'; }
    else { dot.className = 'system-status-dot-sm'; Q('#sysStatusText').textContent = '系统正常'; }
}

// ---- 告警徽章更新（全局，排除 info/fault） ----
function updateAlarmBadge() {
    const badge = Q('#alarmBadge');
    // 仅统计真正的环境告警：排除 info（信息通知）和 fault（设备离线）
    const count = alertHistory.filter(a => !a.handled && a.level !== 'info' && a.level !== 'fault').length;
    if (count > 0) {
        badge.textContent = count;
        badge.classList.add('show');
    } else {
        badge.textContent = '';
        badge.classList.remove('show');
    }
}

// 仪表盘图表标签切换
QA('#dashChartTabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        QA('#dashChartTabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentDashType = tab.dataset.type;
        updateDashTrendChart();
    });
});

// ==================== HISTORY PAGE ====================
let histPage = 1, histPageSize = 30, histFilteredData = [];

async function renderHistory() {
    const nodeFilter = Q('#histNodeSelect').value;
    const metric = Q('#histMetricSelect').value;
    const startStr = Q('#histStart').value;
    const endStr = Q('#histEnd').value;

    let startTs = startStr ? new Date(startStr).getTime() : Date.now() - 3600000;
    let endTs = endStr ? new Date(endStr).getTime() : Date.now();

    // Try backend SQLite first, fall back to local historicalData
    let rows = null;
    if (dataSource && typeof dataSource.fetchHistory === 'function') {
        rows = await dataSource.fetchHistory(
            nodeFilter === 'all' ? null : nodeFilter,
            startTs, endTs, 2000
        );
    }

    // Fallback: read from local in-memory historicalData
    if (!rows) {
        rows = [];
        ZONES.forEach((z, i) => {
            if (nodeFilter !== 'all' && (i + 1) !== parseInt(nodeFilter)) return;
            historicalData[i + 1].forEach(h => {
                if (h.ts >= startTs && h.ts <= endTs) {
                    rows.push({
                        time: h.ts, nodeId: i + 1, zoneName: z.name,
                        temp: h.temp, hum: h.hum, dust: h.dust, dust_peak: h.dust_peak,
                    });
                }
            });
        });
    }
    rows.sort((a, b) => b.time - a.time);
    histFilteredData = rows;

    // 更新图表
    queryHistChart(nodeFilter, metric, startTs, endTs, rows);

    renderHistTable();
    Q('#histCount').textContent = `共 ${histFilteredData.length} 条记录`;
    Q('#histPage').textContent = `${histPage}/${Math.max(1, Math.ceil(histFilteredData.length / histPageSize))}`;
}

function renderHistTable() {
    const start = (histPage - 1) * histPageSize;
    const page = histFilteredData.slice(start, start + histPageSize);
    Q('#histTableBody').innerHTML = page.map(row => {
        const pmLvl = getDustLevel(row.dust);
        return `<tr>
            <td>${fmtDateTime(row.time)}</td>
            <td>节点${row.nodeId}</td>
            <td>${row.zoneName}</td>
            <td>${row.temp.toFixed(1)}</td>
            <td>${row.hum.toFixed(1)}</td>
            <td style="color:${pmLvl.color}">${row.dust}</td>
            <td>${row.dust_peak}</td>
            <td><span class="pm-tag ${pmLvl.cls}">${pmLvl.label}</span></td>
        </tr>`;
    }).join('');
}

Q('#histQueryBtn').addEventListener('click', () => { histPage = 1; renderHistory(); });

// Quick time preset buttons
QA('.time-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        QA('.time-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const range = parseInt(btn.dataset.range);
        const now = new Date();
        Q('#histEnd').value = now.toISOString().slice(0, 16);
        Q('#histStart').value = new Date(now.getTime() - range).toISOString().slice(0, 16);
        histPage = 1;
        renderHistory();
    });
});
Q('#histNodeSelect').addEventListener('change', () => { histPage = 1; renderHistory(); });
Q('#histMetricSelect').addEventListener('change', () => renderHistory());
Q('#histPrev').addEventListener('click', () => { if (histPage > 1) { histPage--; renderHistTable(); } });
Q('#histNext').addEventListener('click', () => {
    if (histPage < Math.ceil(histFilteredData.length / histPageSize)) { histPage++; renderHistTable(); }
});

// 默认历史时间范围
Q('#histEnd').value = new Date().toISOString().slice(0, 16);
Q('#histStart').value = new Date(Date.now() - 3600000).toISOString().slice(0, 16);

// ==================== ALARMS PAGE ====================
function renderAlarmsPage() {
    updateAlarmStats();

    const levelFilter = Q('#alarmFilterLevel').value;
    let filtered = alertArchive;
    if (levelFilter !== 'all') filtered = filtered.filter(a => a.level === levelFilter);

    Q('#alarmTableBody').innerHTML = filtered.slice(0, 200).map((a, idx) => {
        const actualIdx = alertArchive.indexOf(a);
        return `<tr>
            <td>${fmtDateTime(a.time)}</td>
            <td><span class="level-badge level-${a.level}">${a.level}</span></td>
            <td>节点${a.nodeId}</td>
            <td>${a.zoneName}</td>
            <td>${a.msg}</td>
            <td>${a.handled ? '<span style="color:var(--green)">已处理</span>' : '<span style="color:var(--yellow)">待处理</span>'}</td>
            <td>${a.handled ? '' : `<button class="btn btn-sm" onclick="handleAlarm(${actualIdx})">标记处理</button>`}</td>
        </tr>`;
    }).join('');
}

function updateAlarmStats() {
    Q('#asTotal').textContent = alertArchive.length;
    Q('#asWarning').textContent = alertArchive.filter(a => a.level === 'warning').length;
    Q('#asDanger').textContent = alertArchive.filter(a => a.level === 'danger').length;
    Q('#asCritical').textContent = alertArchive.filter(a => a.level === 'critical').length;
    Q('#asFault').textContent = alertArchive.filter(a => a.level === 'fault').length;
}

function handleAlarm(idx) {
    if (alertArchive[idx]) {
        alertArchive[idx].handled = true;
        // 同步更新 alertHistory
        const a = alertArchive[idx];
        const match = alertHistory.find(h => h.time === a.time && h.nodeId === a.nodeId);
        if (match) match.handled = true;
        renderAlarmsPage();
    }
}

Q('#alarmFilterLevel').addEventListener('change', renderAlarmsPage);
Q('#alarmClearBtn').addEventListener('click', () => {
    alertArchive = alertArchive.filter(a => !a.handled);
    alertHistory = alertHistory.filter(a => !a.handled);
    renderAlarmsPage();
    addLog('info', '已清空已处理告警');
});

// ==================== ANALYTICS PAGE ====================
function renderAnalyticsTable() {
    Q('#analyticsTableBody').innerHTML = ZONES.map((z, i) => {
        const s = getZoneStats(i + 1);
        if (!s) return `<tr><td colspan="8">${z.name} — 暂无数据</td></tr>`;
        const pmLvl = getDustLevel(s.dust.avg);
        return `<tr>
            <td><strong>${z.icon} ${z.name}</strong></td>
            <td>${s.temp.avg}°C</td><td>${s.temp.max}°C</td><td>${s.temp.min}°C</td>
            <td>${s.hum.avg}%</td>
            <td style="color:${pmLvl.color}">${s.dust.avg}</td>
            <td>${s.dust.max}</td>
            <td>${s.count}</td>
        </tr>`;
    }).join('');
}

// ==================== NODES PAGE ====================
function renderNodesPage() {
    Q('#nodesMgmtGrid').innerHTML = nodeStates.map(node => {
        const d = node.currentData;
        const z = node.zone;
        if (!node.online) {
            return `<div class="node-mgmt-card" style="opacity:0.5">
                <div class="node-mgmt-header">
                    <div><div class="node-mgmt-name">节点 ${node.id} — ${z.name}</div><div class="node-mgmt-zone">离线</div></div>
                    <span style="color:var(--red);font-weight:700">已离线</span>
                </div>
                <canvas id="gauge${node.id}" class="node-mgmt-gauge"></canvas>
                <div style="text-align:center;color:var(--text-muted)">通信中断</div>
            </div>`;
        }

        const pmLvl = getDustLevel(d.dust_level);
        return `<div class="node-mgmt-card">
            <div class="node-mgmt-header">
                <div>
                    <div class="node-mgmt-name">节点 ${node.id} — ${z.name}</div>
                    <div class="node-mgmt-zone">${z.icon} ${z.desc}</div>
                </div>
                <span class="pm-tag ${pmLvl.cls}">${pmLvl.label}</span>
            </div>
            <canvas id="gauge${node.id}" class="node-mgmt-gauge"></canvas>
            <div class="node-mgmt-details">
                <div class="node-mgmt-detail">
                    <div class="node-mgmt-detail-label">温度</div>
                    <div class="node-mgmt-detail-value" style="color:#f97316">${d.temperature.toFixed(1)}°C</div>
                </div>
                <div class="node-mgmt-detail">
                    <div class="node-mgmt-detail-label">湿度</div>
                    <div class="node-mgmt-detail-value" style="color:#38bdf8">${d.humidity.toFixed(1)}%</div>
                </div>
                <div class="node-mgmt-detail">
                    <div class="node-mgmt-detail-label">粉尘浓度</div>
                    <div class="node-mgmt-detail-value" style="color:${pmLvl.color}">${d.dust_level}</div>
                </div>
                <div class="node-mgmt-detail">
                    <div class="node-mgmt-detail-label">电量</div>
                    <div class="node-mgmt-detail-value">${d.battery}%</div>
                </div>
            </div>
        </div>`;
    }).join('');

    // 渲染仪表盘
    nodeStates.forEach(node => {
        if (!node.online) return;
        const d = node.currentData;
        const canvas = Q(`#gauge${node.id}`);
        if (canvas && d) {
            createNodeGauge(canvas, d.dust_level, 200, '粉尘浓度 ug/m³', getDustLevel(d.dust_level).color);
        }
    });
}

// Incremental update — no DOM teardown, preserves scroll
let _nodesLastOnline = null;
function updateNodesPage() {
    const grid = Q('#nodesMgmtGrid');
    if (!grid) return;

    const cards = QA('.node-mgmt-card', grid);
    if (cards.length !== nodeStates.length) {
        // Structure changed, full re-render needed
        _nodesLastOnline = nodeStates.map(n => n.online);
        renderNodesPage();
        return;
    }

    // Detect online-status transitions that require re-render
    const currentOnline = nodeStates.map(n => n.online);
    if (_nodesLastOnline && !currentOnline.every((v, i) => v === _nodesLastOnline[i])) {
        _nodesLastOnline = currentOnline.slice();
        renderNodesPage();
        return;
    }
    _nodesLastOnline = currentOnline.slice();

    // Incremental update: only change text + redraw gauges
    nodeStates.forEach((node, i) => {
        if (!node.online) return;
        const d = node.currentData;
        if (!d) return;
        const card = cards[i];
        if (!card) return;

        // Update detail values
        const vals = QA('.node-mgmt-detail-value', card);
        if (vals.length >= 4) {
            vals[0].textContent = d.temperature.toFixed(1) + 'C';
            vals[1].textContent = d.humidity.toFixed(1) + '%';
            vals[2].textContent = String(d.dust_level);
            vals[3].textContent = d.battery + '%';
        }

        // Update PM tag
        const pmLvl = getDustLevel(d.dust_level);
        const tag = Q('.pm-tag', card);
        if (tag) {
            tag.textContent = pmLvl.label;
            tag.className = 'pm-tag ' + pmLvl.cls;
        }

        // Redraw gauge
        const canvas = Q(`#gauge${node.id}`, card);
        if (canvas && d) {
            const existing = Chart.getChart(canvas);
            if (existing) existing.destroy();
            createNodeGauge(canvas, d.dust_level, 200, '粉尘浓度 ug/m³', pmLvl.color);
        }
    });
}

// ==================== SETTINGS PAGE ====================
function initSettings() {
    // 绑定阈值滑块
    ['cfgDustWarning', 'cfgDustDanger', 'cfgTempWarning', 'cfgHumWarning'].forEach(id => {
        const slider = Q(`#${id}`);
        const display = Q(`#${id}Val`);
        if (!slider || !display) return;

        // 初始值
        const key = id.replace('cfg', '').replace('Warning', 'Warning').replace('Danger', 'Danger');
        const cfgKey = {
            cfgDustWarning: 'dustWarning', cfgDustDanger: 'dustDanger',
            cfgTempWarning: 'tempWarning', cfgHumWarning: 'humWarning',
        }[id];
        slider.value = systemConfig[cfgKey];
        display.textContent = systemConfig[cfgKey];

        slider.addEventListener('input', () => {
            display.textContent = slider.value;
        });
    });

    Q('#cfgRefreshInterval').value = systemConfig.refreshInterval;
    Q('#cfgHistoryRetention').value = systemConfig.historyRetention;
    Q('#cfgHeartbeatInterval').value = systemConfig.heartbeatInterval;
    Q('#cfgFilterWindow').value = systemConfig.filterWindow;

    // 保存配置
    Q('#cfgSaveBtn').addEventListener('click', () => {
                systemConfig.dustWarning = parseInt(Q('#cfgDustWarning').value);
        systemConfig.dustDanger = parseInt(Q('#cfgDustDanger').value);
        systemConfig.tempWarning = parseFloat(Q('#cfgTempWarning').value);
        systemConfig.humWarning = parseInt(Q('#cfgHumWarning').value);
        systemConfig.refreshInterval = parseInt(Q('#cfgRefreshInterval').value);
        systemConfig.historyRetention = parseInt(Q('#cfgHistoryRetention').value);
        systemConfig.heartbeatInterval = parseInt(Q('#cfgHeartbeatInterval').value);
        systemConfig.filterWindow = parseInt(Q('#cfgFilterWindow').value);

        // 更新滤波器窗口
        ZONES.forEach((_, i) => {
            const id = i + 1;
            ['temp', 'hum', 'dust'].forEach(k => {
                filters[id][k] = new MovingAverageFilter(systemConfig.filterWindow);
            });
        });

        // 更新刷新间隔
        clearInterval(refreshTimer);
        refreshTimer = setInterval(tick, systemConfig.refreshInterval * 1000);

        saveState();
        addLog('info', '系统配置已更新并保存');
        alert('配置已保存');
    });

    // 导出按钮
    Q('#cfgExportCSV').addEventListener('click', exportAllHistoryCSV);
    Q('#cfgExportAlarms').addEventListener('click', exportAlarmsCSV);
    Q('#cfgExportLogs').addEventListener('click', exportLogsCSV);

    Q('#cfgClearData').addEventListener('click', () => {
        if (confirm('确定要清除所有历史数据、告警记录和运行日志吗？此操作不可恢复！')) {
            clearAllData(); alert('已清除所有数据');
        }
    });

    // ---- 数据源配置 ----
    const dsTypeSelect = Q('#cfgDataSourceType');
    const dsUrlGroup = Q('#dsUrlGroup');
    const dsUrlInput = Q('#cfgDataSourceUrl');
    const dsApplyBtn = Q('#cfgApplyDS');
    const dsStatus = Q('#cfgDSStatus');

    // 初始状态
    const savedType = systemConfig.dataSourceType || 'backend';
    dsTypeSelect.value = savedType;
    if (savedType !== 'simulation' && savedType !== 'backend') {
        dsUrlGroup.style.display = 'block';
        const savedUrl = (systemConfig.dataSourceConfig && systemConfig.dataSourceConfig.url) || '';
        if (savedUrl) dsUrlInput.value = savedUrl;
    }
    dsStatus.textContent = dataSource ? `当前: ${dataSource.name}` : '';

    dsTypeSelect.addEventListener('change', () => {
        const show = dsTypeSelect.value !== 'simulation' && dsTypeSelect.value !== 'backend';
        dsUrlGroup.style.display = show ? 'block' : 'none';
        if (!show) { dsUrlInput.value = ''; }
        else if (dsTypeSelect.value === 'http') {
            if (!dsUrlInput.value || dsUrlInput.value.startsWith('ws://')) dsUrlInput.value = 'http://192.168.1.100/api/sensors';
        } else if (dsTypeSelect.value === 'websocket') {
            if (!dsUrlInput.value || dsUrlInput.value.startsWith('http://')) dsUrlInput.value = 'ws://192.168.1.100:81';
        }
    });

    dsApplyBtn.addEventListener('click', async () => {
        const type = dsTypeSelect.value;
        const config = (type !== 'simulation' && type !== 'backend') ? { url: dsUrlInput.value.trim() } : {};
        dsApplyBtn.disabled = true;
        dsApplyBtn.textContent = '切换中...';
        dsStatus.textContent = '正在连接...';

        try {
            await switchDataSource(type, config);
            dsApplyBtn.textContent = '应用数据源';
            dsApplyBtn.disabled = false;
            dsStatus.textContent = ` 已切换: ${dataSource.name}`;
            dsStatus.style.color = 'var(--green)';
            addLog('info', `数据源已切换为: ${dataSource.name}`);
        } catch (e) {
            dsApplyBtn.textContent = '应用数据源';
            dsApplyBtn.disabled = false;
            dsStatus.textContent = ` 切换失败: ${e.message}`;
            dsStatus.style.color = 'var(--red)';
        }
    });
}

// ==================== LOGS PAGE ====================
function renderLogsPage() {
    const levelFilter = Q('#logFilterLevel').value;
    let filtered = operationLogs;
    if (levelFilter !== 'all') filtered = filtered.filter(l => l.level === levelFilter);

    Q('#logContainer').innerHTML = filtered.length === 0
        ? '<div class="log-empty">暂无日志记录</div>'
        : filtered.slice(0, 300).map(l => `
            <div class="log-line">
                <span class="log-time">${fmtTime(l.time)}</span>
                <span class="log-tag ${l.level}">${l.level.toUpperCase()}</span>
                <span class="log-msg">${l.msg}</span>
            </div>`).join('');
    Q('#logCount').textContent = `共 ${operationLogs.length} 条`;
}

Q('#logFilterLevel').addEventListener('change', renderLogsPage);
Q('#logClearBtn').addEventListener('click', () => {
    operationLogs = [];
    renderLogsPage();
});

// ==================== 节点详情模态框 ====================
function openNodeModal(nodeId) {
    const node = nodeStates[nodeId - 1];
    if (!node || !node.online) return;
    const d = node.currentData;
    const stats = getZoneStats(nodeId);
    const pmLvl = getDustLevel(d.dust_level);

    // 创建/更新模态框
    let overlay = Q('.modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-box">
            <div class="modal-box-header"><h3></h3><button class="modal-close">&times;</button></div>
            <div class="modal-box-body"></div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('active'); });
        Q('.modal-close', overlay).addEventListener('click', () => overlay.classList.remove('active'));
    }

    Q('.modal-box-header h3', overlay).textContent = `节点 ${nodeId} — ${node.zone.name}`;
    Q('.modal-box-body', overlay).innerHTML = `
        <div class="modal-detail-grid">
            <div class="modal-detail-item">
                <div class="modal-detail-label">当前温度</div>
                <div class="modal-detail-value" style="color:#f97316">${d.temperature.toFixed(1)} °C</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">当前湿度</div>
                <div class="modal-detail-value" style="color:#38bdf8">${d.humidity.toFixed(1)} %</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">粉尘浓度</div>
                <div class="modal-detail-value" style="color:${pmLvl.color}">${d.dust_level} ug/m³</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">粉尘峰值</div>
                <div class="modal-detail-value">${d.dust_peak} ug/m³</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">电量</div>
                <div class="modal-detail-value">${d.battery}%</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">最后更新</div>
                <div class="modal-detail-value" style="font-size:14px">${fmtDateTime(d.timestamp)}</div>
            </div>
        </div>
        ${stats ? `
        <div style="margin-top:16px"><h4 style="color:var(--text-secondary);margin-bottom:8px">统计摘要（${stats.count}条数据）</h4>
        <div class="modal-detail-grid">
            <div class="modal-detail-item">
                <div class="modal-detail-label">温度范围</div>
                <div class="modal-detail-value" style="font-size:14px">${stats.temp.min}~${stats.temp.max}°C</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">湿度范围</div>
                <div class="modal-detail-value" style="font-size:14px">${stats.hum.min}~${stats.hum.max}%</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">粉尘浓度范围</div>
                <div class="modal-detail-value" style="font-size:14px">${stats.dust.min}~${stats.dust.max}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">粉尘浓度均值</div>
                <div class="modal-detail-value" style="font-size:14px;color:${getDustLevel(stats.dust.avg).color}">${stats.dust.avg}</div>
            </div>
        </div></div>` : ''}
        <div style="margin-top:12px;font-size:11px;color:var(--text-muted)">区域描述：${node.zone.desc}</div>
    `;
    overlay.classList.add('active');
}

// ==================== 导出按钮 ====================
Q('#btnExport').addEventListener('click', exportAllHistoryCSV);
Q('#btnRefresh').addEventListener('click', () => { tick(); addLog('info', '手动刷新完成'); });

// ==================== 主循环 ====================
function tick() {
    updateAllNodes();
    updateClock();
    updateAlarmBadge();  // 全局更新告警徽章

    // 仅渲染当前页面相关的内容
    if (currentPage === 'dashboard') {
        renderDashboard();
        updateDashTrendChart();
        updateDashBarChart();
    } else if (currentPage === 'alarms') {
        renderAlarmsPage();
    } else if (currentPage === 'analytics') {
        updateAnalyticsCharts();
        renderAnalyticsTable();
    } else if (currentPage === 'nodes') {
        updateNodesPage();
    } else if (currentPage === 'history') {
        // 只在有筛选条件变化时查询
    }
}

// ==================== 键盘快捷键 ====================
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const overlay = Q('.modal-overlay');
        if (overlay) overlay.classList.remove('active');
    }
    // 数字键快速切换页面
    const pages = ['dashboard', 'history', 'alarms', 'analytics', 'nodes', 'settings', 'logs'];
    if (e.ctrlKey && e.key >= '1' && e.key <= '7') {
        e.preventDefault();
        navigateTo(pages[parseInt(e.key) - 1]);
    }
});

// ==================== 启动 ====================
async function boot() {
    await initDataEngine();
    generateInitialHistory();

    // 初始化设置页
    initSettings();

    // 初始渲染
    navigateTo('dashboard');
    tick();

    // 定时刷新
    refreshTimer = setInterval(tick, systemConfig.refreshInterval * 1000);

    const dsLabel = dataSource ? dataSource.name : '未知';
    addLog('info', `前端监测系统启动成功 (数据源: ${dsLabel})`);
    console.log('City Park Monitor v2.0 ready');
    console.log(`Data source: ${dsLabel} | Engine: running`);
}

document.addEventListener('DOMContentLoaded', () => { boot().catch(e => { console.error('启动失败:', e); addLog('error', `启动失败: ${e.message}`); }); });

// 页面关闭前保存
window.addEventListener('beforeunload', saveState);

// ==================== 手机端汉堡菜单 ====================
(function initMobileSidebar() {
    const hamburger = document.getElementById('hamburgerBtn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (!hamburger || !sidebar || !overlay) return;

    function openSidebar() {
        sidebar.classList.add('open');
        overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    hamburger.addEventListener('click', () => {
        if (sidebar.classList.contains('open')) closeSidebar();
        else openSidebar();
    });

    overlay.addEventListener('click', closeSidebar);

    // 点击导航项后自动关闭
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 480) closeSidebar();
        });
    });

    // 窗口大小变化时重置状态
    window.addEventListener('resize', () => {
        if (window.innerWidth > 480) closeSidebar();
    });
})();
