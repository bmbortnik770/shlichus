// ══════════════════════════════════════════════════════════════
// circles-hub.js — Connection Circles Hub
// ══════════════════════════════════════════════════════════════
(function () {

let _selectedCircle = null;

// ── Normalize circle entry (supports old string format) ───────
function _circleId(e)  { return typeof e === 'string' ? e         : (e.id     || ''); }
function _circleMem(e) { return typeof e === 'string' ? 'family'  : (e.member || 'family'); }

// ── Build map: circleId → [{bldg, idx, apt, member}] ─────────
function _buildMemberMap() {
    const map = {};
    if (typeof db === 'undefined') return map;
    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach((apt, idx) => {
            (apt.connectionCircles || []).forEach(entry => {
                const id  = _circleId(entry);
                const mem = _circleMem(entry);
                if (!map[id]) map[id] = [];
                map[id].push({ bldg, idx, apt, member: mem });
            });
        });
    });
    return map;
}

// ── Main hub view ─────────────────────────────────────────────
window.renderCirclesHub = function () {
    const container = document.getElementById('circles-container');
    if (!container) return;
    const safe = s => (typeof escapeHTML === 'function' ? escapeHTML(s || '') : (s || ''));
    const circles = appSettings?.connectionCircles || [];

    if (_selectedCircle) {
        const map = _buildMemberMap();
        _renderDetail(container, _selectedCircle, map, safe);
        return;
    }

    if (!circles.length) {
        container.innerHTML = `
            <div style="padding:40px;text-align:center;color:var(--text-muted);">
                <i class="fas fa-circle-notch" style="font-size:44px;opacity:.15;display:block;margin-bottom:14px;"></i>
                <div style="font-size:16px;font-weight:700;margin-bottom:6px;">אין מעגלי קשר עדיין</div>
                <div style="font-size:13px;margin-bottom:18px;">צור את המעגל הראשון שלך</div>
                <button class="btn btn-outline" onclick="_circlesAddNew()"><i class="fas fa-plus"></i> מעגל חדש</button>
            </div>`;
        return;
    }

    const map = _buildMemberMap();
    const sorted = [...circles].sort((a, b) =>
        (map[b.id] || []).length - (map[a.id] || []).length
    );

    let html = `
        <div style="padding:18px 20px 4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <h2 style="margin:0;font-size:17px;color:var(--primary);display:flex;align-items:center;gap:8px;">
                <i class="fas fa-circle-notch" style="color:var(--accent);"></i> מעגלי קשר
            </h2>
            <button class="btn btn-outline" style="font-size:12px;padding:5px 12px;margin-right:auto;" onclick="_circlesAddNew()">
                <i class="fas fa-plus"></i> מעגל חדש
            </button>
        </div>
        <div class="circles-bubble-grid">`;

    sorted.forEach(circle => {
        const members  = map[circle.id] || [];
        const count    = members.length;
        const sizeClass = count > 20 ? 'circle-card-lg' : count > 7 ? 'circle-card-md' : '';
        const previews = members.slice(0, 5);

        html += `
            <div class="circle-bubble-card ${sizeClass}" onclick="_circlesShowDetail('${safe(circle.id)}')">
                <div class="circle-bubble-emoji">${circle.emoji || '🔵'}</div>
                <div class="circle-bubble-name">${safe(circle.label)}</div>
                <div class="circle-bubble-count">${count} חברים</div>
                <div class="circle-bubble-avatars">
                    ${previews.map(m => `<div class="circle-mini-av">${safe((m.apt.name||'?')[0])}</div>`).join('')}
                    ${count > 5 ? `<div class="circle-mini-av circle-mini-more">+${count-5}</div>` : ''}
                </div>
            </div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
};

// ── Detail view ───────────────────────────────────────────────
function _renderDetail(container, circleId, map, safe) {
    const circle  = (appSettings?.connectionCircles || []).find(c => c.id === circleId);
    if (!circle) { _selectedCircle = null; renderCirclesHub(); return; }

    const members = map[circleId] || [];
    const inSet   = new Set(members.map(m => `${m.bldg}::${m.idx}::${m.member}`));

    // Families not yet in this circle (for add dropdown)
    const allFamilies = [];
    if (typeof db !== 'undefined') {
        Object.keys(db).forEach(bldg => {
            if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            (db[bldg]?.apts || []).forEach((apt, idx) => allFamilies.push({ bldg, idx, apt }));
        });
    }
    const notInCircle = allFamilies.filter(f =>
        !['family','father','mother'].some(mem => inSet.has(`${f.bldg}::${f.idx}::${mem}`))
    );

    let html = `
        <div style="padding:16px 20px 4px;display:flex;align-items:center;gap:10px;">
            <button onclick="_circlesBack()" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:18px;padding:2px 6px;">
                <i class="fas fa-arrow-right"></i>
            </button>
            <span style="font-size:24px;">${circle.emoji || '🔵'}</span>
            <h2 style="margin:0;font-size:17px;color:var(--primary);">${safe(circle.label)}</h2>
            <span class="circles-count-badge" style="margin-right:auto;">${members.length} חברים</span>
            <button onclick="_circlesEditCircle('${safe(circleId)}')" title="שנה שם" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;"><i class="fas fa-pen"></i></button>
            <button onclick="_circlesDeleteCircle('${safe(circleId)}')" title="מחק מעגל" style="background:none;border:none;cursor:pointer;color:var(--danger);padding:4px;"><i class="fas fa-trash"></i></button>
        </div>

        <!-- Add member -->
        <div style="margin:10px 20px;background:var(--surface);border:1px solid var(--border-light);border-radius:10px;padding:12px;">
            <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;"><i class="fas fa-user-plus"></i> הוסף למעגל</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <select id="circleAddFamily" class="inline-input" style="flex:2;min-width:160px;font-size:12px;">
                    <option value="">-- בחר משפחה --</option>
                    ${notInCircle.map(f => `<option value="${safe(f.bldg)}::${f.idx}">${safe(f.apt.name||'(ללא שם)')} — ${safe(f.bldg==='__NO_ADDRESS__'?'ללא כתובת':f.bldg)}</option>`).join('')}
                </select>
                <select id="circleAddMember" class="inline-input" style="flex:1;font-size:12px;">
                    <option value="family">כל המשפחה</option>
                    <option value="father">אב</option>
                    <option value="mother">אם</option>
                </select>
                <button class="btn btn-outline" style="padding:6px 14px;font-size:12px;" onclick="_circlesAddMember('${safe(circleId)}')">
                    <i class="fas fa-plus"></i> הוסף
                </button>
            </div>
        </div>

        <!-- Members list -->
        <div style="padding:0 20px 80px;display:flex;flex-direction:column;gap:6px;overflow-y:auto;flex:1;">`;

    if (!members.length) {
        html += `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">
            <i class="fas fa-users" style="font-size:32px;opacity:.15;display:block;margin-bottom:10px;"></i>
            אין חברים במעגל זה עדיין
        </div>`;
    } else {
        members.forEach(m => {
            const mLabel = m.member === 'family' ? 'כל המשפחה'
                : m.member === 'father' ? (m.apt.father || 'אב')
                : m.member === 'mother' ? (m.apt.mother || 'אם')
                : m.member.startsWith('child:') ? m.member.slice(6) : m.member;
            const mColor = m.member === 'father' ? '#3b82f6'
                : m.member === 'mother' ? '#ec4899' : '#8b5cf6';

            html += `
                <div class="circle-member-row" onclick="currentBldg='${safe(m.bldg)}';openClientCard(${m.idx});switchCrmTab('activity');">
                    <div class="circle-member-av" style="background:${mColor};">${safe((m.apt.name||'?')[0])}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:600;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safe(m.apt.name||'(ללא שם)')}</div>
                        <div style="font-size:11px;color:var(--text-muted);">${safe(m.bldg==='__NO_ADDRESS__'?'ללא כתובת':m.bldg)}</div>
                    </div>
                    <span style="font-size:11px;background:${mColor}18;color:${mColor};padding:2px 8px;border-radius:10px;flex-shrink:0;">${safe(mLabel)}</span>
                    <button onclick="event.stopPropagation();_circlesRemoveMember('${safe(circleId)}','${safe(m.bldg)}',${m.idx},'${safe(m.member)}')"
                            style="background:none;border:none;cursor:pointer;color:var(--danger);padding:4px;flex-shrink:0;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`;
        });
    }

    html += `</div>`;
    container.innerHTML = html;
}

