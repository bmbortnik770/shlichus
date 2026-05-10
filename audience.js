// ══════════════════════════════════════════════════════════════
// audience.js — Shared Audience Builder for comm module
// ══════════════════════════════════════════════════════════════

window.sharedAudience = [];   // { name, phone, email, key: "bldg|idx" }
let _audCandidates   = [];    // currently visible families in the builder list
let _audExpanded     = false;
let _audSegment      = 'all';
let _audStyleFilter  = '';

// ── Toggle open/close ─────────────────────────────────────
window.toggleAudienceBuilder = function () {
    _audExpanded = !_audExpanded;
    const body = document.getElementById('audBody');
    const chev = document.getElementById('audChevron');
    if (!body) return;
    body.style.display = _audExpanded ? 'block' : 'none';
    if (chev) chev.style.transform = _audExpanded ? 'rotate(180deg)' : '';
    if (_audExpanded) { _buildStylePills(); _renderList(''); }
};

// ── Smart Segments ─────────────────────────────────────────
window.applyAudSegment = function (seg, btn) {
    _audSegment = seg;
    document.querySelectorAll('.aud-seg-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _audStyleFilter = '';
    document.querySelectorAll('.aud-style-pill').forEach(b => b.classList.remove('active'));
    _renderList(document.getElementById('audSearch')?.value || '');
};

function _getFamilies () {
    let list = [];
    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach((apt, idx) => list.push({ bldg, idx, apt }));
    });

    switch (_audSegment) {
        case 'no_contact_60':
            return list.filter(f => {
                const logs = f.apt.interactions || [];
                if (!logs.length) return true;
                const last = Math.max(...logs.map(l => new Date(l.date).getTime() || 0));
                return (Date.now() - last) > 60 * 24 * 60 * 60 * 1000;
            });
        case 'no_contact_30':
            return list.filter(f => {
                const logs = f.apt.interactions || [];
                if (!logs.length) return true;
                const last = Math.max(...logs.map(l => new Date(l.date).getTime() || 0));
                return (Date.now() - last) > 30 * 24 * 60 * 60 * 1000;
            });
        case 'has_tasks':
            return list.filter(f => (f.apt.tasks || []).some(t => !t.done));
        case 'no_phone':
            return list.filter(f => getAllPhones(f.apt).length === 0);
        case 'no_email':
            return list.filter(f => getAllEmails(f.apt).length === 0);
        case 'red':
            return list.filter(f => getStatusColor(f.apt) === '#ef4444');
        case 'orange':
            return list.filter(f => getStatusColor(f.apt) === '#f59e0b');
        default:
            return list;
    }
}

// ── Render family list ─────────────────────────────────────
function _renderList (q) {
    const container = document.getElementById('audFamilyList');
    if (!container) return;

    let families = _getFamilies();

    // Style filter
    if (_audStyleFilter)
        families = families.filter(f => f.apt.style === _audStyleFilter);

    // Text search
    if (q) {
        const ql = q.toLowerCase();
        families = families.filter(f =>
            `${f.apt.name || ''} ${f.bldg}`.toLowerCase().includes(ql)
        );
    }

    _audCandidates = families;
    const cnt = document.getElementById('audListCount');
    if (cnt) cnt.textContent = `${families.length} משפחות`;

    const applyBtn = document.getElementById('audApplyCount');
    if (applyBtn) applyBtn.textContent = sharedAudience.length;

    if (!families.length) {
        container.innerHTML = `<div style="text-align:center;padding:20px 0;color:var(--text-muted);font-size:13px;">
            <i class="fas fa-filter" style="opacity:.3;font-size:20px;margin-bottom:6px;display:block;"></i>
            אין משפחות תואמות לסינון זה
        </div>`;
        return;
    }

    container.innerHTML = families.map(f => {
        const key     = `${f.bldg}|${f.idx}`;
        const phones  = getAllPhones(f.apt);
        const emails  = getAllEmails(f.apt);
        const sel     = sharedAudience.some(s => s.key === key);
        const col     = getStatusColor(f.apt);
        return `<label class="aud-family-row${sel ? ' selected' : ''}">
            <input type="checkbox" class="aud-cb" value="${key}" ${sel ? 'checked' : ''} onchange="toggleAudItem(this)">
            <span class="aud-dot" style="background:${col};"></span>
            <span class="aud-name">${escapeHTML(f.apt.name || 'ללא שם')}</span>
            <span class="aud-phone">${phones[0] || ''}</span>
            <span class="aud-icons">
                ${phones.length ? `<span class="aud-chip has">📞</span>` : `<span class="aud-chip no" title="ללא טלפון">—</span>`}
                ${emails.length ? `<span class="aud-chip has">📧</span>` : ''}
            </span>
        </label>`;
    }).join('');
}

