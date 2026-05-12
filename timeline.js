// ══════════════════════════════════════════════════════════════
// timeline.js — Family Activity Tab (Unified Timeline + Members)
// ══════════════════════════════════════════════════════════════
(function () {

let _activeFilter = 'all';
let _activeQAType = 'log';
let _tempLifecycleForTab = [];

// ── Build sorted unified entries ─────────────────────────────
function _buildEntries() {
    const entries = [];

    (tempLogs || []).forEach((log, i) => {
        entries.push({
            type: 'log', idx: i, data: log,
            date: log.date,
            ts: log.date ? new Date(log.date).getTime() : 0
        });
    });

    (tempTasks || []).forEach((task, i) => {
        entries.push({
            type: 'task', idx: i, data: task,
            date: task.date || task.created,
            ts: task.date ? new Date(task.date).getTime() : (task.created ? new Date(task.created).getTime() : 0)
        });
    });

    const lcData = typeof getLifecycleData === 'function' ? getLifecycleData() : [];
    lcData.forEach((lc, i) => {
        entries.push({
            type: 'lifecycle', idx: i, data: lc,
            date: lc.date,
            ts: lc.date ? new Date(lc.date).getTime() : 0
        });
    });

    const _tempMilestones = typeof tempMilestones !== 'undefined' ? tempMilestones : [];
    (_tempMilestones || []).forEach((ms, i) => {
        const dt = ms.gregDate || (ms.monthName && window.HebrewDate
            ? (() => { try { return HebrewDate.toGregorian(ms.monthName, ms.day, ms.year); } catch(e) { return null; } })()
            : null);
        entries.push({
            type: 'milestone', idx: i, data: ms,
            date: dt ? dt.toISOString().split('T')[0] : null,
            ts: dt ? dt.getTime() : 0
        });
    });

    return entries.sort((a, b) => b.ts - a.ts);
}

// ── Format date nicely ────────────────────────────────────────
function _fmtDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d)) return dateStr;
        const now = new Date();
        const diff = Math.floor((now - d) / 86400000);
        if (diff === 0) return 'היום';
        if (diff === 1) return 'אתמול';
        if (diff < 7) return `לפני ${diff} ימים`;
        return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch(e) { return dateStr; }
}

