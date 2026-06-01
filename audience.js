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
            list = list.filter(f => {
                const logs = f.apt.interactions || [];
                if (!logs.length) return true;
                const last = Math.max(...logs.map(l => new Date(l.date).getTime() || 0));
                return (Date.now() - last) > 60 * 24 * 60 * 60 * 1000;
            }); break;
        case 'no_contact_30':
            list = list.filter(f => {
                const logs = f.apt.interactions || [];
                if (!logs.length) return true;
                const last = Math.max(...logs.map(l => new Date(l.date).getTime() || 0));
                return (Date.now() - last) > 30 * 24 * 60 * 60 * 1000;
            }); break;
        case 'has_tasks':
            list = list.filter(f => (f.apt.tasks || []).some(t => !t.done)); break;
        case 'no_phone':
            list = list.filter(f => getAllPhones(f.apt).length === 0); break;
        case 'no_email':
            list = list.filter(f => getAllEmails(f.apt).length === 0); break;
        case 'red':
            list = list.filter(f => getStatusColor(f.apt) === '#ef4444'); break;
        case 'orange':
            list = list.filter(f => getStatusColor(f.apt) === '#f59e0b'); break;
    }

    if (_advFilters.length)
        list = list.filter(f => _advFilters.every(flt => _matchAdvFilter(f, flt)));

    return list;
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

// ══════════════════════════════════════════════════════════════
// Advanced Filter Builder
// ══════════════════════════════════════════════════════════════

let _advFilters = [];   // [{field, op, value}]
let _advOpen    = false;

const _FDEFS = [
    { k:'tags',        l:'תגיות',             ops:['כולל','לא כולל']                               },
    { k:'style',       l:'סגנון',             ops:['הוא','אינו']                                   },
    { k:'address',     l:'כתובת / רחוב',      ops:['מכיל','לא מכיל']                              },
    { k:'name',        l:'שם משפחה',          ops:['מכיל','לא מכיל']                              },
    { k:'last_contact',l:'קשר אחרון',         ops:['לפני יותר מ','בתוך האחרונים','אף פעם']         },
    { k:'contact_ch',  l:'ערוץ קשר אחרון',   ops:['הוא','אינו']                                   },
    { k:'has_phone',   l:'טלפון',             ops:['קיים','חסר']                                   },
    { k:'has_email',   l:'מייל',              ops:['קיים','חסר']                                   },
    { k:'status',      l:'צבע סטטוס',        ops:['הוא']                                          },
    { k:'open_tasks',  l:'משימות פתוחות',    ops:['יש','אין','יותר מ']                           },
    { k:'children',    l:'ילדים',             ops:['יש','אין','לפחות','בדיוק']                   },
    { k:'bar_mitzva',  l:'בר / בת מצווה',   ops:['בחודשים הקרובים']                             },
    { k:'donations',   l:'תרומות',            ops:['תרם','לא תרם']                                },
    { k:'boards',      l:'לוח קנבן',         ops:['חבר ב','לא חבר ב']                           },
    { k:'event_log',   l:'אירוע / תיעוד',    ops:['מוזכר','לא מוזכר']                            },
    { k:'custom_field',l:'שדה מותאם אישית',  ops:['מכיל','שווה ל','קיים','ריק']                 },
];

const _NO_VAL = new Set(['אף פעם','יש','אין','קיים','חסר','תרם','לא תרם']);

function _fdef(k) { return _FDEFS.find(d => d.k === k) || _FDEFS[0]; }

