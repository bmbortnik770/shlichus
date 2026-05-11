// ══════════════════════════════════════════════════════════════
// scoring.js — Interaction Types, Engagement Score Engine
// ══════════════════════════════════════════════════════════════
(function () {

const DEFAULT_INTERACTION_TYPES = [
    { key: 'tefillin',         label: 'הנחת תפילין',    icon: 'fa-scroll-torah',    color: '#1d4ed8', direction: 'outgoing',  defaultScore: 15 },
    { key: 'mezuzah',          label: 'בדיקת מזוזות',   icon: 'fa-door-open',       color: '#059669', direction: 'outgoing',  defaultScore: 20 },
    { key: 'visit',            label: 'ביקור בית',       icon: 'fa-home',            color: '#7c3aed', direction: 'outgoing',  defaultScore: 10 },
    { key: 'call',             label: 'שיחת טלפון',     icon: 'fa-phone',           color: '#0891b2', direction: 'outgoing',  defaultScore:  8 },
    { key: 'message',          label: 'הודעה / מייל',   icon: 'fa-envelope',        color: '#6b7280', direction: 'outgoing',  defaultScore:  5 },
    { key: 'mourning',         label: 'ניחום אבלים',     icon: 'fa-heart-broken',    color: '#374151', direction: 'outgoing',  defaultScore: 25 },
    { key: 'hospital',         label: 'ביקור חולים',     icon: 'fa-hospital',        color: '#dc2626', direction: 'outgoing',  defaultScore: 20 },
    { key: 'shiur',            label: 'שיעור',           icon: 'fa-book-open',       color: '#d97706', direction: 'incoming',  defaultScore: 12 },
    { key: 'event',            label: 'אירוע / חג',      icon: 'fa-calendar-star',   color: '#db2777', direction: 'incoming',  defaultScore:  8 },
    { key: 'prayer',           label: 'תפילה / מניין',  icon: 'fa-synagogue',       color: '#6d28d9', direction: 'incoming',  defaultScore: 10 },
    { key: 'donation',         label: 'תרומה',           icon: 'fa-shekel-sign',     color: '#16a34a', direction: 'incoming',  defaultScore:  6 },
    { key: 'good_resolution',  label: 'החלטה טובה',     icon: 'fa-star',            color: '#f59e0b', direction: 'milestone', defaultScore: 20 },
    { key: 'other',            label: 'אחר',             icon: 'fa-circle',          color: '#94a3b8', direction: 'milestone', defaultScore:  5 },
];

const DEFAULT_DECAY_DAYS = 90;

// ── Init (safe to call multiple times) ───────────────────────
window._initInteractionTypes = function () {
    if (!appSettings.interactionTypes || !appSettings.interactionTypes.length)
        appSettings.interactionTypes = JSON.parse(JSON.stringify(DEFAULT_INTERACTION_TYPES));
    if (!appSettings.scoreWeights) {
        const w = {};
        appSettings.interactionTypes.forEach(t => { w[t.key] = t.defaultScore; });
        appSettings.scoreWeights = w;
    }
    if (!appSettings.scoreDecayDays) appSettings.scoreDecayDays = DEFAULT_DECAY_DAYS;
};

// ── Lookup ────────────────────────────────────────────────────
window.getITypeInfo = function (keyOrLabel) {
    _initInteractionTypes();
    return appSettings.interactionTypes.find(t => t.key === keyOrLabel || t.label === keyOrLabel)
        || { key: 'other', label: keyOrLabel || 'אחר', icon: 'fa-circle', color: '#94a3b8', direction: 'milestone', defaultScore: 5 };
};

// ── Score computation ─────────────────────────────────────────
window.computeEngagementScore = function (apt) {
    if (!apt) return 0;
    _initInteractionTypes();
    const w = appSettings.scoreWeights;
    const decay = appSettings.scoreDecayDays;
    const now = Date.now();
    let score = 0;
    (apt.interactions || []).forEach(i => {
        const key = i.interactionType || _guessKey(i.type);
        const pts = (w[key] !== undefined) ? w[key] : (w.other || 5);
        const days = (now - new Date(i.date).getTime()) / 86400000;
        score += pts * Math.pow(0.5, days / decay);
    });
    return Math.min(100, Math.round(score));
};

window.getEngagementLabel = function (score) {
    if (score >= 70) return { label: 'מעורב מאוד',  color: '#10b981', bg: '#d1fae5', icon: 'fa-fire' };
    if (score >= 40) return { label: 'מתחמם',        color: '#f59e0b', bg: '#fef3c7', icon: 'fa-thermometer-half' };
    if (score >= 15) return { label: 'מתרחק',        color: '#ef4444', bg: '#fee2e2', icon: 'fa-thermometer-quarter' };
    return             { label: 'קר',              color: '#94a3b8', bg: '#f1f5f9', icon: 'fa-snowflake' };
};

window.getLastContactDays = function (apt) {
    if (!apt?.interactions?.length) return null;
    const latest = apt.interactions.reduce((max, i) => Math.max(max, new Date(i.date).getTime()), 0);
    return latest ? Math.floor((Date.now() - latest) / 86400000) : null;
};

window.renderScoreBadge = function (score) {
    const info = getEngagementLabel(score);
    return `<span class="engagement-badge" style="background:${info.bg};color:${info.color};">
        <i class="fas ${info.icon}"></i> ${score} — ${info.label}</span>`;
};

window.renderLastContactBadge = function (days) {
    if (days === null) return `<span class="last-contact-badge lc-none"><i class="fas fa-clock"></i> אין תיעוד</span>`;
    let col = '#10b981', bg = '#d1fae5';
    if (days > 90) { col = '#ef4444'; bg = '#fee2e2'; }
    else if (days > 30) { col = '#f59e0b'; bg = '#fef3c7'; }
    const lbl = days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`;
    return `<span class="last-contact-badge" style="background:${bg};color:${col};"><i class="fas fa-history"></i> ${lbl}</span>`;
};

// ── Update header badges inside open client card ──────────────
window.updateEngagementDisplay = function (bldg, idx) {
    const apt     = db?.[bldg]?.apts?.[idx];
    const row     = document.getElementById('familyStatsBadgesRow');
    const scoreEl = document.getElementById('familyScoreBadge');
    const lcEl    = document.getElementById('familyLastContact');
    if (!apt) {
        if (row)     row.style.display = 'none';
        if (scoreEl) scoreEl.innerHTML = '';
        if (lcEl)    lcEl.innerHTML    = '';
        return;
    }
    const score = computeEngagementScore(apt);
    const days  = getLastContactDays(apt);
    if (scoreEl) scoreEl.innerHTML = renderScoreBadge(score);
    if (lcEl)    lcEl.innerHTML    = renderLastContactBadge(days);
    if (row)     row.style.display = 'flex';
};

// ── Populate interaction type <select> ────────────────────────
window._populateLogTypeSelect = function () {
    _initInteractionTypes();
    const sel = document.getElementById('newLogType');
    if (!sel) return;
    const cur = sel.value;
    const groups = { outgoing: [], incoming: [], milestone: [] };
    appSettings.interactionTypes.forEach(t => (groups[t.direction] || groups.milestone).push(t));
    const gLabels = { outgoing: 'אני אצלו', incoming: 'הוא אצלי', milestone: 'כללי' };
    sel.innerHTML = Object.entries(groups).map(([dir, types]) =>
        types.length ? `<optgroup label="${gLabels[dir]}">${types.map(t =>
            `<option value="${t.key}" ${t.key === cur ? 'selected' : ''}>${t.label}</option>`
        ).join('')}</optgroup>` : ''
    ).join('');
    _updateDirectionBadge(sel.value);
};

window._updateDirectionBadge = function (typeKey) {
    const info  = getITypeInfo(typeKey);
    const badge = document.getElementById('logDirectionBadge');
    if (!badge) return;
    const labels = { outgoing: 'אני אצלו', incoming: 'הוא אצלי', milestone: 'כללי' };
    const colors = { outgoing: '#7c3aed',   incoming: '#0891b2',   milestone: '#f59e0b' };
    const col = colors[info.direction] || '#94a3b8';
    badge.innerHTML =
        `<i class="fas ${info.icon}" style="color:${info.color};"></i> ` +
        `<span style="background:${col}22;color:${col};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${labels[info.direction] || 'כללי'}</span>`;
};

// ── At-risk families ──────────────────────────────────────────
window.getAtRiskFamilies = function (days = 30) {
    if (typeof db === 'undefined') return [];
    const out = [];
    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach((apt, idx) => {
            const d = getLastContactDays(apt);
            if (d === null || d >= days)
                out.push({ bldg, idx, apt, days: d, score: computeEngagementScore(apt) });
        });
    });
    return out.sort((a, b) => (b.days || 9999) - (a.days || 9999));
};

