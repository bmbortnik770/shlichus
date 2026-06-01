// ══════════════════════════════════════════════════════════════
// comm.js — מודול תקשורת מקצועי
// נטען אחרון — מרחיב את כל פונקציות ה-comm שב-app.js
// ══════════════════════════════════════════════════════════════

// ── עטוף את switchCommTab — הוסף SMS / Phone / Logs ──
const _origSwitchCommTab = window.switchCommTab;
window.switchCommTab = function(tabName) {
    _origSwitchCommTab(tabName);
    if (tabName === 'sms')   { _initSMSTab(); renderSMSRecipients(); }
    if (tabName === 'phone') renderCallList();
    if (tabName === 'logs')  renderCommLogs();
    updateCommStats();
};

// ── עטוף את executeQueueAction — תעד אוטומטי ──
const _origExecQueueAction = window.executeQueueAction || function(){};
window.executeQueueAction = function(name, phone, email, text) {
    const currentR = (window.commQueue || [])[window.currentQueueIdx];
    _origExecQueueAction(name, phone, email, text);
    if (currentR) autoLogSentMessage(window.currentQueueType || 'comm', [currentR], text);
};

// ══════════════════════════════════════════════════════════════
// תיעוד אוטומטי — CORE
// ══════════════════════════════════════════════════════════════

window.autoLogSentMessage = function(channel, recipients, text, result = '') {
    const channelLabel = { whatsapp: 'WhatsApp', email: 'מייל', sms: 'SMS', phone: 'שיחה' }[channel] || channel;
    const now = new Date();
    const dateStr = now.toLocaleDateString('he-IL');
    const timeStr = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    let logged = 0;

    (recipients || []).forEach(r => {
        if (!r.key) return;
        const [bldg, aptIdxStr] = r.key.split('|');
        const aptIdx = parseInt(aptIdxStr);
        if (!db[bldg]?.apts?.[aptIdx]) return;
        const apt = db[bldg].apts[aptIdx];
        if (!apt.interactions) apt.interactions = [];
        const shortText = text.replace(/\[\s*שם\s*\]/g, r.name || 'משפחה').substring(0, 120);
        apt.interactions.unshift({
            date: `${dateStr} ${timeStr}`,
            type: channelLabel,
            notes: shortText,
            channel,
            source: 'comm_hub',
            result: result || ''
        });
        apt.updatedAt = Date.now();
        logged++;
    });

    if (logged > 0) { saveDB(); handleOmniSearch(); }
    return logged;
};

// ── עדכן מונה הודעות בכותרת ──
window.updateCommStats = function() {
    const el = document.getElementById('commMonthlyCount');
    if (!el) return;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let count = 0;
    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach(apt => {
            (apt.interactions || []).forEach(log => {
                if (log.source === 'comm_hub' && new Date(log.date).getTime() >= cutoff) count++;
            });
        });
    });
    el.textContent = `${count} הודעות נשלחו החודש`;
};

// ══════════════════════════════════════════════════════════════
// PHONE TAB — מרכז חיוג
// ══════════════════════════════════════════════════════════════

let _callFilter = 'all';   // all | need_contact | has_tasks | no_phone
let _callSort   = 'urgency'; // urgency | name | last_contact
let _callSearch = '';

