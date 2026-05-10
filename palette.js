// ══════════════════════════════════════════════════════════════
// palette.js — Command Palette (Ctrl+K / Cmd+K)
// ══════════════════════════════════════════════════════════════
(function () {

const CMDS = [
    { label: 'מפה',              sub: 'נווט לתצוגת מפה',         icon: 'fa-map-marker-alt',   color: '#3b82f6', key: 'map' },
    { label: 'רשימת משפחות',    sub: 'תצוגת טבלה מלאה',         icon: 'fa-list',             color: '#3b82f6', key: 'table' },
    { label: 'פרויקטים',        sub: 'לוח קנבן',                 icon: 'fa-project-diagram',  color: '#8b5cf6', key: 'kanban' },
    { label: 'מרכז תקשורת',     sub: 'WhatsApp · מייל · SMS',   icon: 'fa-bullhorn',         color: '#10b981', key: 'comm' },
    { label: 'מרכז משימות',     sub: 'כל המשימות הפתוחות',      icon: 'fa-check-double',     color: '#f59e0b', key: 'tasks' },
    { label: 'אירועים',         sub: 'יומן ומועדים',             icon: 'fa-calendar-alt',     color: '#ef4444', key: 'events' },
    { label: 'סנכרן עם Drive',  sub: 'שמור את הנתונים לענן',   icon: 'fa-sync-alt',         color: '#10b981', key: 'sync' },
    { label: 'הגדרות',          sub: 'עדכן הגדרות מערכת',       icon: 'fa-cog',              color: '#64748b', key: 'settings' },
    { label: 'מצב כהה / בהיר', sub: 'החלף ערכת צבעים',         icon: 'fa-moon',             color: '#818cf8', key: 'dark' },
    { label: 'טבלה צפופה',      sub: 'הצג יותר שורות במסך',    icon: 'fa-grip-lines',       color: '#64748b', key: 'density_compact' },
    { label: 'טבלה מרווחת',     sub: 'תצוגה נוחה יותר לקריאה', icon: 'fa-expand-arrows-alt',color: '#64748b', key: 'density_spacious' },
    { label: 'טבלה רגילה',      sub: 'ברירת מחדל',              icon: 'fa-align-justify',    color: '#64748b', key: 'density_normal' },
];

let _active = -1;
let _familyData = [];

function _dispatch(key) {
    if (key.startsWith('density_')) {
        window.setDensity && setDensity(key.replace('density_', ''));
        return;
    }
    switch (key) {
        case 'map':      switchMainView('map');    break;
        case 'table':    switchMainView('table');  break;
        case 'kanban':   switchMainView('kanban'); break;
        case 'comm':     switchMainView('comm');   break;
        case 'tasks':    switchMainView('tasks');  break;
        case 'events':   switchMainView('events'); break;
        case 'sync':     window.manualSync && manualSync(); break;
        case 'settings': window.openSettings && openSettings(); break;
        case 'dark':     window.toggleDarkMode && toggleDarkMode(); break;
    }
}

function _render(q) {
    _active = -1;
    _familyData = [];
    const results = document.getElementById('cmdResults');
    if (!results) return;

    // Family search
    let families = [];
    if (q.length >= 2 && typeof db !== 'undefined') {
        const ql = q.toLowerCase();
        Object.keys(db).forEach(bldg => {
            if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            (db[bldg]?.apts || []).forEach((apt, idx) => {
                const phones = typeof getAllPhones === 'function' ? getAllPhones(apt) : [];
                const txt = `${apt.name||''} ${apt.father||''} ${apt.mother||''} ${phones.join(' ')} ${bldg}`.toLowerCase();
                if (txt.includes(ql)) families.push({ bldg, idx, apt, phones });
            });
        });
        families = families.slice(0, 6);
    }
    _familyData = families;

    const cmds = q.length > 0
        ? CMDS.filter(c => c.label.includes(q) || c.sub.includes(q))
        : CMDS;

    let html = '';

    if (families.length > 0) {
        html += `<div class="cmd-group-label">משפחות</div>`;
        html += families.map((f, i) => {
            const safe = s => typeof escapeHTML === 'function' ? escapeHTML(s||'') : (s||'');
            const addrLabel = typeof NO_ADDRESS_KEY !== 'undefined' && f.bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : safe(f.bldg);
            const phone = f.phones[0] ? ' · ' + f.phones[0] : '';
            return `<div class="cmd-item" data-type="family" data-fi="${i}">
                <div class="cmd-item-icon-wrap" style="background:rgba(59,130,246,.12);">
                    <i class="fas fa-users" style="color:#3b82f6; font-size:14px;"></i>
                </div>
                <div class="cmd-item-body">
                    <div class="cmd-item-label">${safe(f.apt.name||'ללא שם')}</div>
                    <div class="cmd-item-sub">${addrLabel}${phone}</div>
                </div>
                <div class="cmd-item-enter"><i class="fas fa-arrow-left" style="font-size:10px;"></i></div>
            </div>`;
        }).join('');
    }

    if (cmds.length > 0) {
        html += `<div class="cmd-group-label">${q ? 'פקודות' : 'פעולות מהירות'}</div>`;
        html += cmds.map(c => `
            <div class="cmd-item" data-type="cmd" data-key="${c.key}">
                <div class="cmd-item-icon-wrap" style="background:${c.color}1a;">
                    <i class="fas ${c.icon}" style="color:${c.color}; font-size:14px;"></i>
                </div>
                <div class="cmd-item-body">
                    <div class="cmd-item-label">${c.label}</div>
                    <div class="cmd-item-sub">${c.sub}</div>
                </div>
                <div class="cmd-item-enter"><i class="fas fa-arrow-left" style="font-size:10px;"></i></div>
            </div>`).join('');
    }

    if (!html) {
        html = `<div class="cmd-empty">
            <i class="fas fa-search" style="font-size:28px; opacity:.2; margin-bottom:10px;"></i>
            <div>לא נמצאו תוצאות עבור "${q}"</div>
        </div>`;
    }

    results.innerHTML = html;
    _bindItems();
    if (results.querySelector('.cmd-item')) _highlight(0);
}

function _bindItems() {
    document.querySelectorAll('#cmdResults .cmd-item').forEach((item, i) => {
        item.addEventListener('mouseenter', () => _highlight(i));
        item.addEventListener('click', () => {
            if (item.dataset.type === 'family') {
                const f = _familyData[parseInt(item.dataset.fi)];
                if (f) { currentBldg = f.bldg; openClientCard(f.idx); }
            } else {
                _dispatch(item.dataset.key);
            }
            close();
        });
    });
}

function _highlight(idx) {
    const items = document.querySelectorAll('#cmdResults .cmd-item');
    items.forEach(i => i.classList.remove('active'));
    _active = Math.max(0, Math.min(items.length - 1, idx));
    if (items[_active]) {
        items[_active].classList.add('active');
        items[_active].scrollIntoView({ block: 'nearest' });
    }
}

function _navigate(dir) {
    const items = document.querySelectorAll('#cmdResults .cmd-item');
    if (!items.length) return;
    _highlight((_active + dir + items.length) % items.length);
}

function open() {
    const el = document.getElementById('cmdPalette');
    if (!el) return;
    el.classList.add('open');
    const inp = document.getElementById('cmdInput');
    if (inp) { inp.value = ''; inp.focus(); }
    _render('');
}

function close() {
    document.getElementById('cmdPalette')?.classList.remove('open');
}

// ── Globals ──
window.openPalette  = open;
window.closePalette = close;

// ── Keyboard ──
document.addEventListener('keydown', e => {
    // Open/close with Ctrl+K / Cmd+K
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('cmdPalette')?.classList.contains('open') ? close() : open();
        return;
    }
    const pal = document.getElementById('cmdPalette');
    if (!pal?.classList.contains('open')) return;
    if (e.key === 'Escape')    { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); _navigate(1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _navigate(-1); return; }
    if (e.key === 'Enter') {
        e.preventDefault();
        document.querySelector('#cmdResults .cmd-item.active')?.click();
    }
});

// ── Input ──
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cmdInput')?.addEventListener('input', e => _render(e.target.value));
});

// ── Click outside ──
document.addEventListener('click', e => {
    if (e.target.id === 'cmdPalette') close();
});

})();
