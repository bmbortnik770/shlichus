// ══════════════════════════════════════════════════════════════
// lifecycle.js — Lifecycle Events & Smart Automations
// ══════════════════════════════════════════════════════════════
(function () {

const EV_TYPES = [
    { key: 'birth',       label: 'לידה',            icon: 'fa-baby',              color: '#10b981' },
    { key: 'death',       label: 'פטירה',            icon: 'fa-dove',              color: '#64748b' },
    { key: 'bar_mitzvah', label: 'בר מצווה',         icon: 'fa-torah',             color: '#f59e0b' },
    { key: 'bat_mitzvah', label: 'בת מצווה',         icon: 'fa-torah',             color: '#ec4899' },
    { key: 'wedding',     label: 'חתונה',            icon: 'fa-heart',             color: '#ef4444' },
    { key: 'engagement',  label: 'אירוסין',          icon: 'fa-ring',              color: '#f97316' },
    { key: 'divorce',     label: 'גירושין',          icon: 'fa-unlink',            color: '#94a3b8' },
    { key: 'illness',     label: 'מחלה',             icon: 'fa-procedures',        color: '#f97316' },
    { key: 'recovery',    label: 'החלמה',            icon: 'fa-hand-holding-heart',color: '#10b981' },
    { key: 'aliya',       label: 'עלייה / כניסה',   icon: 'fa-plane-arrival',     color: '#3b82f6' },
    { key: 'moved_out',   label: 'עזיבה',            icon: 'fa-plane-departure',   color: '#94a3b8' },
    { key: 'other',       label: 'אחר',              icon: 'fa-star',              color: '#8b5cf6' },
];

// Each trigger: offset in days from event date. Negative = before.
const TRIGGERS = {
    birth: [
        { offset: 0,   text: 'נולד — ליצור קשר ולברך' },
        { offset: 8,   text: 'ברית מילה — האם השתתפת?' },
        { offset: 1,   text: 'בת? לבדוק קידוש בשבת הקרובה' },
        { offset: 30,  text: 'פדיון הבן — לבדוק' },
    ],
    death: [
        { offset: 0,   text: 'ניחום אבלים — לבקר בשבעה' },
        { offset: 7,   text: 'סוף שבעה — לברר ולהתקשר' },
        { offset: 30,  text: 'שלושים — ליצור קשר' },
        { offset: 365, text: 'יארצייט ראשון — לאזכר' },
    ],
    bar_mitzvah: [
        { offset: -30, text: 'בר מצווה בעוד חודש — לתכנן' },
        { offset: -7,  text: 'בר מצווה בעוד שבוע!' },
        { offset: 0,   text: 'בר מצווה — לשלוח ברכה' },
    ],
    bat_mitzvah: [
        { offset: -30, text: 'בת מצווה בעוד חודש — לתכנן' },
        { offset: -7,  text: 'בת מצווה בעוד שבוע!' },
        { offset: 0,   text: 'בת מצווה — לשלוח ברכה' },
    ],
    wedding: [
        { offset: 0,   text: 'חתונה — לשלוח ברכה ומתנה' },
        { offset: 365, text: 'יום נישואין ראשון — לברך' },
    ],
    engagement: [
        { offset: 0,   text: 'אירוסין — לברך' },
        { offset: 30,  text: 'לעקוב — מתי החתונה?' },
    ],
    illness: [
        { offset: 0,  text: 'מחלה — לבקר / להתקשר' },
        { offset: 14, text: 'מעקב בריאות — כיצד מרגישים?' },
    ],
    aliya: [
        { offset: 0,  text: 'עלייה / הגעה — לברך ולקבל פנים' },
        { offset: 7,  text: 'לבדוק אם צריכים עזרה' },
        { offset: 30, text: 'לוודא שהמשפחה השתלבה' },
    ],
};

let tempLifecycle = [];

// ── Public API ────────────────────────────────────────────────
window.initLifecycle = function (apt) {
    tempLifecycle = JSON.parse(JSON.stringify(apt.lifecycleEvents || []));
    _populateLcTypes();
    _populateLcMember();
    renderLifecycleSection();
};

window.getLifecycleData = function () { return [...tempLifecycle]; };

window.renderLifecycleSection = function () {
    const c = document.getElementById('lifecycleList');
    if (!c) return;
    if (!tempLifecycle.length) {
        c.innerHTML = `<div class="empty-state" style="padding:20px;">
            <i class="fas fa-seedling" style="font-size:28px;opacity:.2;margin-bottom:8px;"></i>
            <div>לא נרשמו אירועי חיים</div></div>`;
        return;
    }
    c.innerHTML = [...tempLifecycle].reverse().map((ev, ri) => {
        const i   = tempLifecycle.length - 1 - ri;
        const def = _evDef(ev.type);
        return `<div class="log-item lc-event-row" style="border-right:3px solid ${def.color};">
            <div class="log-header">
                <span style="font-weight:600;">
                    <i class="fas ${def.icon}" style="color:${def.color};margin-left:6px;"></i>
                    ${def.label}
                    ${ev.memberName ? `<span class="member-badge" style="margin-right:6px;">${escapeHTML(ev.memberName)}</span>` : ''}
                </span>
                <div style="display:flex;gap:8px;align-items:center;">
                    <span style="color:var(--text-muted);font-size:11px;">${ev.date || ''}</span>
                    <button onclick="removeLifecycleEvent(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:0;"><i class="fas fa-times"></i></button>
                </div>
            </div>
            ${ev.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${escapeHTML(ev.notes)}</div>` : ''}
            ${ev.autoTasks ? `<div style="font-size:11px;color:#10b981;margin-top:4px;"><i class="fas fa-magic"></i> ${ev.autoTasks} משימות אוטומטיות נוצרו</div>` : ''}
        </div>`;
    }).join('');
};

window.addLifecycleEvent = function () {
    const type   = document.getElementById('lcType')?.value;
    const date   = document.getElementById('lcDate')?.value;
    const member = document.getElementById('lcMember')?.value || 'family';
    const notes  = document.getElementById('lcNotes')?.value?.trim() || '';
    if (!type || !date) { showToast('יש למלא סוג ותאריך', 'warning'); return; }

    const memberName = _resolveName(member);
    const ev = { type, date, memberKey: member, memberName, notes };
    const tasks = _generateTasks(ev, memberName);
    ev.autoTasks = tasks.length;
    tempLifecycle.push(ev);

    if (typeof tempTasks !== 'undefined' && tasks.length) {
        tasks.forEach(t => tempTasks.push(t));
        if (typeof renderTasks === 'function') renderTasks();
    }

    if (typeof markDirty === 'function') markDirty();
    document.getElementById('lcNotes').value = '';
    renderLifecycleSection();
    showToast(tasks.length ? `✅ אירוע נרשם — ${tasks.length} משימות נוצרו אוטומטית` : 'אירוע נרשם', 'success');
};

window.removeLifecycleEvent = function (i) {
    tempLifecycle.splice(i, 1);
    if (typeof markDirty === 'function') markDirty();
    renderLifecycleSection();
};

// ── Global alert scanner (call on load / periodically) ───────
window.checkLifecycleAlerts = function () {
    if (typeof db === 'undefined') return [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const alerts = [];

    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach((apt, idx) => {

            // Children birthdays + bar/bat mitzvah
            (apt.childrenList || []).forEach(child => {
                if (!child.name) return;
                if (child.dob) {
                    const diff = _daysUntilNextAnniversary(child.dob, today);
                    if (diff >= 0 && diff <= 7)
                        alerts.push({ type: 'birthday', diff, urgent: diff <= 2,
                            label: `יום הולדת של ${child.name} (${apt.name || bldg})`, bldg, idx });
                    // Bar/Bat mitzvah coming in ≤ 60 days
                    const bmDate = _dateAtAge(child.dob, 13);
                    const bmDiff = Math.round((bmDate - today) / 86400000);
                    if (bmDiff >= 0 && bmDiff <= 60)
                        alerts.push({ type: 'bar_mitzvah', diff: bmDiff, urgent: bmDiff <= 7,
                            label: `בר מצווה של ${child.name} (${apt.name || bldg}) — בעוד ${bmDiff} ימים`, bldg, idx });
                }
            });

            // Father/mother birthdays
            [['father', 'fatherDob'], ['mother', 'motherDob']].forEach(([role, dobKey]) => {
                const dob  = apt[dobKey];
                const name = apt[role];
                if (!dob || !name) return;
                const diff = _daysUntilNextAnniversary(dob, today);
                if (diff >= 0 && diff <= 7)
                    alerts.push({ type: 'birthday', diff, urgent: diff <= 2,
                        label: `יום הולדת של ${name} (${apt.name || bldg})`, bldg, idx });
            });

            // Lifecycle recurring anniversaries (yahrtzeit, wedding anniversary…)
            (apt.lifecycleEvents || []).forEach(ev => {
                if (!ev.date) return;
                const diff = _daysUntilNextAnniversary(ev.date, today);
                if (diff >= 0 && diff <= 14) {
                    const def = _evDef(ev.type);
                    alerts.push({ type: ev.type, diff, urgent: diff <= 3,
                        label: `${def.label} — ${ev.memberName || apt.name || bldg} (בעוד ${diff} ימים)`,
                        bldg, idx });
                }
            });
        });
    });

    return alerts.sort((a, b) => a.diff - b.diff);
};

// ── Render alerts panel in sidebar ───────────────────────────
window.renderLifecycleAlerts = function () {
    const panel = document.getElementById('lifecycleAlertsPanel');
    if (!panel) return;
    const alerts = checkLifecycleAlerts();
    if (!alerts.length) { panel.style.display = 'none'; return; }

    panel.style.display = 'block';
    const badge = document.getElementById('lifecycleAlertsBadge');
    if (badge) badge.textContent = alerts.length;

    document.getElementById('lifecycleAlertsList').innerHTML = alerts.slice(0, 8).map(a => {
        const def = _evDef(a.type);
        return `<div class="lc-alert-item${a.urgent ? ' lc-alert-urgent' : ''}"
                     onclick="currentBldg='${escapeHTML(a.bldg)}';openClientCard(${a.idx});"
                     style="cursor:pointer;">
            <i class="fas ${def.icon}" style="color:${def.color};flex-shrink:0;"></i>
            <span style="flex:1;font-size:12px;">${a.label}</span>
            <span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">${a.diff === 0 ? 'היום' : `בעוד ${a.diff}י'`}</span>
        </div>`;
    }).join('');
};

// ── Internals ─────────────────────────────────────────────────
function _populateLcTypes() {
    const sel = document.getElementById('lcType');
    if (!sel) return;
    sel.innerHTML = EV_TYPES.map(t => `<option value="${t.key}">${t.label}</option>`).join('');
}

function _populateLcMember() {
    const sel = document.getElementById('lcMember');
    if (!sel || typeof _getMemberOptions !== 'function') return;
    sel.innerHTML = _getMemberOptions('family');
}

function _generateTasks(ev, memberName) {
    const triggers = TRIGGERS[ev.type] || [];
    const base     = new Date(ev.date);
    const today    = new Date(); today.setHours(0, 0, 0, 0);
    return triggers.map(tr => {
        const d = new Date(base);
        d.setDate(d.getDate() + tr.offset);
        return {
            text:          memberName ? `${tr.text} — ${memberName}` : tr.text,
            date:          d.toISOString().split('T')[0],
            done:          d < today,
            member:        ev.memberKey || 'family',
            autoGenerated: true,
            source:        ev.type,
        };
    });
}

function _resolveName(k) {
    if (!k || k === 'family') return '';
    if (k === 'father') return document.getElementById('cFather')?.value?.trim() || 'אבא';
    if (k === 'mother') return document.getElementById('cMother')?.value?.trim() || 'אמא';
    if (k.startsWith('child:')) return k.slice(6);
    return k;
}

function _evDef(type) {
    return EV_TYPES.find(t => t.key === type)
        || { label: type || 'אחר', icon: 'fa-star', color: '#8b5cf6' };
}

function _daysUntilNextAnniversary(dateStr, today) {
    const d    = new Date(dateStr);
    const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    if (next < today) next.setFullYear(today.getFullYear() + 1);
    return Math.round((next - today) / 86400000);
}

function _dateAtAge(dob, age) {
    const d = new Date(dob);
    return new Date(d.getFullYear() + age, d.getMonth(), d.getDate());
}

})();