// ── Score Settings UI ─────────────────────────────────────────
window.renderScoreSettings = function () {
    _initInteractionTypes();
    const c = document.getElementById('scoreSettingsContainer');
    if (!c) return;
    const w = appSettings.scoreWeights;
    c.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px;background:var(--bg-body);border-radius:8px;border:1px solid var(--border-light);">
            <i class="fas fa-clock" style="color:var(--accent);"></i>
            <span style="font-size:12px;">הניקוד מתחלק ב-2 כל</span>
            <input type="number" id="scoreDecayInput" value="${appSettings.scoreDecayDays}" min="7" max="365"
                class="inline-input" style="width:60px;text-align:center;font-size:13px;">
            <span style="font-size:12px;">ימים ללא פעילות</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">שינוי ניקוד וכיוון לכל סוג פעילות:</div>
        <div id="scoreTypesList">${appSettings.interactionTypes.map(_typeRow).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:10px;">
            <button onclick="addScoreType()" class="btn btn-outline" style="flex:1;font-size:13px;"><i class="fas fa-plus"></i> הוסף סוג</button>
            <button onclick="saveScoreSettings()" class="btn btn-primary" style="flex:2;font-size:13px;"><i class="fas fa-save"></i> שמור ניקוד</button>
        </div>`;
};

function _typeRow(t, i) {
    const dirs = [['outgoing','אני אצלו'],['incoming','הוא אצלי'],['milestone','כללי']];
    return `<div class="score-type-row">
        <i class="fas ${t.icon}" style="color:${t.color};width:16px;text-align:center;flex-shrink:0;"></i>
        <span style="flex:1;font-size:12px;">${escapeHTML(t.label)}</span>
        <select class="inline-input" style="font-size:11px;padding:2px 4px;width:80px;" onchange="appSettings.interactionTypes[${i}].direction=this.value">
            ${dirs.map(([v,l]) => `<option value="${v}" ${t.direction===v?'selected':''}>${l}</option>`).join('')}
        </select>
        <input type="number" value="${appSettings.scoreWeights?.[t.key] ?? t.defaultScore}" min="0" max="100"
            class="inline-input" style="width:45px;text-align:center;font-size:12px;"
            onchange="if(!appSettings.scoreWeights)appSettings.scoreWeights={};appSettings.scoreWeights['${t.key}']=parseInt(this.value)||0">
        <span style="font-size:10px;color:var(--text-muted);">נק'</span>
        <button onclick="removeScoreType(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:0;font-size:12px;"><i class="fas fa-times"></i></button>
    </div>`;
}

window.saveScoreSettings = function () {
    const el = document.getElementById('scoreDecayInput');
    if (el) appSettings.scoreDecayDays = parseInt(el.value) || 90;
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    if (typeof saveDB === 'function') saveDB();
    if (typeof showToast === 'function') showToast('הגדרות ניקוד נשמרו ✅', 'success');
    _populateLogTypeSelect();
};

window.addScoreType = async function () {
    const label = await showCustomDialog({ title: 'סוג פעילות חדש', message: 'שם הסוג:', showInput: true });
    if (!label) return;
    const key = 'custom_' + Date.now();
    _initInteractionTypes();
    appSettings.interactionTypes.push({ key, label, icon: 'fa-circle', color: '#94a3b8', direction: 'milestone', defaultScore: 5 });
    if (!appSettings.scoreWeights) appSettings.scoreWeights = {};
    appSettings.scoreWeights[key] = 5;
    renderScoreSettings();
    _populateLogTypeSelect();
};

window.removeScoreType = function (i) {
    appSettings.interactionTypes.splice(i, 1);
    renderScoreSettings();
    _populateLogTypeSelect();
};

// ── Guess key from legacy free-text type labels ───────────────
function _guessKey(label) {
    if (!label) return 'other';
    const l = label.toLowerCase();
    if (l.includes('תפילין'))  return 'tefillin';
    if (l.includes('מזוזות'))  return 'mezuzah';
    if (l.includes('חולים'))   return 'hospital';
    if (l.includes('ביקור'))   return 'visit';
    if (l.includes('שיעור'))   return 'shiur';
    if (l.includes('תפילה') || l.includes('מניין')) return 'prayer';
    if (l.includes('תרומה'))   return 'donation';
    if (l.includes('אירוע') || l.includes('חג'))    return 'event';
    if (l.includes('שיחה') || l.includes('טלפון'))  return 'call';
    if (l.includes('ניחום') || l.includes('אבל'))   return 'mourning';
    if (l.includes('החלטה'))   return 'good_resolution';
    if (l.includes('הודעה') || l.includes('מייל'))  return 'message';
    return 'other';
}

})();
