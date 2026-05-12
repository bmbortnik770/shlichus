// ══════════════════════════════════════════════════════════════
// global-donations.js — Global Donations Overview
// ══════════════════════════════════════════════════════════════
(function () {

let _donFilter = '';
let _donSort = 'amount_desc';

window.renderGlobalDonations = function () {
    const inner = document.getElementById('global-donations-inner');
    if (!inner || typeof db === 'undefined') return;

    // Collect all donations
    const rows = [];
    let grandTotal = 0;

    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach((apt, idx) => {
            const dons = apt.donations || [];
            const total = dons.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
            if (total > 0 || dons.length > 0) {
                grandTotal += total;
                rows.push({ bldg, idx, apt, total, count: dons.length, dons });
            }
        });
    });

    // Sort
    if (_donSort === 'amount_desc') rows.sort((a, b) => b.total - a.total);
    else if (_donSort === 'amount_asc') rows.sort((a, b) => a.total - b.total);
    else if (_donSort === 'count_desc') rows.sort((a, b) => b.count - a.count);
    else if (_donSort === 'name') rows.sort((a, b) => (a.apt.name || '').localeCompare(b.apt.name || ''));

    // Filter
    const filtered = _donFilter
        ? rows.filter(r => (r.apt.name || '').toLowerCase().includes(_donFilter.toLowerCase()) || r.bldg.toLowerCase().includes(_donFilter.toLowerCase()))
        : rows;

    const safe = s => (typeof escapeHTML === 'function' ? escapeHTML(s || '') : (s || ''));
    const fmtMoney = n => `₪${Math.round(n).toLocaleString('he-IL')}`;

    const donorCount = rows.length;
    const avgDon = donorCount > 0 ? grandTotal / donorCount : 0;

    // Campaign breakdown
    const campaigns = {};
    rows.forEach(r => {
        r.dons.forEach(d => {
            const camp = d.campaign || 'כללי';
            if (!campaigns[camp]) campaigns[camp] = 0;
            campaigns[camp] += parseFloat(d.amount) || 0;
        });
    });
    const topCampaigns = Object.entries(campaigns).sort((a, b) => b[1] - a[1]).slice(0, 5);

    inner.innerHTML = `
        <!-- KPI row -->
        <div class="dash-stat-grid" style="margin-bottom:16px;">
            <div class="dash-stat-card">
                <div class="dash-stat-value" style="color:#10b981;">${fmtMoney(grandTotal)}</div>
                <div class="dash-stat-label">סך כל התרומות</div>
            </div>
            <div class="dash-stat-card">
                <div class="dash-stat-value" style="color:var(--accent);">${donorCount}</div>
                <div class="dash-stat-label">משפחות תורמות</div>
            </div>
            <div class="dash-stat-card">
                <div class="dash-stat-value" style="color:#8b5cf6;">${fmtMoney(avgDon)}</div>
                <div class="dash-stat-label">ממוצע למשפחה</div>
            </div>
        </div>

        <!-- Campaign breakdown -->
        ${topCampaigns.length > 0 ? `
        <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:14px;padding:14px;margin-bottom:16px;">
            <div class="dash-section-title" style="margin-bottom:10px;"><i class="fas fa-chart-bar" style="color:var(--accent);"></i> לפי קמפיין</div>
            ${topCampaigns.map(([camp, total]) => {
                const pct = grandTotal > 0 ? (total / grandTotal * 100).toFixed(0) : 0;
                return `<div style="margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:3px;">
                        <span>${safe(camp)}</span>
                        <span style="color:#10b981;">${fmtMoney(total)} <span style="color:var(--text-muted);">(${pct}%)</span></span>
                    </div>
                    <div style="height:6px;background:var(--bg-body);border-radius:10px;overflow:hidden;">
                        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),#10b981);border-radius:10px;transition:width .5s;"></div>
                    </div>
                </div>`;
            }).join('')}
        </div>` : ''}

        <!-- Search + sort bar -->
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
            <div style="flex:1;min-width:200px;position:relative;">
                <i class="fas fa-search" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--text-hint);font-size:13px;"></i>
                <input type="text" class="inline-input" placeholder="חיפוש לפי שם..."
                    style="width:100%;padding:8px 32px 8px 10px;font-size:13px;"
                    oninput="_donSetFilter(this.value)">
            </div>
            <select class="inline-input" style="width:auto;padding:8px;font-size:13px;" onchange="_donSetSort(this.value)">
                <option value="amount_desc">מיון: סכום יורד</option>
                <option value="amount_asc">מיון: סכום עולה</option>
                <option value="count_desc">מיון: מספר תרומות</option>
                <option value="name">מיון: שם</option>
            </select>
        </div>

        <!-- Donor list -->
        <div id="don-list-rows">
            ${filtered.length === 0
                ? `<div style="text-align:center;padding:40px;color:var(--text-muted);"><i class="fas fa-hand-holding-heart" style="font-size:32px;opacity:.2;display:block;margin-bottom:12px;"></i><div>אין תרומות מתועדות</div></div>`
                : filtered.map((r, i) => {
                    const bldgDisp = r.bldg === '__NO_ADDRESS__' ? 'ללא כתובת' : r.bldg;
                    const lastDon = r.dons.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
                    const lastDateStr = lastDon?.date ? new Date(lastDon.date).toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '';
                    return `<div class="glob-don-row" onclick="currentBldg='${safe(r.bldg)}'; openClientCard(${r.idx}); setTimeout(()=>switchCrmTab('donations'), 100);">
                        <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#10b981,#0ea5e9);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;color:white;font-weight:700;">${i+1}</div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:14px;font-weight:700;color:var(--text-main);">${safe(r.apt.name || '(ללא שם)')}</div>
                            <div style="font-size:11px;color:var(--text-muted);">${safe(bldgDisp)} · ${r.count} תרומות${lastDateStr ? ` · אחרונה: ${lastDateStr}` : ''}</div>
                        </div>
                        <div style="text-align:left;flex-shrink:0;">
                            <div style="font-size:16px;font-weight:800;color:#10b981;">${fmtMoney(r.total)}</div>
                        </div>
                    </div>`;
                }).join('')
            }
        </div>
    `;
};

window._donSetFilter = function (val) {
    _donFilter = val;
    renderGlobalDonations();
};
window._donSetSort = function (val) {
    _donSort = val;
    renderGlobalDonations();
};

})();