function _valHTML(k, op, i, saved) {
    if (_NO_VAL.has(op)) return '<span class="aud-flt-no-val">—</span>';
    const esc = s => escapeHTML(s || '');
    switch (k) {
        case 'tags': {
            const tags = appSettings.tags || [];
            return `<select class="aud-flt-sel" onchange="audFltChange(${i},'v',this.value)">
                <option value="">בחר תגית...</option>
                ${tags.map(t=>`<option value="${esc(t)}" ${saved===t?'selected':''}>${esc(t)}</option>`).join('')}
            </select>`;
        }
        case 'style': {
            const styles = appSettings.styles || [];
            return `<select class="aud-flt-sel" onchange="audFltChange(${i},'v',this.value)">
                <option value="">בחר סגנון...</option>
                ${styles.map(s=>`<option value="${esc(s)}" ${saved===s?'selected':''}>${esc(s)}</option>`).join('')}
            </select>`;
        }
        case 'status':
            return `<select class="aud-flt-sel" onchange="audFltChange(${i},'v',this.value)">
                <option value="#ef4444" ${saved==='#ef4444'?'selected':''}>🔴 אדום</option>
                <option value="#f59e0b" ${saved==='#f59e0b'?'selected':''}>🟠 כתום</option>
                <option value="#22c55e" ${saved==='#22c55e'?'selected':''}>🟢 ירוק</option>
                <option value="#94a3b8" ${saved==='#94a3b8'?'selected':''}>⚪ אפור</option>
            </select>`;
        case 'contact_ch':
            return `<select class="aud-flt-sel" onchange="audFltChange(${i},'v',this.value)">
                <option value="whatsapp">WhatsApp</option>
                <option value="email">מייל</option>
                <option value="sms">SMS</option>
                <option value="phone">שיחה</option>
                <option value="visit">ביקור</option>
            </select>`;
        case 'last_contact':
            return `<input class="inline-input aud-flt-inp" type="number" min="1" value="${saved||30}"
                oninput="audFltChange(${i},'v',this.value)"> <span class="aud-flt-unit">ימים</span>`;
        case 'bar_mitzva':
            return `<input class="inline-input aud-flt-inp" type="number" min="1" value="${saved||12}"
                oninput="audFltChange(${i},'v',this.value)"> <span class="aud-flt-unit">חודשים</span>`;
        case 'open_tasks':
        case 'children':
            if (!['יותר מ','לפחות','בדיוק'].includes(op)) return '<span class="aud-flt-no-val">—</span>';
            return `<input class="inline-input aud-flt-inp" type="number" min="0" value="${saved||1}"
                oninput="audFltChange(${i},'v',this.value)">`;
        case 'boards': {
            const boards = db.__BOARDS__ || [];
            return `<select class="aud-flt-sel" onchange="audFltChange(${i},'v',this.value)">
                <option value="">בחר לוח...</option>
                ${boards.map((b,bi)=>`<option value="${bi}" ${String(saved)===String(bi)?'selected':''}>${esc(b.name||'לוח '+bi)}</option>`).join('')}
            </select>`;
        }
        case 'custom_field': {
            const cfs = appSettings.customFields || [];
            const [cf='',cv=''] = (saved||'').split('|||');
            const needsVal = !['קיים','ריק'].includes(op);
            const cfJ = JSON.stringify(cf);
            const cvJ = JSON.stringify(cv);
            return `<select class="aud-flt-sel" style="flex:0 0 auto;"
                        onchange="audFltChange(${i},'v',this.value+'|||'+${cvJ})">
                    <option value="">בחר שדה...</option>
                    ${cfs.map(f=>`<option value="${esc(f)}" ${cf===f?'selected':''}>${esc(f)}</option>`).join('')}
                </select>
                ${needsVal ? `<input class="inline-input aud-flt-inp" placeholder="ערך..." value="${esc(cv)}"
                    oninput="audFltChange(${i},'v',${cfJ}+'|||'+this.value)">` : ''}`;
        }
        default:
            return `<input class="inline-input aud-flt-inp" placeholder="טקסט חופשי..." value="${esc(saved||'')}"
                oninput="audFltChange(${i},'v',this.value)">`;
    }
}

function _renderAdvFilters() {
    const c = document.getElementById('audAdvRows');
    if (!c) return;
    if (!_advFilters.length) {
        c.innerHTML = '<div style="font-size:12px;color:var(--text-hint);padding:2px 0;">לחץ "הוסף תנאי" — כל נתון בכרטיס יכול לשמש כמסנן</div>';
        return;
    }
    c.innerHTML = _advFilters.map((f, i) => {
        const def = _fdef(f.field);
        return `<div class="aud-flt-row">
            <select class="aud-flt-sel aud-flt-field" onchange="audFltChange(${i},'f',this.value)">
                ${_FDEFS.map(d=>`<option value="${d.k}" ${f.field===d.k?'selected':''}>${d.l}</option>`).join('')}
            </select>
            <select class="aud-flt-sel aud-flt-op" id="af-op-${i}" onchange="audFltChange(${i},'op',this.value)">
                ${def.ops.map(o=>`<option value="${o}" ${f.op===o?'selected':''}>${o}</option>`).join('')}
            </select>
            <div class="aud-flt-val-wrap" id="af-val-${i}">${_valHTML(def.k, f.op, i, f.value)}</div>
            <button class="aud-flt-remove" onclick="removeAdvFilter(${i})" title="הסר">✕</button>
        </div>`;
    }).join('');
}