// ── Render one timeline entry ─────────────────────────────────
function _entryHtml(e) {
    const safe = s => (typeof escapeHTML === 'function' ? escapeHTML(s || '') : (s || ''));

    if (e.type === 'log') {
        const info = typeof getITypeInfo === 'function' ? getITypeInfo(e.data.interactionType || e.data.type) : { icon: 'fa-history', color: '#3b82f6' };
        const memberBadge = e.data.member ? `<span style="font-size:10px;background:var(--accent-light);color:var(--accent);padding:1px 5px;border-radius:8px;">${safe(e.data.member)}</span>` : '';
        return `<div class="unif-entry" data-type="log" data-idx="${e.idx}">
            <div class="unif-entry-icon" style="background:${info.color}18;">
                <i class="fas ${info.icon}" style="color:${info.color};"></i>
            </div>
            <div class="unif-entry-body">
                <div class="unif-entry-title">${safe(info.label)} ${memberBadge}</div>
                ${e.data.text ? `<div class="unif-entry-sub">${safe(e.data.text)}</div>` : ''}
            </div>
            <div class="unif-entry-date">${_fmtDate(e.date)}</div>
            <div class="unif-entry-actions">
                <button class="unif-entry-act-btn" onclick="event.stopPropagation();_tlDeleteLog(${e.idx})" title="מחק"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }

    if (e.type === 'task') {
        const done = e.data.done;
        const urgent = !done && e.data.date && new Date(e.data.date) < new Date();
        const col = done ? '#10b981' : urgent ? '#ef4444' : '#f59e0b';
        const memberBadge = e.data.member ? `<span style="font-size:10px;background:var(--accent-light);color:var(--accent);padding:1px 5px;border-radius:8px;">${safe(e.data.member)}</span>` : '';
        return `<div class="unif-entry${done ? ' entry-done' : ''}" data-type="task" data-idx="${e.idx}">
            <div class="unif-entry-icon" style="background:${col}18;">
                <i class="fas ${done ? 'fa-check-circle' : 'fa-clock'}" style="color:${col};"></i>
            </div>
            <div class="unif-entry-body">
                <div class="unif-entry-title">${safe(e.data.text)} ${memberBadge}</div>
                ${urgent && !done ? '<div class="unif-entry-sub" style="color:#ef4444;">באיחור</div>' : ''}
            </div>
            <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
                <div class="unif-entry-date">${_fmtDate(e.date)}</div>
                <button class="unif-entry-act-btn" style="background:${done?'rgba(239,68,68,.08)':'rgba(16,185,129,.08)'}; color:${done?'#ef4444':'#10b981'};" onclick="event.stopPropagation();_tlToggleTask(${e.idx})" title="${done?'ביטול':'סמן כבוצע'}">
                    <i class="fas ${done?'fa-undo':'fa-check'}"></i>
                </button>
                <div class="unif-entry-actions">
                    <button class="unif-entry-act-btn" onclick="event.stopPropagation();_tlDeleteTask(${e.idx})" title="מחק"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>`;
    }

    if (e.type === 'lifecycle') {
        return `<div class="unif-entry" data-type="lifecycle" data-idx="${e.idx}">
            <div class="unif-entry-icon" style="background:rgba(16,185,129,.12);">
                <i class="fas fa-seedling" style="color:#10b981;"></i>
            </div>
            <div class="unif-entry-body">
                <div class="unif-entry-title">${safe(e.data.type || 'אירוע חיים')}</div>
                ${e.data.notes ? `<div class="unif-entry-sub">${safe(e.data.notes)}</div>` : ''}
                ${e.data.member ? `<div class="unif-entry-sub"><i class="fas fa-user" style="font-size:9px;"></i> ${safe(e.data.member)}</div>` : ''}
            </div>
            <div class="unif-entry-date">${_fmtDate(e.date)}</div>
        </div>`;
    }

    if (e.type === 'milestone') {
        const ms = e.data;
        let hebDateStr = '';
        if (ms.monthName) {
            try {
                const monthHe = (window.HebrewDate && HebrewDate.MONTH_HE) ? HebrewDate.MONTH_HE[ms.monthName] : ms.monthName;
                let dayStr = ms.day ? ms.day.toString() : '';
                try { if (window.jewishDate) dayStr = jewishDate.convertNumberToHebrew(ms.day, false, false) || dayStr; } catch(ex) {}
                hebDateStr = `${dayStr} ${monthHe}${ms.year && !ms.recurring ? ' ' + ms.year : ''}`;
            } catch(ex) {}
        }
        const recurBadge = ms.recurring
            ? `<span style="font-size:10px;background:rgba(99,102,241,.1);color:#6366f1;padding:1px 5px;border-radius:8px;">🔄 ספירלי</span>`
            : `<span style="font-size:10px;background:rgba(239,68,68,.1);color:#ef4444;padding:1px 5px;border-radius:8px;">📌 חד פעמי</span>`;
        return `<div class="unif-entry" data-type="milestone" data-idx="${e.idx}">
            <div class="unif-entry-icon" style="background:rgba(219,39,119,.1); font-size:16px; border-radius:8px; width:30px; height:30px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${typeof getEventTypeById === 'function' ? (getEventTypeById(ms.type)?.emoji || '📅') : '📅'}
            </div>
            <div class="unif-entry-body">
                <div class="unif-entry-title">${safe(ms.label || ms.type)}</div>
                <div class="unif-entry-sub" style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
                    ${recurBadge}
                    ${hebDateStr ? `<span>📅 ${hebDateStr}</span>` : ''}
                    ${ms.childName ? `<span>👤 ${safe(ms.childName)}</span>` : ''}
                </div>
            </div>
        </div>`;
    }

    return '';
}

// ── Render member cards ───────────────────────────────────────
function _renderMemberCards(container) {
    const members = [];
    if (typeof tempChildren !== 'undefined') {
        const father = document.getElementById('cFather')?.value;
        const mother = document.getElementById('cMother')?.value;
        if (father) members.push({ name: father, role: 'אב', color: '#3b82f6', initial: father[0] });
        if (mother) members.push({ name: mother, role: 'אם', color: '#db2777', initial: mother[0] });
        (tempChildren || []).forEach(c => {
            if (c.name) members.push({ name: c.name, role: 'ילד', color: '#8b5cf6', initial: c.name[0] });
        });
    }

    if (!members.length) { container.innerHTML = ''; return; }

    container.innerHTML = `<div class="member-cards-row">` +
        members.map(m => {
            const safe = s => (typeof escapeHTML === 'function' ? escapeHTML(s || '') : (s || ''));
            return `<div class="member-card">
                <div class="member-card-avatar" style="background:${m.color};">${safe(m.initial || '?')}</div>
                <div class="member-card-name">${safe(m.name)}</div>
                <div class="member-card-role">${m.role}</div>
            </div>`;
        }).join('') +
    `</div>`;
}

// ── Render connection circles ─────────────────────────────────
function _renderConnectionCircles(container) {
    const apt = currentBldg && typeof db !== 'undefined' && db[currentBldg] ? db[currentBldg].apts[currentAptIdx] : null;
    const circles = apt?.connectionCircles || [];
    const allCircles = appSettings?.connectionCircles || [];

    const safe = s => (typeof escapeHTML === 'function' ? escapeHTML(s || '') : (s || ''));

    let html = `<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;"><i class="fas fa-circle-notch" style="color:var(--accent);"></i> מעגלי קשר</div>
    <div class="conn-circles-wrap">`;

    allCircles.forEach(circle => {
        const isActive = circles.includes(circle.id);
        html += `<button class="conn-circle-chip${isActive ? ' active-circle' : ''}" onclick="_tlToggleCircle('${circle.id}')">
            <span>${safe(circle.emoji || '●')}</span><span>${safe(circle.label)}</span>
        </button>`;
    });

    html += `<button class="conn-circle-add" onclick="_tlAddCircle()" title="הוסף מעגל"><i class="fas fa-plus"></i></button>
    </div>`;

    container.innerHTML = html;
}

// ── Render personal goal ──────────────────────────────────────
function _renderPersonalGoal(container) {
    const apt = currentBldg && typeof db !== 'undefined' && db[currentBldg] ? db[currentBldg].apts[currentAptIdx] : null;
    const goal = apt?.personalGoal || '';
    const safe = s => (typeof escapeHTML === 'function' ? escapeHTML(s || '') : (s || ''));

    container.innerHTML = `<button class="family-goal-widget" onclick="_tlEditGoal()">
        <i class="fas fa-trophy" style="color:#f59e0b; font-size:14px;"></i>
        <div style="flex:1; text-align:right;">
            <div style="font-size:10px;color:var(--text-muted);font-weight:600;">יעד אישי למשפחה</div>
            <div style="font-size:12px;font-weight:700;color:var(--text-main);">${goal ? safe(goal) : '<span style="color:var(--text-hint);">הגדר יעד...</span>'}</div>
        </div>
        <i class="fas fa-pen" style="font-size:10px;color:var(--text-hint);"></i>
    </button>`;
}

// ── Render quick-add form section ─────────────────────────────
function _renderQuickAdd(container) {
    container.innerHTML = `
    <div class="quick-add-section">
        <div class="quick-add-type-nav">
            <button class="qa-type-btn active" id="qa-btn-log" onclick="_qaSwitch('log')"><i class="fas fa-history"></i> תיעוד</button>
            <button class="qa-type-btn" id="qa-btn-task" onclick="_qaSwitch('task')"><i class="fas fa-check"></i> משימה</button>
            <button class="qa-type-btn" id="qa-btn-lifecycle" onclick="_qaSwitch('lifecycle')"><i class="fas fa-seedling"></i> אירוע חיים</button>
            <button class="qa-type-btn" id="qa-btn-milestone" onclick="_qaSwitch('milestone')"><i class="fas fa-calendar-alt"></i> יומן</button>
        </div>
        <div class="quick-add-body">
            <!-- Log form -->
            <div class="quick-add-form active" id="qa-form-log">
                <div style="display:flex;gap:6px;margin-bottom:6px;">
                    <input type="date" id="newLogDate" class="inline-input" style="flex:1;">
                    <select id="newLogType" class="inline-input" style="flex:1;" onchange="_updateDirectionBadge&&_updateDirectionBadge(this.value)"></select>
                </div>
                <div id="logDirectionBadge" style="display:flex;align-items:center;gap:6px;font-size:12px;"></div>
                <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
                    <label style="font-size:11px;color:var(--text-muted);white-space:nowrap;">עבור מי:</label>
                    <select id="newLogMember" class="inline-input" style="flex:1;font-size:12px;"></select>
                </div>
                <textarea id="newLogText" class="inline-input" rows="2" placeholder="מה היה?" style="margin-bottom:8px;font-size:13px;"></textarea>
                <button class="btn btn-outline" style="font-size:12px;padding:6px;width:100%;" onclick="addInteractionLog()"><i class="fas fa-plus"></i> שמור תיעוד</button>
            </div>
            <!-- Task form -->
            <div class="quick-add-form" id="qa-form-task">
                <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
                    <input type="text" id="newTaskText" class="inline-input" placeholder="מה צריך לעשות?" style="flex:2;min-width:140px;font-size:13px;">
                    <input type="date" id="newTaskDate" class="inline-input" style="flex:1;">
                </div>
                <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">
                    <label style="font-size:11px;color:var(--text-muted);white-space:nowrap;">עבור מי:</label>
                    <select id="newTaskMember" class="inline-input" style="flex:1;font-size:12px;"></select>
                </div>
                <button class="btn btn-outline" style="font-size:12px;padding:6px;width:100%;" onclick="addTask()"><i class="fas fa-plus"></i> הוסף משימה</button>
            </div>
            <!-- Lifecycle form -->
            <div class="quick-add-form" id="qa-form-lifecycle">
                <div style="display:flex;gap:6px;margin-bottom:6px;">
                    <select id="lcType" class="inline-input" style="flex:1;font-size:13px;"></select>
                    <input type="date" id="lcDate" class="inline-input" style="flex:1;">
                </div>
                <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
                    <label style="font-size:11px;color:var(--text-muted);white-space:nowrap;">עבור מי:</label>
                    <select id="lcMember" class="inline-input" style="flex:1;font-size:12px;"></select>
                </div>
                <input type="text" id="lcNotes" class="inline-input" placeholder="הערות (רשות)" style="margin-bottom:8px;font-size:13px;">
                <button class="btn btn-success" style="font-size:12px;padding:6px;width:100%;" onclick="addLifecycleEvent()"><i class="fas fa-magic"></i> רשום אירוע חיים</button>
            </div>
            <!-- Milestone tab (link to milestones) -->
            <div class="quick-add-form" id="qa-form-milestone">
                <div style="text-align:center;padding:12px 0;color:var(--text-muted);font-size:13px;">
                    <i class="fas fa-calendar-alt" style="font-size:20px;margin-bottom:8px;display:block;color:var(--accent);"></i>
                    ניהול יומן ואירועים ספירליים בלשונית ייעודית
                </div>
                <button class="btn btn-outline" style="font-size:12px;padding:6px;width:100%;" onclick="_tlOpenMilestones()"><i class="fas fa-external-link-alt"></i> פתח יומן אירועים</button>
            </div>
        </div>
    </div>`;

    // Populate dropdowns
    if (typeof _populateLogTypeSelect === 'function') _populateLogTypeSelect();
    if (typeof refreshMemberDropdowns === 'function') refreshMemberDropdowns();
    if (typeof _populateLifecycleTypeSelect === 'function') _populateLifecycleTypeSelect();
}

// ── Main render function ──────────────────────────────────────
window.renderFamilyActivityTab = function () {
    const root = document.getElementById('family-activity-root');
    if (!root) return;

    // Build the layout
    root.innerHTML = `
        <!-- Score row -->
        <div id="fam-act-score" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;"></div>

        <!-- Member cards -->
        <div id="fam-act-members" style="margin-bottom:12px;"></div>

        <!-- Meta row: circles + goal -->
        <div class="fam-act-meta-row" style="margin-bottom:14px;">
            <div id="fam-act-circles" style="background:var(--surface);border:1px solid var(--border-light);border-radius:12px;padding:10px 12px;"></div>
            <div id="fam-act-goal"></div>
        </div>

        <!-- Timeline filter -->
        <div class="timeline-filter-bar" id="fam-act-filters">
            <button class="tl-filter-btn active" onclick="_tlSetFilter('all')">הכל</button>
            <button class="tl-filter-btn" onclick="_tlSetFilter('log')"><i class="fas fa-history"></i> תיעודים</button>
            <button class="tl-filter-btn" onclick="_tlSetFilter('task')"><i class="fas fa-check"></i> משימות</button>
            <button class="tl-filter-btn" onclick="_tlSetFilter('lifecycle')"><i class="fas fa-seedling"></i> אירועי חיים</button>
            <button class="tl-filter-btn" onclick="_tlSetFilter('milestone')"><i class="fas fa-calendar-alt"></i> יומן</button>
        </div>

        <!-- Unified timeline -->
        <div class="unif-timeline" id="fam-act-timeline"></div>

        <!-- Quick add -->
        <div id="fam-act-quick-add" style="margin-top:14px;"></div>
    `;

    // Populate sub-sections
    _renderMemberCards(document.getElementById('fam-act-members'));
    _renderConnectionCircles(document.getElementById('fam-act-circles'));
    _renderPersonalGoal(document.getElementById('fam-act-goal'));
    _renderQuickAdd(document.getElementById('fam-act-quick-add'));

    // Score badges
    const scoreEl = document.getElementById('fam-act-score');
    if (scoreEl && typeof computeEngagementScore === 'function') {
        const apt = currentBldg && db?.[currentBldg]?.apts?.[currentAptIdx];
        if (apt) {
            const score = computeEngagementScore(apt);
            const days  = typeof getLastContactDays === 'function' ? getLastContactDays(apt) : null;
            scoreEl.innerHTML =
                (typeof renderScoreBadge === 'function' ? renderScoreBadge(score) : '') +
                (typeof renderLastContactBadge === 'function' ? renderLastContactBadge(days) : '');
        }
    }

    // Set today's date on forms
    const today = new Date().toISOString().split('T')[0];
    const ldEl = document.getElementById('newLogDate');
    const tdEl = document.getElementById('newTaskDate');
    const lcDEl = document.getElementById('lcDate');
    if (ldEl && !ldEl.value) ldEl.value = today;
    if (tdEl && !tdEl.value) tdEl.value = today;
    if (lcDEl && !lcDEl.value) lcDEl.value = today;

    // Render timeline
    _tlRenderTimeline();
};

// ── Render timeline entries ───────────────────────────────────
function _tlRenderTimeline() {
    const container = document.getElementById('fam-act-timeline');
    if (!container) return;

    const entries = _buildEntries().filter(e => _activeFilter === 'all' || e.type === _activeFilter);

    if (!entries.length) {
        container.innerHTML = `<div style="text-align:center;padding:32px 20px;color:var(--text-muted);">
            <i class="fas fa-history" style="font-size:28px;opacity:.2;display:block;margin-bottom:10px;"></i>
            <div>${_activeFilter === 'all' ? 'אין פעילות מתועדת עדיין' : 'אין רשומות מסוג זה'}</div>
        </div>`;
        return;
    }

    container.innerHTML = entries.map(_entryHtml).join('');
}

// ── Filter handler ────────────────────────────────────────────
window._tlSetFilter = function (filter) {
    _activeFilter = filter;
    document.querySelectorAll('#fam-act-filters .tl-filter-btn')
        .forEach(b => b.classList.remove('active'));
    const idx = ['all', 'log', 'task', 'lifecycle', 'milestone'].indexOf(filter);
    const btns = document.querySelectorAll('#fam-act-filters .tl-filter-btn');
    if (btns[idx]) btns[idx].classList.add('active');
    _tlRenderTimeline();
};

// ── Quick-add type switcher ───────────────────────────────────
window._qaSwitch = function (type) {
    _activeQAType = type;
    document.querySelectorAll('.qa-type-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('qa-btn-' + type);
    if (btn) btn.classList.add('active');
    document.querySelectorAll('.quick-add-form').forEach(f => f.classList.remove('active'));
    const form = document.getElementById('qa-form-' + type);
    if (form) form.classList.add('active');
};

// ── Delete handlers ───────────────────────────────────────────
window._tlDeleteLog = function (idx) {
    if (typeof tempLogs !== 'undefined') { tempLogs.splice(idx, 1); markDirty && markDirty(); }
    renderLogs && renderLogs();
    if (typeof updateEngagementDisplay === 'function') updateEngagementDisplay(currentBldg, currentAptIdx);
    renderFamilyActivityTab();
};

window._tlDeleteTask = function (idx) {
    if (typeof tempTasks !== 'undefined') { tempTasks.splice(idx, 1); markDirty && markDirty(); }
    renderTasks && renderTasks();
    renderFamilyActivityTab();
};

window._tlToggleTask = function (idx) {
    if (typeof tempTasks !== 'undefined' && tempTasks[idx]) {
        tempTasks[idx].done = !tempTasks[idx].done;
        markDirty && markDirty();
        renderTasks && renderTasks();
        renderFamilyActivityTab();
    }
};

// ── Connection circles ────────────────────────────────────────
window._tlToggleCircle = function (circleId) {
    const apt = currentBldg && db?.[currentBldg]?.apts?.[currentAptIdx];
    if (!apt) return;
    if (!apt.connectionCircles) apt.connectionCircles = [];
    const idx = apt.connectionCircles.indexOf(circleId);
    if (idx === -1) apt.connectionCircles.push(circleId);
    else apt.connectionCircles.splice(idx, 1);
    markDirty && markDirty();
    _renderConnectionCircles(document.getElementById('fam-act-circles'));
};

window._tlAddCircle = async function () {
    if (!appSettings.connectionCircles) appSettings.connectionCircles = [];
    const label = await showCustomDialog({ title: 'מעגל קשר חדש', message: 'שם המעגל:', showInput: true, showCancel: true });
    if (!label) return;
    const id = 'circle_' + Date.now();
    appSettings.connectionCircles.push({ id, label, emoji: '🔵' });
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    _renderConnectionCircles(document.getElementById('fam-act-circles'));
};

// ── Personal goal ─────────────────────────────────────────────
window._tlEditGoal = async function () {
    const apt = currentBldg && db?.[currentBldg]?.apts?.[currentAptIdx];
    if (!apt) return;
    const current = apt.personalGoal || '';
    const newGoal = await showCustomDialog({ title: 'יעד אישי למשפחה', message: 'מה היעד שלך עם משפחה זו?', showInput: true, defaultValue: current, showCancel: true });
    if (newGoal === null) return;
    apt.personalGoal = newGoal;
    markDirty && markDirty();
    _renderPersonalGoal(document.getElementById('fam-act-goal'));
};

// ── Open milestones (legacy tab) ──────────────────────────────
window._tlOpenMilestones = function () {
    // Show the hidden milestones tab temporarily for editing
    const msTab = document.getElementById('crm-milestones');
    const msBtn = document.getElementById('tabBtn-milestones');
    if (msTab && msBtn) {
        msTab.style.display = 'block';
        msBtn.style.display = 'block';
        if (typeof switchCrmTab === 'function') switchCrmTab('milestones');
    }
};

// ── Refresh after add actions ─────────────────────────────────
// Monkey-patch addInteractionLog, addTask to refresh timeline
const _origAddLog = window.addInteractionLog;
window.addInteractionLog = function () {
    _origAddLog && _origAddLog.apply(this, arguments);
    const isActive = document.getElementById('crm-activity')?.classList.contains('active');
    if (isActive) renderFamilyActivityTab();
};

const _origAddTask = window.addTask;
window.addTask = function () {
    _origAddTask && _origAddTask.apply(this, arguments);
    const isActive = document.getElementById('crm-activity')?.classList.contains('active');
    if (isActive) renderFamilyActivityTab();
};

const _origAddLifecycle = window.addLifecycleEvent;
window.addLifecycleEvent = function () {
    _origAddLifecycle && _origAddLifecycle.apply(this, arguments);
    const isActive = document.getElementById('crm-activity')?.classList.contains('active');
    if (isActive) renderFamilyActivityTab();
};

})();