// ── Toggle single item ─────────────────────────────────────
window.toggleAudItem = function (cb) {
    const [bldg, idxStr] = cb.value.split('|');
    const idx = parseInt(idxStr);
    const apt = db[bldg]?.apts?.[idx];
    if (!apt) return;

    if (cb.checked) {
        if (!sharedAudience.some(s => s.key === cb.value)) {
            sharedAudience.push({
                name:  apt.name || 'ללא שם',
                phone: getAllPhones(apt)[0] || '',
                email: getAllEmails(apt)[0] || '',
                key:   cb.value
            });
        }
    } else {
        sharedAudience = sharedAudience.filter(s => s.key !== cb.value);
    }
    cb.closest('.aud-family-row').classList.toggle('selected', cb.checked);
    _refreshCounts();
};

// ── Select all visible ─────────────────────────────────────
window.toggleAudSelectAll = function (checked) {
    _audCandidates.forEach(f => {
        const key = `${f.bldg}|${f.idx}`;
        if (checked) {
            if (!sharedAudience.some(s => s.key === key))
                sharedAudience.push({
                    name:  f.apt.name || 'ללא שם',
                    phone: getAllPhones(f.apt)[0] || '',
                    email: getAllEmails(f.apt)[0] || '',
                    key
                });
        } else {
            sharedAudience = sharedAudience.filter(s => s.key !== key);
        }
    });
    _renderList(document.getElementById('audSearch')?.value || '');
};

window.filterAudList = function (q) { _renderList(q); };

// ── Style pills ────────────────────────────────────────────
function _buildStylePills () {
    const c = document.getElementById('audStylePills');
    if (!c) return;
    const styles = (appSettings.styles || []).filter(Boolean);
    if (!styles.length) return;
    c.innerHTML = styles.map(s => `
        <button class="aud-style-pill${_audStyleFilter === s ? ' active' : ''}"
                data-s="${escapeHTML(s)}" onclick="toggleAudStylePill(this,'${escapeHTML(s)}')">
            ${escapeHTML(s)}
        </button>`).join('');
}

window.toggleAudStylePill = function (btn, s) {
    const same = _audStyleFilter === s;
    document.querySelectorAll('.aud-style-pill').forEach(b => b.classList.remove('active'));
    _audStyleFilter = same ? '' : s;
    if (!same) btn.classList.add('active');
    _renderList(document.getElementById('audSearch')?.value || '');
};

// ── Apply to all channels ──────────────────────────────────
window.applyAudienceToChannels = function () {
    if (!sharedAudience.length) return showToast('בחר משפחות קודם', 'warning');

    // WhatsApp + Email (commRecipients)
    window.commRecipients = sharedAudience.map(r => ({ ...r }));
    if (typeof renderRecipientsList === 'function') {
        renderRecipientsList('whatsapp');
        renderRecipientsList('email');
    }
    const waCnt = document.getElementById('waRecipientCount');
    const emCnt = document.getElementById('emRecipientCount');
    if (waCnt) waCnt.innerText = commRecipients.filter(r => r.phone).length;
    if (emCnt) emCnt.innerText = commRecipients.filter(r => r.email).length;

    // SMS (_smsR via renderSMSRecipients)
    if (typeof renderSMSRecipients === 'function') {
        window.bulkSelection = sharedAudience.map(r => r.key);
        renderSMSRecipients();
        window.bulkSelection = [];
    }

    _refreshHeaderChips();
    updateCommStats && updateCommStats();
    if (_audExpanded) toggleAudienceBuilder();
    showToast(`${sharedAudience.length} משפחות נטענו לכל הערוצים ✅`, 'success');
};

// ── Clear ──────────────────────────────────────────────────
window.clearAudience = function () {
    sharedAudience = [];
    window.commRecipients = [];
    if (typeof renderRecipientsList === 'function') {
        renderRecipientsList('whatsapp');
        renderRecipientsList('email');
    }
    ['waRecipientCount', 'emRecipientCount'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = '0';
    });
    window._smsR = [];
    if (typeof renderSMSRecipients === 'function') renderSMSRecipients();
    _refreshCounts();
    _refreshHeaderChips();
    if (_audExpanded) _renderList('');
    showToast('הקהל נוקה', 'info');
};

function _refreshCounts () {
    const n = sharedAudience.length;
    const hdr = document.getElementById('audHeaderCount');
    if (hdr) hdr.textContent = n ? `${n} נבחרו` : 'לא נבחרו';
    const btn = document.getElementById('audApplyCount');
    if (btn) btn.textContent = n;
}

function _refreshHeaderChips () {
    const chips = document.getElementById('audHeaderChips');
    if (!chips) return;
    const n = sharedAudience.length;
    if (n === 0) { chips.innerHTML = ''; return; }
    if (n <= 3) {
        chips.innerHTML = sharedAudience.map(r =>
            `<span class="aud-chip-badge">${escapeHTML(r.name)}</span>`
        ).join('');
    } else {
        chips.innerHTML = `<span class="aud-chip-badge">${n} משפחות</span>`;
    }
}

// Open the builder directly from channel "choose from list" buttons
window.openAudienceBuilder = function () {
    if (!_audExpanded) toggleAudienceBuilder();
    document.getElementById('audienceBuilder')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