function _matchAdvFilter(f, flt) {
    const apt = f.apt;
    const { field, op, value } = flt;
    switch (field) {
        case 'tags': {
            if (!value) return true;
            const has = (apt.tags||[]).includes(value);
            return op==='כולל' ? has : !has;
        }
        case 'style':
            if (!value) return true;
            return op==='הוא' ? apt.style===value : apt.style!==value;
        case 'address': {
            if (!value) return true;
            const m = f.bldg.toLowerCase().includes(value.toLowerCase());
            return op==='מכיל' ? m : !m;
        }
        case 'name': {
            if (!value) return true;
            const m = (apt.name||'').toLowerCase().includes(value.toLowerCase());
            return op==='מכיל' ? m : !m;
        }
        case 'last_contact': {
            const logs = apt.interactions||[];
            if (op==='אף פעם') return logs.length===0;
            if (!logs.length) return op==='לפני יותר מ';
            const last = Math.max(...logs.map(l=>new Date(l.date).getTime()||0));
            const d = (Date.now()-last)/864e5, n = parseFloat(value)||30;
            return op==='לפני יותר מ' ? d>n : d<=n;
        }
        case 'contact_ch': {
            if (!value) return true;
            const last = (apt.interactions||[]).find(l=>l.channel);
            if (!last) return op==='אינו';
            return op==='הוא' ? last.channel===value : last.channel!==value;
        }
        case 'has_phone': return op==='קיים' ? getAllPhones(apt).length>0 : getAllPhones(apt).length===0;
        case 'has_email': return op==='קיים' ? getAllEmails(apt).length>0 : getAllEmails(apt).length===0;
        case 'status':
            if (!value) return true;
            return getStatusColor(apt)===value;
        case 'open_tasks': {
            const n = (apt.tasks||[]).filter(t=>!t.done).length;
            if (op==='יש') return n>0;
            if (op==='אין') return n===0;
            return n>(parseInt(value)||0);
        }
        case 'children': {
            const n = (apt.childrenList||[]).length;
            if (op==='יש') return n>0;
            if (op==='אין') return n===0;
            const v = parseInt(value)||0;
            return op==='לפחות' ? n>=v : n===v;
        }
        case 'bar_mitzva': {
            const months = parseInt(value)||12;
            const now = new Date();
            return (apt.childrenList||[]).some(c => {
                if (!c.dob) return false;
                const bd = new Date(c.dob);
                if (isNaN(bd.getTime())) return false;
                const ageYrs = (now-bd)/(365.25*864e5);
                const mUntil = (13-ageYrs)*12;
                return mUntil>=0 && mUntil<=months;
            });
        }
        case 'donations': return op==='תרם' ? (apt.donations||[]).length>0 : (apt.donations||[]).length===0;
        case 'boards': {
            if (value==='') return true;
            const boards = db.__BOARDS__||[];
            const b = boards[parseInt(value)];
            if (!b) return true;
            const mem = !!(apt.boards?.[b.id]||apt.boards?.[parseInt(value)]);
            return op==='חבר ב' ? mem : !mem;
        }
        case 'event_log': {
            if (!value) return true;
            const ql = value.toLowerCase();
            const found = (apt.interactions||[]).some(l=>
                (l.notes||'').toLowerCase().includes(ql)||(l.type||'').toLowerCase().includes(ql)
            );
            return op==='מוזכר' ? found : !found;
        }
        case 'custom_field': {
            const [cf='',cv=''] = (value||'').split('|||');
            if (!cf) return true;
            const fv = String((apt.customData||apt.customFields||{})[cf]||'');
            if (op==='קיים') return fv.length>0;
            if (op==='ריק') return fv.length===0;
            if (op==='שווה ל') return fv===cv;
            return fv.toLowerCase().includes(cv.toLowerCase());
        }
    }
    return true;
}

window.audFltChange = function(i, what, val) {
    if (!_advFilters[i]) return;
    if (what === 'f') {
        const def = _fdef(val);
        _advFilters[i] = { field: val, op: def.ops[0], value: '' };
        _renderAdvFilters();
    } else if (what === 'op') {
        _advFilters[i].op = val;
        _advFilters[i].value = '';
        const def = _fdef(_advFilters[i].field);
        const wrap = document.getElementById(`af-val-${i}`);
        if (wrap) wrap.innerHTML = _valHTML(def.k, val, i, '');
    } else {
        _advFilters[i].value = val;
    }
    _updateAdvBadge();
    _renderList(document.getElementById('audSearch')?.value || '');
};

window.removeAdvFilter = function(i) {
    _advFilters.splice(i, 1);
    _renderAdvFilters();
    _updateAdvBadge();
    _renderList(document.getElementById('audSearch')?.value || '');
};

window.addAdvFilter = function() {
    _advFilters.push({ field: 'tags', op: 'כולל', value: '' });
    if (!_advOpen) {
        _advOpen = true;
        const b = document.getElementById('audAdvBody');
        if (b) b.style.display = 'block';
    }
    _renderAdvFilters();
    _updateAdvBadge();
};

window.clearAdvFilters = function() {
    _advFilters = [];
    _renderAdvFilters();
    _updateAdvBadge();
    _renderList(document.getElementById('audSearch')?.value || '');
};

function _updateAdvBadge() {
    const btn = document.getElementById('audAdvToggleBtn');
    if (!btn) return;
    const n = _advFilters.length;
    const badge = btn.querySelector('.aud-adv-badge');
    if (badge) { badge.textContent = n||''; badge.style.display = n ? '' : 'none'; }
    btn.classList.toggle('active', n > 0);
}

window.toggleAdvFilters = function() {
    _advOpen = !_advOpen;
    const body = document.getElementById('audAdvBody');
    if (body) body.style.display = _advOpen ? 'block' : 'none';
    if (_advOpen) _renderAdvFilters();
};