window.setCallFilter = function(f) {
    _callFilter = f;
    document.querySelectorAll('.call-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.f === f));
    renderCallList();
};
window.setCallSort = function(s) {
    _callSort = s;
    renderCallList();
};
window.setCallSearch = function(v) {
    _callSearch = v;
    renderCallList();
};

window.renderCallList = function() {
    const c = document.getElementById('callListContainer');
    if (!c) return;

    let families = [];
    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        if (!db[bldg]?.apts) return;
        db[bldg].apts.forEach((apt, idx) => {
            const phones = getAllPhones(apt);
            const color = getStatusColor(apt);
            families.push({ bldg, idx, apt, phones, color });
        });
    });

    // סינון
    if (_callFilter === 'need_contact')
        families = families.filter(f => f.color === '#ef4444' || f.color === '#94a3b8');
    else if (_callFilter === 'has_tasks')
        families = families.filter(f => (f.apt.tasks || []).some(t => !t.done));
    else if (_callFilter === 'no_phone')
        families = families.filter(f => f.phones.length === 0);

    // חיפוש
    if (_callSearch) {
        const q = _callSearch.toLowerCase();
        families = families.filter(f =>
            (f.apt.name || '').toLowerCase().includes(q) ||
            f.bldg.toLowerCase().includes(q) ||
            f.phones.some(p => p.includes(q))
        );
    }

    // מיון
    families.sort((a, b) => {
        if (_callSort === 'urgency') {
            const rank = c => c === '#94a3b8' ? 0 : c === '#ef4444' ? 1 : c === '#f59e0b' ? 2 : 3;
            return rank(a.color) - rank(b.color);
        }
        if (_callSort === 'name') return (a.apt.name || '').localeCompare(b.apt.name || '', 'he');
        if (_callSort === 'last_contact') {
            const lastMs = apt => {
                const logs = apt.interactions || [];
                if (!logs.length) return 0;
                return Math.max(...logs.map(l => new Date(l.date).getTime() || 0));
            };
            return lastMs(a.apt) - lastMs(b.apt);
        }
        return 0;
    });

    const counter = document.getElementById('callListCount');
    if (counter) counter.textContent = families.length;

    if (families.length === 0) {
        c.innerHTML = `<div class="empty-state" style="padding:40px 0;"><i class="fas fa-phone-slash" style="font-size:36px; opacity:.3;"></i><h4>אין משפחות</h4><p style="color:var(--text-muted);">שנה את הסינון</p></div>`;
        return;
    }

    c.innerHTML = families.map(({ bldg, idx, apt, phones, color }) => {
        const safeName = escapeHTML(apt.name || 'ללא שם');
        const safeBldg = escapeHTML(bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : bldg);
        const logs = [...(apt.interactions || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
        const lastTxt = logs.length ? escapeHTML(logs[0].date + ' — ' + logs[0].type) : 'לא נוצר קשר';
        const openTasks = (apt.tasks || []).filter(t => !t.done).length;
        const encBldg = encodeURIComponent(bldg);

        const phoneBtns = phones.slice(0, 2).map((ph, pi) => {
            let cp = String(ph).replace(/\D/g, '');
            if (cp.length < 7) return ''; // מספר לא תקין
            if (cp.startsWith('0')) cp = '972' + cp.substring(1);
            const lbl = pi === 0 ? (apt.father?.split(' ')[0] || 'אבא') : (apt.mother?.split(' ')[0] || 'אמא');
            return `<a href="tel:+${cp}" class="call-btn" onclick="event.stopPropagation()">
                        <i class="fas fa-phone"></i> ${escapeHTML(lbl)}
                    </a>`;
        }).join('');

        const waBtn = phones[0] ? (() => {
            let cp = String(phones[0]).replace(/\D/g, '');
            if (cp.startsWith('0')) cp = '972' + cp.substring(1);
            return `<a href="https://wa.me/${cp}" target="_blank" class="call-btn wa-btn" onclick="event.stopPropagation()"><i class="fab fa-whatsapp"></i></a>`;
        })() : '';

        const taskBadge = openTasks > 0 ? `<span class="call-tasks-badge"><i class="fas fa-tasks"></i> ${openTasks}</span>` : '';

        return `<div class="call-list-row" onclick="currentBldg='${escapeHTML(bldg)}'; openClientCard(${idx})">
            <div class="call-row-status" style="background:${color};"></div>
            <div class="call-row-info">
                <div class="call-row-name">${safeName}</div>
                <div class="call-row-addr"><i class="fas fa-map-marker-alt" style="opacity:.4; font-size:10px;"></i> ${safeBldg}</div>
                <div class="call-row-last"><i class="fas fa-clock" style="opacity:.4; font-size:10px;"></i> ${lastTxt}</div>
            </div>
            <div class="call-row-actions">
                ${phoneBtns}${waBtn}${taskBadge}
                <button class="call-log-btn" onclick="event.stopPropagation(); quickCallLog('${encBldg}',${idx})" title="תעד שיחה">
                    <i class="fas fa-pen-to-square"></i> תעד
                </button>
            </div>
        </div>`;
    }).join('');
};

// ── Quick Call Log ──
let _qcBldg = null, _qcIdx = null;

window.quickCallLog = function(encBldg, idx) {
    _qcBldg = decodeURIComponent(encBldg);
    _qcIdx  = idx;
    const apt = db[_qcBldg]?.apts?.[idx];
    if (!apt) return;
    document.getElementById('qcFamilyName').textContent = apt.name || 'ללא שם';
    document.getElementById('qcNotes').value = '';
    document.querySelectorAll('.qc-result-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('quickCallModal').style.display = 'flex';
};

window.saveQuickCallLog = function() {
    const active = document.querySelector('.qc-result-btn.active');
    const result      = active ? active.dataset.r : '';
    const resultLabel = active ? active.textContent.trim() : '';
    const notes  = document.getElementById('qcNotes').value.trim();
    const apt = db[_qcBldg]?.apts?.[_qcIdx];
    if (!apt) return;
    if (!apt.interactions) apt.interactions = [];
    const now = new Date();
    apt.interactions.unshift({
        date:    now.toLocaleDateString('he-IL') + ' ' + now.toLocaleTimeString('he-IL', {hour:'2-digit',minute:'2-digit'}),
        type:    'שיחה',
        notes:   resultLabel + (notes ? ': ' + notes : ''),
        channel: 'phone',
        source:  'comm_hub',
        result
    });
    apt.updatedAt = Date.now();
    saveDB(); handleOmniSearch(); renderCallList(); updateCommStats();
    document.getElementById('quickCallModal').style.display = 'none';
    showToast('השיחה תועדה! ' + getRandomCompliment(), 'success');
};

window.setQCResult = function(btn) {
    document.querySelectorAll('.qc-result-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
};

// ══════════════════════════════════════════════════════════════
// SMS TAB
// ══════════════════════════════════════════════════════════════

let _smsR = []; // SMS recipients

function _initSMSTab() {
    const sel = document.getElementById('smsTemplateSelect');
    if (sel) {
        sel.innerHTML = '<option value="">-- בחר תבנית --</option>' +
            (appSettings.templates || []).map((t, i) => `<option value="${i}">${escapeHTML(t.title)}</option>`).join('');
    }
    _updateSMSProviderBadge();
}

function _updateSMSProviderBadge() {
    const badge = document.getElementById('smsProviderBadge');
    if (!badge) return;
    const svc = appSettings.commServices?.smsProvider || 'none';
    const labels = { none: '📱 SMS מקומי (sms:)', twilio: '🌐 Twilio API', infobip: '🌐 Infobip', dbs: '🌐 019 SMS' };
    badge.textContent = labels[svc] || labels.none;
}

window.previewSMSTemplate = function() {
    const sel = document.getElementById('smsTemplateSelect');
    const ta  = document.getElementById('smsMessageText');
    if (!sel || !ta) return;
    const idx = parseInt(sel.value);
    if (!isNaN(idx) && appSettings.templates[idx]) ta.value = appSettings.templates[idx].text;
};

window.renderSMSRecipients = function() {
    if (window.bulkSelection?.length > 0) {
        _smsR = [];
        bulkSelection.forEach(v => {
            const [b, i] = v.split('|');
            const a = db[b]?.apts?.[parseInt(i)];
            if (a) _smsR.push({ name: a.name || 'ללא שם', phone: getAllPhones(a)[0] || '', key: v });
        });
        bulkSelection = [];
    }
    const cnt  = document.getElementById('smsRecipientCount');
    const list = document.getElementById('smsRecipientsList');
    if (cnt) cnt.textContent = _smsR.length;
    if (!list) return;
    if (_smsR.length === 0) {
        list.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">אין נמענים. הוסף מהרשימה.</div>`;
        return;
    }
    list.innerHTML = _smsR.map((r, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-body);border:1px solid var(--border-light);border-radius:6px;margin-bottom:4px;">
            <span style="flex:1;font-weight:600;font-size:13px;">${escapeHTML(r.name)}</span>
            <span style="font-size:12px;color:var(--text-muted);direction:ltr;">${r.phone || '<span style="color:var(--danger);">חסר</span>'}</span>
            <button class="btn-icon" style="color:var(--danger);padding:2px 6px;" onclick="removeSMSR(${i})"><i class="fas fa-times"></i></button>
        </div>`).join('');
};

window.addSMSFromDB = function() {
    window.switchMainView('table');
    showToast('סמן משפחות ולאחר מכן חזור לתקשורת ← SMS', 'info');
};

window.addSMSManually = async function() {
    const name  = await showCustomDialog({ title: 'הוסף נמען', message: 'שם:', showInput: true, showCancel: true });
    if (!name) return;
    const phone = await showCustomDialog({ title: 'מספר טלפון', message: 'מספר (כולל 0 בהתחלה):', showInput: true, showCancel: true });
    if (!phone) return;
    _smsR.push({ name: name.trim(), phone: phone.trim(), key: null });
    renderSMSRecipients();
};

window.removeSMSR = function(i) { _smsR.splice(i, 1); renderSMSRecipients(); };

window.sendCommSMS = async function() {
    const text = document.getElementById('smsMessageText')?.value?.trim();
    if (!text) return showToast('יש להזין תוכן', 'warning');
    const valid = _smsR.filter(r => r.phone);
    if (!valid.length) return showToast('אין נמענים עם מספר טלפון', 'error');

    const svc = appSettings.commServices || {};
    if (svc.smsProvider === 'twilio') {
        if (!svc.twilioSid || !svc.twilioToken || !svc.twilioFrom) {
            showToast('הגדרות Twilio חסרות — בדוק SID, Token ומספר שולח', 'error');
            return;
        }
        await _sendViaTwilio(valid, text, svc);
    } else {
        // sms: URI — works on mobile; desktop shows helper
        const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
        if (valid.length === 1 && isMobile) {
            const r = valid[0];
            const pText = text.replace(/\[\s*שם\s*\]/g, r.name);
            let cp = String(r.phone).replace(/\D/g, '');
            if (cp.startsWith('0')) cp = '+972' + cp.substring(1);
            window.location.href = `sms:${cp}?body=${encodeURIComponent(pText)}`;
            autoLogSentMessage('sms', [r], text);
            _smsR = []; renderSMSRecipients(); updateCommStats();
        } else {
            _showSMSQueue(valid, text);
        }
    }
};

async function _sendViaTwilio(recipients, text, svc) {
    let sent = 0, failed = 0;
    setSyncStatus('wait', 'שולח SMS...');
    for (const r of recipients) {
        const pText = text.replace(/\[\s*שם\s*\]/g, r.name);
        let cp = String(r.phone).replace(/\D/g, '');
        if (cp.startsWith('0')) cp = '+972' + cp.substring(1);
        else if (!cp.startsWith('+')) cp = '+972' + cp;
        try {
            const res = await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${svc.twilioSid}/Messages.json`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Basic ' + btoa(svc.twilioSid + ':' + svc.twilioToken),
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({ To: cp, From: svc.twilioFrom || '', Body: pText })
                }
            );
            res.ok ? sent++ : failed++;
        } catch (e) { failed++; }
    }
    autoLogSentMessage('sms', recipients.filter(r => r.key), text);
    setSyncStatus('ok', 'מסונכרן');
    showToast(`✅ ${sent} SMS נשלחו${failed ? `, ${failed} נכשלו` : ''}`, sent > 0 ? 'success' : 'error');
    _smsR = []; renderSMSRecipients(); updateCommStats();
}

