// ══════════════════════════════════════════════════════════════
// pledges.js — Pledge Tracking, Donation Analytics & Reports
// ══════════════════════════════════════════════════════════════
(function () {

let tempPledges = [];

// ── Init ─────────────────────────────────────────────────────
window.initPledges = function (apt) {
    tempPledges = JSON.parse(JSON.stringify(apt.pledges || []));
    _recalcPaid();
    renderPledges();
    populateCampaignSelects();
    _updateDonSumBox();
};

window.getPledgesData = function () { return [...tempPledges]; };

// ── Render pledge list ────────────────────────────────────────
window.renderPledges = function () {
    const c = document.getElementById('pledgesList');
    if (!c) return;
    if (!tempPledges.length) {
        c.innerHTML = `<div class="empty-state" style="padding:12px;">
            <i class="fas fa-handshake"></i><div>אין הבטחות תרומה</div></div>`;
        return;
    }
    const STATUS = { pending: ['ממתין', '#f59e0b'], partial: ['חלקי', '#3b82f6'], fulfilled: ['הושלם', '#10b981'], cancelled: ['בוטל', '#94a3b8'] };
    c.innerHTML = tempPledges.map((p, i) => {
        const pct  = p.amount > 0 ? Math.min(100, Math.round((p.paid || 0) / p.amount * 100)) : 0;
        const rem  = (p.amount || 0) - (p.paid || 0);
        const [slabel, scol] = STATUS[p.status] || ['?', '#94a3b8'];
        const camp = _campLabel(p.campaign);
        return `<div class="pledge-row">
            <div class="log-header" style="margin-bottom:6px;">
                <span style="font-weight:700;color:var(--success);">
                    <i class="fas fa-handshake" style="margin-left:5px;color:${scol};"></i>
                    ₪${Number(p.amount).toLocaleString()}${_memberBadge(p.member)}
                </span>
                <div style="display:flex;gap:5px;align-items:center;">
                    <span style="background:${scol}22;color:${scol};padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;">${slabel}</span>
                    <button onclick="removePledge(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:0;font-size:12px;"><i class="fas fa-times"></i></button>
                </div>
            </div>
            ${camp ? `<div style="font-size:11px;color:var(--accent);margin-bottom:4px;"><i class="fas fa-flag" style="margin-left:3px;"></i>${escapeHTML(camp)}</div>` : ''}
            <div class="pledge-bar-wrap">
                <div class="pledge-bar-fill" style="width:${pct}%;background:${scol};"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin:3px 0 6px 0;">
                <span>שולם: <b style="color:#10b981;">₪${Number(p.paid || 0).toLocaleString()}</b></span>
                <span style="font-weight:700;">${pct}%</span>
                <span>יתרה: <b style="color:${rem > 0 ? 'var(--danger)' : '#10b981'};">₪${rem.toLocaleString()}</b></span>
            </div>
            ${p.dueDate ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:5px;"><i class="fas fa-calendar-alt" style="margin-left:3px;"></i>יעד: ${p.dueDate}</div>` : ''}
            ${p.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:5px;">${escapeHTML(p.notes)}</div>` : ''}
            ${p.status !== 'fulfilled' && p.status !== 'cancelled'
                ? `<button onclick="addPledgePayment('${p.id}')" class="btn btn-outline" style="font-size:12px;padding:4px;width:100%;">
                    <i class="fas fa-plus"></i> הוסף תשלום על הבטחה זו</button>` : ''}
        </div>`;
    }).join('');
};

window.addPledge = function () {
    const amount   = parseFloat(document.getElementById('newPledgeAmount')?.value);
    const dueDate  = document.getElementById('newPledgeDue')?.value || '';
    const campaign = document.getElementById('newPledgeCampaign')?.value || '';
    const member   = document.getElementById('newPledgeMember')?.value || 'family';
    const notes    = document.getElementById('newPledgeNotes')?.value?.trim() || '';
    if (!amount || amount <= 0) { showToast('יש להזין סכום', 'warning'); return; }

    tempPledges.push({
        id: 'p_' + Date.now(),
        date: new Date().toISOString().split('T')[0],
        amount, paid: 0, dueDate, campaign, member, notes, status: 'pending',
    });
    markDirty();
    document.getElementById('newPledgeAmount').value = '';
    if (document.getElementById('newPledgeNotes')) document.getElementById('newPledgeNotes').value = '';
    renderPledges();
    _updateDonSumBox();
    showToast(`✅ הבטחת תרומה ₪${amount.toLocaleString()} נרשמה`, 'success');
};

window.removePledge = function (i) {
    tempPledges.splice(i, 1);
    markDirty();
    renderPledges();
    _updateDonSumBox();
};

window.addPledgePayment = function (pledgeId) {
    const pledge = tempPledges.find(p => p.id === pledgeId);
    if (!pledge) return;
    const rem = pledge.amount - (pledge.paid || 0);
    const amtEl  = document.getElementById('newDonAmount');
    const rsEl   = document.getElementById('newDonReason');
    const plgEl  = document.getElementById('newDonPledge');
    const campEl = document.getElementById('newDonCampaign');
    if (amtEl)  amtEl.value  = rem > 0 ? rem : '';
    if (rsEl)   rsEl.value   = 'תשלום על הבטחת תרומה';
    if (plgEl)  plgEl.value  = pledgeId;
    if (campEl && pledge.campaign) campEl.value = pledge.campaign;
    document.getElementById('donFormSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`טופס תרומה מוכן — יתרה: ₪${rem.toLocaleString()}`, 'info');
};

// ── Donation sum box update (called after every change) ───────
window._updateDonSumBox = function () {
    const stats = computeDonationStats();
    const sumEl = document.getElementById('cDonationsSum');
    if (sumEl) sumEl.innerText = `₪${stats.total.toLocaleString()}`;

    const annEl = document.getElementById('donAnnualBreakdown');
    if (!annEl) return;
    const yr = new Date().getFullYear();
    let html = `<span style="color:#10b981;font-weight:600;">השנה: ₪${stats.thisYearSum.toLocaleString()}</span>`;
    html    += `<span style="color:var(--text-muted);margin:0 5px;">|</span>`;
    html    += `<span style="color:var(--text-muted);">אשתקד: ₪${stats.lastYearSum.toLocaleString()}</span>`;
    if (stats.lastYearSum > 0 && stats.thisYearSum === 0)
        html += ` <span class="lybunt-flag" title="תרם ${yr-1} — לא ${yr}"><i class="fas fa-exclamation-triangle"></i> LYBUNT</span>`;
    const openPledge = stats.totalPledged - stats.totalPledgePaid;
    if (openPledge > 0)
        html += `<span style="color:var(--text-muted);margin:0 5px;">|</span><span style="color:#f59e0b;"><i class="fas fa-handshake"></i> פתוח: ₪${openPledge.toLocaleString()}</span>`;
    annEl.innerHTML = html;
};

// ── Donation stats computation ────────────────────────────────
window.computeDonationStats = function () {
    const yr = new Date().getFullYear();
    let total = 0, thisYearSum = 0, lastYearSum = 0;
    const byCampaign = {};
    (typeof tempDonations !== 'undefined' ? tempDonations : []).forEach(d => {
        const amt = Number(d.amount || 0);
        total += amt;
        const y = new Date(d.date).getFullYear();
        if (y === yr)     thisYearSum += amt;
        if (y === yr - 1) lastYearSum += amt;
        if (d.campaign) byCampaign[d.campaign] = (byCampaign[d.campaign] || 0) + amt;
    });
    const totalPledged     = tempPledges.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalPledgePaid  = tempPledges.reduce((s, p) => s + Number(p.paid   || 0), 0);
    return { total, thisYearSum, lastYearSum, byCampaign, totalPledged, totalPledgePaid };
};

// ── Campaign helpers ──────────────────────────────────────────
window.populateCampaignSelects = function () {
    const camps = appSettings.campaigns || [];
    ['newDonCampaign', 'newPledgeCampaign'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const cur = el.value;
        el.innerHTML = `<option value="">ללא קמפיין</option>` +
            camps.map(c => `<option value="${escapeHTML(c.key)}" ${c.key === cur ? 'selected' : ''}>${escapeHTML(c.label)}</option>`).join('');
    });
};

function _campLabel(key) {
    if (!key) return '';
    const c = (appSettings.campaigns || []).find(x => x.key === key);
    return c ? c.label : key;
}

// ── Campaign settings UI ──────────────────────────────────────
window.renderCampaignSettings = function () {
    const c = document.getElementById('campaignSettingsContainer');
    if (!c) return;
    const camps = appSettings.campaigns || [];
    c.innerHTML = camps.length === 0
        ? '<div style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">אין קמפיינים עדיין</div>'
        : camps.map((camp, i) => `
            <div class="score-type-row">
                <i class="fas fa-flag" style="color:${camp.color||'var(--accent)'};flex-shrink:0;"></i>
                <span style="flex:1;font-size:12px;">${escapeHTML(camp.label)}</span>
                <span style="font-size:11px;color:var(--text-muted);">${camp.year || ''}</span>
                <span style="font-size:11px;color:#10b981;font-weight:600;">${camp.active ? 'פעיל' : ''}</span>
                <button onclick="toggleCampaignActive(${i})" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:11px;padding:2px 5px;"
                    title="${camp.active ? 'סמן כלא פעיל' : 'סמן כפעיל'}">
                    <i class="fas ${camp.active ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                </button>
                <button onclick="removeCampaign(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:0;font-size:12px;"><i class="fas fa-times"></i></button>
            </div>`).join('');
};

window.addCampaign = async function () {
    const label = await showCustomDialog({ title: 'קמפיין חדש', message: 'שם הקמפיין:', showInput: true });
    if (!label) return;
    if (!appSettings.campaigns) appSettings.campaigns = [];
    const key = 'camp_' + Date.now();
    appSettings.campaigns.push({ key, label, year: new Date().getFullYear(), active: true, goal: 0 });
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    renderCampaignSettings();
    populateCampaignSelects();
    showToast('קמפיין נוסף ✅', 'success');
};

window.removeCampaign = function (i) {
    appSettings.campaigns.splice(i, 1);
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    renderCampaignSettings();
    populateCampaignSelects();
};

window.toggleCampaignActive = function (i) {
    appSettings.campaigns[i].active = !appSettings.campaigns[i].active;
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    renderCampaignSettings();
};

// ── LYBUNT / Donor Reports ────────────────────────────────────
window.openDonorReport = function () {
    const modal = document.getElementById('donorReportModal');
    if (!modal) return;
    modal.style.display = 'flex';
    renderDonorReport('lybunt');
};

window.renderDonorReport = function (type) {
    const container = document.getElementById('donorReportBody');
    if (!container) return;
    const yr = new Date().getFullYear();

    // Collect all families with donation history
    const families = [];
    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach((apt, idx) => {
            if (!(apt.donations?.length) && !(apt.pledges?.length)) return;
            const dons = apt.donations || [];
            const thisYr = dons.filter(d => new Date(d.date).getFullYear() === yr).reduce((s, d) => s + Number(d.amount || 0), 0);
            const lastYr = dons.filter(d => new Date(d.date).getFullYear() === yr - 1).reduce((s, d) => s + Number(d.amount || 0), 0);
            const total  = dons.reduce((s, d) => s + Number(d.amount || 0), 0);
            const pledgeBalance = (apt.pledges || []).filter(p => p.status !== 'fulfilled' && p.status !== 'cancelled')
                .reduce((s, p) => s + (Number(p.amount || 0) - Number(p.paid || 0)), 0);
            families.push({ bldg, idx, apt, thisYr, lastYr, total, pledgeBalance });
        });
    });

    let rows = [];
    let title = '';

    if (type === 'lybunt') {
        rows = families.filter(f => f.lastYr > 0 && f.thisYr === 0)
            .sort((a, b) => b.lastYr - a.lastYr);
        title = `LYBUNT — תרמו ${yr - 1} אבל לא ${yr} (${rows.length})`;
    } else if (type === 'top') {
        rows = families.filter(f => f.thisYr > 0)
            .sort((a, b) => b.thisYr - a.thisYr).slice(0, 20);
        title = `תורמי השנה ${yr} — TOP (${rows.length})`;
    } else if (type === 'pledges') {
        rows = families.filter(f => f.pledgeBalance > 0)
            .sort((a, b) => b.pledgeBalance - a.pledgeBalance);
        title = `הבטחות פתוחות (${rows.length})`;
    } else if (type === 'never') {
        rows = families.filter(f => f.total === 0);
        title = `משפחות שעדיין לא תרמו (${rows.length})`;
    }

    document.getElementById('donorReportTitle').textContent = title;

    if (!rows.length) {
        container.innerHTML = '<div class="empty-state" style="padding:30px;"><i class="fas fa-check-circle" style="color:#10b981;font-size:28px;"></i><div>אין רשומות</div></div>';
        return;
    }

    container.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
            <tr style="background:var(--bg-body);text-align:right;">
                <th style="padding:8px;border-bottom:2px solid var(--border-light);">משפחה</th>
                <th style="padding:8px;border-bottom:2px solid var(--border-light);text-align:center;">${yr}</th>
                <th style="padding:8px;border-bottom:2px solid var(--border-light);text-align:center;">${yr - 1}</th>
                <th style="padding:8px;border-bottom:2px solid var(--border-light);text-align:center;">סה"כ</th>
                <th style="padding:8px;border-bottom:2px solid var(--border-light);text-align:center;">הבטחה</th>
                <th style="padding:8px;border-bottom:2px solid var(--border-light);"></th>
            </tr>
        </thead>
        <tbody>
            ${rows.map(r => `<tr style="border-bottom:1px solid var(--border-light);cursor:pointer;" onclick="currentBldg='${r.bldg}';openClientCard(${r.idx});document.getElementById('donorReportModal').style.display='none';">
                <td style="padding:8px;font-weight:600;">${escapeHTML(r.apt.name || r.bldg)}</td>
                <td style="padding:8px;text-align:center;color:${r.thisYr > 0 ? '#10b981' : '#ef4444'};font-weight:600;">₪${r.thisYr.toLocaleString()}</td>
                <td style="padding:8px;text-align:center;color:var(--text-muted);">₪${r.lastYr.toLocaleString()}</td>
                <td style="padding:8px;text-align:center;">₪${r.total.toLocaleString()}</td>
                <td style="padding:8px;text-align:center;color:${r.pledgeBalance > 0 ? '#f59e0b' : 'var(--text-muted)'};">${r.pledgeBalance > 0 ? '₪' + r.pledgeBalance.toLocaleString() : '—'}</td>
                <td style="padding:8px;text-align:center;"><i class="fas fa-arrow-left" style="color:var(--accent);font-size:11px;"></i></td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
            <tr style="font-weight:700;background:var(--bg-body);">
                <td style="padding:8px;">סה"כ</td>
                <td style="padding:8px;text-align:center;color:#10b981;">₪${rows.reduce((s,r)=>s+r.thisYr,0).toLocaleString()}</td>
                <td style="padding:8px;text-align:center;">₪${rows.reduce((s,r)=>s+r.lastYr,0).toLocaleString()}</td>
                <td style="padding:8px;text-align:center;">₪${rows.reduce((s,r)=>s+r.total,0).toLocaleString()}</td>
                <td colspan="2"></td>
            </tr>
        </tfoot>
    </table>`;
};

// ── Internal ──────────────────────────────────────────────────
function _recalcPaid() {
    const donations = typeof tempDonations !== 'undefined' ? tempDonations : [];
    tempPledges.forEach(p => {
        p.paid = donations.filter(d => d.pledgeId === p.id).reduce((s, d) => s + Number(d.amount || 0), 0);
        if (p.paid >= p.amount)            p.status = 'fulfilled';
        else if (p.paid > 0)               p.status = 'partial';
        else if (p.status !== 'cancelled') p.status = 'pending';
    });
}

// Called from addDonation when a pledge payment is recorded
window.refreshPledgesAfterDonation = function () {
    _recalcPaid();
    renderPledges();
    _updateDonSumBox();
};

})();