// ── Public actions ────────────────────────────────────────────
window._circlesShowDetail = function (id) { _selectedCircle = id; renderCirclesHub(); };
window._circlesBack       = function ()   { _selectedCircle = null; renderCirclesHub(); };

window._circlesAddNew = async function () {
    if (!appSettings.connectionCircles) appSettings.connectionCircles = [];
    const label = await showCustomDialog({ title: 'מעגל קשר חדש', message: 'שם המעגל:', showInput: true, showCancel: true });
    if (!label) return;
    const emoji = await showCustomDialog({ title: 'אמוג\'י', message: 'בחר אמוג\'י (או השאר ריק):', showInput: true, defaultValue: '🔵', showCancel: true });
    appSettings.connectionCircles.push({ id: 'circle_' + Date.now(), label, emoji: emoji || '🔵' });
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    renderCirclesHub();
};

window._circlesEditCircle = async function (id) {
    const c = (appSettings?.connectionCircles || []).find(x => x.id === id);
    if (!c) return;
    const label = await showCustomDialog({ title: 'שינוי שם', message: 'שם חדש:', showInput: true, defaultValue: c.label, showCancel: true });
    if (!label) return;
    c.label = label;
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    renderCirclesHub();
};

window._circlesDeleteCircle = async function (id) {
    const c = (appSettings?.connectionCircles || []).find(x => x.id === id);
    if (!c) return;
    const ok = await showCustomDialog({ title: 'מחיקת מעגל', message: `למחוק את "${c.label}"?\nמשפחות לא יוסרו מהנתונים.`, showCancel: true });
    if (!ok) return;
    appSettings.connectionCircles = appSettings.connectionCircles.filter(x => x.id !== id);
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    _selectedCircle = null;
    renderCirclesHub();
};

window._circlesAddMember = function (circleId) {
    const sel    = document.getElementById('circleAddFamily');
    const memSel = document.getElementById('circleAddMember');
    if (!sel?.value) { showToast('יש לבחור משפחה', 'warning'); return; }
    const [bldg, idxStr] = sel.value.split('::');
    const idx    = parseInt(idxStr);
    const member = memSel?.value || 'family';
    const apt    = db?.[bldg]?.apts?.[idx];
    if (!apt) return;
    if (!apt.connectionCircles) apt.connectionCircles = [];
    const exists = apt.connectionCircles.some(e => _circleId(e) === circleId && _circleMem(e) === member);
    if (!exists) {
        apt.connectionCircles.push({ id: circleId, member });
        if (typeof saveDB === 'function') saveDB();
    }
    renderCirclesHub();
};

window._circlesRemoveMember = function (circleId, bldg, idx, member) {
    const apt = db?.[bldg]?.apts?.[idx];
    if (!apt?.connectionCircles) return;
    apt.connectionCircles = apt.connectionCircles.filter(e =>
        !(_circleId(e) === circleId && _circleMem(e) === member)
    );
    if (typeof saveDB === 'function') saveDB();
    renderCirclesHub();
};

})();