// ── SMS Queue Helper (desktop) ──
let _smsQ = null;
window.cancelSMSQueue = function() { _smsQ = null; };
window._smsQueueNext = function() {
    if (!_smsQ) return;
    _smsQ.idx++;
    if (_smsQ.idx >= _smsQ.recipients.length) {
        autoLogSentMessage('sms', _smsQ.recipients.filter(r => r.key), _smsQ.text);
        _smsR = []; renderSMSRecipients(); updateCommStats();
        document.getElementById('smsHelperModal').style.display = 'none';
        showToast('כל ה-SMS הושלמו!', 'success');
        _smsQ = null;
        return;
    }
    _renderSMSQueueStep();
};

function _showSMSQueue(recipients, text) {
    _smsQ = { recipients, text, idx: 0 };
    document.getElementById('smsHelperModal').style.display = 'flex';
    _renderSMSQueueStep();
}

function _renderSMSQueueStep() {
    if (!_smsQ) return;
    const r  = _smsQ.recipients[_smsQ.idx];
    const pText = _smsQ.text.replace(/\[\s*שם\s*\]/g, r.name);
    let cp = String(r.phone).replace(/\D/g, '');
    if (cp.startsWith('0')) cp = '+972' + cp.substring(1);

    document.getElementById('smsHelperProgress').textContent = `${_smsQ.idx + 1} / ${_smsQ.recipients.length}`;
    document.getElementById('smsHelperName').textContent    = r.name;
    document.getElementById('smsHelperPhone').textContent   = '+' + cp;
    document.getElementById('smsHelperText').textContent    = pText;
    document.getElementById('smsHelperLink').href = `sms:+${cp}?body=${encodeURIComponent(pText)}`;
}

