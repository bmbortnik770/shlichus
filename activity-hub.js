// ══════════════════════════════════════════════════════════════
// activity-hub.js — Global Activity Hub (Dashboard + Sub-nav)
// ══════════════════════════════════════════════════════════════
(function () {

let _activeSub = 'dashboard';

// ── Switch between sub-views ──────────────────────────────────
window.switchActivitySub = function (sub) {
    _activeSub = sub;
    window._activeActivitySub = sub;

    // Update sub-nav buttons
    document.querySelectorAll('.act-sub-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('actSub-' + sub);
    if (btn) btn.classList.add('active');

    // Hide all sub-containers
    const dashboard = document.getElementById('activity-dashboard');
    const tasks = document.getElementById('tasks-container');
    const events = document.getElementById('events-container');
    const kanban = document.getElementById('kanban-container');

    [dashboard, tasks, events, kanban].forEach(el => {
        if (el) el.style.display = 'none';
    });

    // Show chosen sub-view
    if (sub === 'dashboard') {
        if (dashboard) { dashboard.style.display = 'flex'; renderActivityDashboard(); }
    } else if (sub === 'tasks') {
        if (tasks) {
            tasks.style.display = 'flex';
            const dateEl = document.getElementById('globalTaskDate');
            if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
            if (typeof renderGlobalTasks === 'function') renderGlobalTasks();
        }
    } else if (sub === 'events') {
        if (events) {
            events.style.display = 'flex';
            if (typeof _initEventsView === 'function') _initEventsView();
            if (typeof renderEventsView === 'function') renderEventsView();
        }
    } else if (sub === 'kanban') {
        if (kanban) {
            kanban.style.display = 'flex';
            if (typeof renderKanbanView === 'function') renderKanbanView();
        }
    }
};

// ── Dashboard render ──────────────────────────────────────────
window.renderActivityDashboard = function () {
    const dash = document.getElementById('activity-dashboard');
    if (!dash) return;
    if (typeof db === 'undefined') { dash.innerHTML = '<div style="color:var(--text-muted);padding:20px;">טוען...</div>'; return; }

    // Compute stats
    let totalFamilies = 0, openTasks = 0, totalLogs = 0;
    const atRisk = typeof getAtRiskFamilies === 'function' ? getAtRiskFamilies(30) : [];

    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach(apt => {
            totalFamilies++;
            openTasks += (apt.tasks || []).filter(t => !t.done).length;
            totalLogs += (apt.interactions || []).length;
        });
    });

    // Recent global tasks
    const allTasks = [];
    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach((apt, idx) => {
            (apt.tasks || []).filter(t => !t.done).forEach(t => {
                allTasks.push({ task: t, bldg, idx, aptName: apt.name || '' });
            });
        });
    });
    const urgentTasks = allTasks
        .filter(t => t.task.date && new Date(t.task.date) <= new Date())
        .sort((a, b) => new Date(a.task.date) - new Date(b.task.date))
        .slice(0, 8);

    const safe = s => (typeof escapeHTML === 'function' ? escapeHTML(s || '') : (s || ''));
    const _fmtD = d => { if (!d) return ''; try { const dt = new Date(d); return dt.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit' }); } catch(e) { return d; } };

    // Stats section
    let html = `<div class="dash-stat-grid">
        <div class="dash-stat-card">
            <div class="dash-stat-value" style="color:var(--accent);">${totalFamilies}</div>
            <div class="dash-stat-label">משפחות בקהילה</div>
        </div>
        <div class="dash-stat-card">
            <div class="dash-stat-value" style="color:${openTasks > 0 ? '#f59e0b' : '#10b981'};">${openTasks}</div>
            <div class="dash-stat-label">משימות פתוחות</div>
        </div>
        <div class="dash-stat-card">
            <div class="dash-stat-value" style="color:#8b5cf6;">${totalLogs}</div>
            <div class="dash-stat-label">תיעודים סה"כ</div>
        </div>
        <div class="dash-stat-card">
            <div class="dash-stat-value" style="color:${atRisk.length > 5 ? '#ef4444' : '#10b981'};">${atRisk.length}</div>
            <div class="dash-stat-label">דורש קשר (30+ יום)</div>
        </div>
    </div>`;

    // Urgent tasks
    if (urgentTasks.length > 0) {
        html += `<div>
            <div class="dash-section-title">
                <i class="fas fa-exclamation-circle" style="color:var(--danger);"></i>
                משימות בדחיפות גבוהה (${urgentTasks.length})
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">
                ${urgentTasks.map(t => `<div class="at-risk-row" onclick="currentBldg='${safe(t.bldg)}'; openClientCard(${t.idx}); switchCrmTab('activity');">
                    <div style="width:28px;height:28px;border-radius:7px;background:rgba(239,68,68,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-clock" style="color:var(--danger);font-size:12px;"></i>
                    </div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:600;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safe(t.task.text)}</div>
                        <div style="font-size:11px;color:var(--text-muted);">משפחת ${safe(t.aptName)}</div>
                    </div>
                    <span class="at-risk-days-badge" style="background:rgba(239,68,68,.1);color:#ef4444;">${_fmtD(t.task.date)}</span>
                </div>`).join('')}
            </div>
        </div>`;
    }

    // At-risk families
    if (atRisk.length > 0) {
        html += `<div>
            <div class="dash-section-title">
                <i class="fas fa-user-clock" style="color:#f59e0b;"></i>
                משפחות שדורשות קשר (${Math.min(atRisk.length, 10)} מתוך ${atRisk.length})
                <button onclick="switchActivitySub('tasks')" style="margin-right:auto;font-size:11px;padding:3px 8px;border-radius:8px;border:1px solid var(--border-light);background:var(--surface);color:var(--text-muted);cursor:pointer;font-family:inherit;">כל המשימות</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">
                ${atRisk.slice(0, 10).map(f => {
                    const daysStr = f.days === null ? 'ללא תיעוד' : `${f.days} יום`;
                    const col = f.days === null || f.days > 60 ? '#ef4444' : f.days > 30 ? '#f59e0b' : '#94a3b8';
                    return `<div class="at-risk-row" onclick="currentBldg='${safe(f.bldg)}'; openClientCard(${f.idx}); switchCrmTab('activity');">
                        <div style="width:28px;height:28px;border-radius:7px;background:${col}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <i class="fas fa-user" style="color:${col};font-size:12px;"></i>
                        </div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;color:var(--text-main);">${safe(f.apt.name || '(ללא שם)')}</div>
                            <div style="font-size:11px;color:var(--text-muted);">${safe(f.bldg === '__NO_ADDRESS__' ? 'ללא כתובת' : f.bldg)}</div>
                        </div>
                        <span class="at-risk-days-badge" style="background:${col}18;color:${col};">${daysStr}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }

    if (!html.includes('dash-section-title')) {
        html += `<div style="text-align:center;padding:40px;color:var(--text-muted);">
            <i class="fas fa-check-circle" style="font-size:36px;color:#10b981;display:block;margin-bottom:12px;"></i>
            <div style="font-size:16px;font-weight:700;">הכל מסודר!</div>
            <div style="font-size:13px;margin-top:6px;">אין משימות דחופות או משפחות ממתינות לקשר</div>
        </div>`;
    }

    dash.innerHTML = html;
};

// ── Auto-render when activity view becomes active ─────────────
const _origSwitchMainView = window.switchMainView;
window.switchMainView = function (viewName) {
    // Handle old aliases
    if (viewName === 'table') { viewName = 'community'; }
    if (viewName === 'kanban') {
        _origSwitchMainView('activity');
        switchActivitySub('kanban');
        return;
    }
    if (viewName === 'tasks') {
        _origSwitchMainView('activity');
        switchActivitySub('tasks');
        return;
    }
    _origSwitchMainView(viewName);
    if (viewName === 'activity') {
        switchActivitySub(_activeSub || 'dashboard');
    }
};

})();