// ══════════════════════════════════════════════════════════════
// LOGS TAB — היסטוריית תקשורת גלובלית
// ══════════════════════════════════════════════════════════════

let _logsFilter = '';   // '' = all, or channel: whatsapp/email/sms/phone/visit
let _logsSearch = '';
let _logsLimit  = 50;

const _chanIcons = {
    whatsapp: { icon: 'fa-whatsapp fab', color: '#25D366' },
    email:    { icon: 'fa-envelope fas', color: '#ea4335' },
    sms:      { icon: 'fa-sms fas',      color: '#0ea5e9' },
    phone:    { icon: 'fa-phone fas',    color: 'var(--success)' },
    visit:    { icon: 'fa-walking fas',  color: 'var(--accent)' }
};
const _typeToChannel = {
    'WhatsApp': 'whatsapp', 'מייל': 'email', 'SMS': 'sms',
    'שיחה': 'phone', 'ביקור': 'visit'
};

window.showMoreCommLogs = function() { _logsLimit += 50; renderCommLogs(); };

window.setLogsFilter = function(f) {
    _logsFilter = f;
    document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.f === f));
    renderCommLogs();
};
window.setLogsSearch = function(v) { _logsSearch = v; renderCommLogs(); };

window.renderCommLogs = function() {
    const c = document.getElementById('commLogsTimeline');
    if (!c) return;

    // אסוף את כל האינטראקציות
    let entries = [];
    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach((apt, idx) => {
            (apt.interactions || []).forEach(log => {
                entries.push({ bldg, idx, apt, log });
            });
        });
    });

    // מיון — החדש ביותר ראשון
    entries.sort((a, b) => new Date(b.log.date) - new Date(a.log.date));

    // סינון לפי ערוץ
    if (_logsFilter) {
        entries = entries.filter(e => {
            const ch = e.log.channel || _typeToChannel[e.log.type] || '';
            return ch === _logsFilter;
        });
    }

    // חיפוש
    if (_logsSearch) {
        const q = _logsSearch.toLowerCase();
        entries = entries.filter(e =>
            (e.apt.name || '').toLowerCase().includes(q) ||
            (e.log.notes || '').toLowerCase().includes(q) ||
            e.bldg.toLowerCase().includes(q)
        );
    }

    const counter = document.getElementById('logsCount');
    if (counter) counter.textContent = entries.length;

    if (entries.length === 0) {
        c.innerHTML = `<div class="empty-state" style="padding:40px 0;"><i class="fas fa-history" style="font-size:36px;opacity:.3;"></i><h4>אין רשומות תקשורת</h4><p style="color:var(--text-muted);">תיעוד קשרים מופיע כאן אוטומטית</p></div>`;
        return;
    }

    const visible = entries.slice(0, _logsLimit);
    const hasMore = entries.length > _logsLimit;

    c.innerHTML = visible.map(({ bldg, idx, apt, log }) => {
        const ch = log.channel || _typeToChannel[log.type] || 'phone';
        const ci = _chanIcons[ch] || _chanIcons.phone;
        const safeName = escapeHTML(apt.name || 'ללא שם');
        const safeBldg = escapeHTML(bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : bldg);
        const safeNotes = escapeHTML(log.notes || '');
        const safeDate  = escapeHTML(log.date || '');
        const resultBadge = log.result ? `<span style="background:rgba(var(--accent-rgb),.1);color:var(--accent);font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;margin-right:4px;">${escapeHTML(log.result)}</span>` : '';
        const sourceBadge = log.source === 'comm_hub' ? `<span style="opacity:.5;font-size:10px;">מרכז תקשורת</span>` : (log.source === 'field' ? `<span style="opacity:.5;font-size:10px;">שטח</span>` : '');

        return `<div class="comm-log-entry" onclick="currentBldg='${escapeHTML(bldg)}'; openClientCard(${idx})">
            <div class="comm-log-icon" style="background:${ci.color}22; color:${ci.color};">
                <i class="${ci.icon}"></i>
            </div>
            <div class="comm-log-body">
                <div class="comm-log-title">${safeName} <span style="font-weight:400;font-size:12px;color:var(--text-muted);">${safeBldg}</span></div>
                <div class="comm-log-meta">${safeDate} · ${escapeHTML(log.type)} ${resultBadge} ${sourceBadge}</div>
                ${safeNotes ? `<div class="comm-log-notes">${safeNotes}</div>` : ''}
            </div>
        </div>`;
    }).join('') + (hasMore ? `<div style="text-align:center;padding:12px;"><button class="btn btn-outline" style="width:auto;padding:8px 20px;" onclick="showMoreCommLogs()">הצג עוד (${entries.length - _logsLimit} נשארו)</button></div>` : '');
};

// ══════════════════════════════════════════════════════════════
// שירותים חיצוניים — EXTERNAL SERVICES
// ══════════════════════════════════════════════════════════════

window.openCommServices = function() {
    const svc = appSettings.commServices || {};
    document.getElementById('csProvider').value      = svc.smsProvider    || 'none';
    document.getElementById('csTwilioSid').value     = svc.twilioSid      || '';
    document.getElementById('csTwilioToken').value   = svc.twilioToken    || '';
    document.getElementById('csTwilioFrom').value    = svc.twilioFrom     || '';
    document.getElementById('csEmailProvider').value = svc.emailProvider  || 'native';
    document.getElementById('csSendGridKey').value   = svc.sendGridKey    || '';
    _toggleCommServiceFields();
    document.getElementById('commServicesModal').style.display = 'flex';
};

window.closeCommServices = function() {
    document.getElementById('commServicesModal').style.display = 'none';
};

window._toggleCommServiceFields = function() {
    const sms   = document.getElementById('csProvider').value;
    const email = document.getElementById('csEmailProvider').value;
    document.getElementById('twilioFields').style.display   = sms === 'twilio' ? 'block' : 'none';
    document.getElementById('sendGridFields').style.display = email === 'sendgrid' ? 'block' : 'none';
};

window.saveCommServices = function() {
    if (!appSettings.commServices) appSettings.commServices = {};
    appSettings.commServices.smsProvider   = document.getElementById('csProvider').value;
    appSettings.commServices.twilioSid     = document.getElementById('csTwilioSid').value.trim();
    appSettings.commServices.twilioToken   = document.getElementById('csTwilioToken').value.trim();
    appSettings.commServices.twilioFrom    = document.getElementById('csTwilioFrom').value.trim();
    appSettings.commServices.emailProvider = document.getElementById('csEmailProvider').value;
    appSettings.commServices.sendGridKey   = document.getElementById('csSendGridKey').value.trim();
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    closeCommServices();
    _updateSMSProviderBadge();
    showToast('שירותי תקשורת עודכנו ✅', 'success');
};

window.testTwilio = async function() {
    const sid   = document.getElementById('csTwilioSid').value.trim();
    const token = document.getElementById('csTwilioToken').value.trim();
    const from  = document.getElementById('csTwilioFrom').value.trim();
    if (!sid || !token) return showToast('הכנס SID ו-Token תחילה', 'warning');
    showToast('בודק חיבור ל-Twilio...', 'info');
    try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
            headers: { 'Authorization': 'Basic ' + btoa(sid + ':' + token) }
        });
        if (res.ok) showToast('✅ חיבור Twilio תקין!', 'success');
        else showToast('❌ פרטי Twilio שגויים', 'error');
    } catch (e) { showToast('שגיאת רשת — בדוק CORS', 'warning'); }
};
