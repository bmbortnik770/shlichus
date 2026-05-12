// ██  מודול ציוני דרך — Milestones  ██
// ════════════════════════════════════════════════════════════

let tempMilestones = [];
let _msInputMode = 'greg'; // 'greg' | 'heb'

// ── אתחול UI כשנפתחת הלשונית ──
window.switchCrmTab = (tab) => {
    document.querySelectorAll('#clientModal .crm-tab, #clientModal .crm-tab-content')
        .forEach(e => e.classList.remove('active'));
    const tabBtn = document.getElementById(`tabBtn-${tab}`);
    const tabContent = document.getElementById(`crm-${tab}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (tabContent) tabContent.classList.add('active');
    if (tab === 'milestones') _initMilestonesTab();
    if (tab === 'activity' && typeof renderFamilyActivityTab === 'function') {
        renderFamilyActivityTab();
    }
    // If switching to a hidden backward-compat tab, also show the activity tab
    if (['tasks','logs','lifecycle'].includes(tab)) {
        // These are hidden tabs — just show activity instead
        const actBtn = document.getElementById('tabBtn-activity');
        const actContent = document.getElementById('crm-activity');
        if (actBtn) actBtn.classList.add('active');
        if (actContent) actContent.classList.add('active');
        if (typeof renderFamilyActivityTab === 'function') renderFamilyActivityTab();
    }
};

function _initMilestonesTab() {
    // הצג תאריך עברי של היום
    if (window.HebrewDate) {
        const today = HebrewDate.todayHebrew();
        const el = document.getElementById('ms-today-display');
        if (el) el.textContent = today.display;
    }
    // אתחל dropdowns — קודם שנה, אחר כך חודשים, אחר כך ימים
    _populateHebYearSelect();
    _populateHebMonthSelect();
    _populateHebDaySelect();
    // אפס טופס
    document.getElementById('ms-new-label').value = '';
    document.getElementById('ms-new-greg-date').value = '';
    document.getElementById('ms-greg-preview').style.display = 'none';
    document.getElementById('ms-heb-preview-text').textContent = 'בחר יום וחודש';
    setMsInputMode('greg');
}

// ── מילוי dropdown ימים (א–ל) ──
function _populateHebDaySelect(monthName, year) {
    const sel = document.getElementById('ms-new-heb-day');
    if (!sel) return;

    // חשב כמה ימים יש בחודש הנבחר בשנה הנבחרת
    let maxDays = 30;
    if (monthName && year && window.jewishDate) {
        try {
            maxDays = jewishDate.calcDaysInMonth(parseInt(year), monthName) || 30;
        } catch(e) { maxDays = 30; }
    }

    const currentVal = sel.value;
    sel.innerHTML = '<option value="">יום</option>';
    for (let d = 1; d <= maxDays; d++) {
        let hebLetter = d.toString();
        try { hebLetter = jewishDate.convertNumberToHebrew(d, false, false) || d.toString(); } catch(e) {}
        sel.innerHTML += `<option value="${d}">${hebLetter}</option>`;
    }

    // שחזר ערך אם עדיין תקין
    if (currentVal && parseInt(currentVal) <= maxDays) sel.value = currentVal;
    sel.onchange = _updateHebPreview;
}

// ── מילוי dropdown חודשים — תלוי בשנה (מעוברת/רגילה) ──
function _populateHebMonthSelect(year) {
    const sel = document.getElementById('ms-new-heb-month');
    if (!sel) return;
    if (!window.HebrewDate || !window.jewishDate) return;

    const currentVal = sel.value;
    const isLeap = year ? jewishDate.isLeapYear(parseInt(year)) : false;

    sel.innerHTML = '<option value="">חודש</option>';
    HebrewDate.MONTHS_FOR_UI.forEach(m => {
        // בשנה רגילה — הסתר אדר א' ואדר ב' (רק אדר)
        // בשנה מעוברת — הסתר אדר (רק אדר א' ואדר ב')
        if (!isLeap && (m.en === 'AdarI' || m.en === 'AdarII')) return;
        if (isLeap && m.en === 'Adar') return;
        sel.innerHTML += `<option value="${m.en}">${m.he}</option>`;
    });

    // שחזר ערך אם עדיין קיים
    if (currentVal) {
        const exists = [...sel.options].some(o => o.value === currentVal);
        if (exists) sel.value = currentVal;
    }

    sel.onchange = function() {
        const yr = document.getElementById('ms-new-heb-year')?.value;
        _populateHebDaySelect(this.value, yr);
        _updateHebPreview();
    };
}

// ── מילוי dropdown שנות עברי — 10 שנים אחורה + 20 קדימה ──
function _populateHebYearSelect() {
    const sel = document.getElementById('ms-new-heb-year');
    if (!sel || sel.options.length > 1) return;
    if (!window.jewishDate) return;

    const currentYear = jewishDate.toJewishDate(new Date()).year;
    sel.innerHTML = '<option value="">שנה</option>';

    for (let y = currentYear - 10; y <= currentYear + 20; y++) {
        const isLeap = jewishDate.isLeapYear(y);
        // המר לגימטריה קצרה
        let hebYear = y.toString();
        try { hebYear = jewishDate.convertYearToShortHebrew(y); } catch(e) {}
        const label = `${hebYear}${isLeap ? ' (מעוברת)' : ''}`;
        const opt = `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${label}</option>`;
        sel.innerHTML += opt;
    }

    // טען חודשים לפי שנה ברירת מחדל
    _populateHebMonthSelect(currentYear);
    _populateHebDaySelect('', currentYear);
}

// ── כשמשנים שנה — רענן חודשים וימים ──
window.onMsHebYearChange = function() {
    const year = document.getElementById('ms-new-heb-year')?.value;
    const month = document.getElementById('ms-new-heb-month')?.value;
    _populateHebMonthSelect(year);
    _populateHebDaySelect(month, year);
    _updateHebPreview();
};

// ── עדכון preview ──
function _updateHebPreview() {
    if (!window.HebrewDate) return;
    const day       = parseInt(document.getElementById('ms-new-heb-day')?.value);
    const monthName = document.getElementById('ms-new-heb-month')?.value;
    const year      = parseInt(document.getElementById('ms-new-heb-year')?.value);
    const el        = document.getElementById('ms-heb-preview-text');
    if (!el) return;
    if (!day || !monthName) { el.textContent = 'בחר שנה, חודש ויום'; return; }

    const monthHe = HebrewDate.MONTH_HE[monthName] || monthName;
    let hebDay = day.toString();
    try { hebDay = jewishDate.convertNumberToHebrew(day, false, false) || day.toString(); } catch(e) {}

    if (year) {
        // הצג תאריך לועזי מדויק לשנה הספציפית
        try {
            const greg = new Date(jewishDate.toGregorianDate({ year, monthName, day }));
            const gregStr = greg.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });
            el.textContent = `${hebDay} ${monthHe} — ${gregStr}`;
            return;
        } catch(e) {}
    }

    // fallback — הפעם הבאה
    const next = HebrewDate.nextOccurrence(monthName, day);
    const greg = next.gregDate.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });
    el.textContent = `${hebDay} ${monthHe} — בפעם הבאה: ${greg} (עוד ${next.daysUntil} ימים)`;
}

// ── שינוי מצב קלט: לועזי / עברי ──
window.setMsInputMode = function(mode) {
    _msInputMode = mode;
    document.getElementById('ms-greg-input').style.display = mode === 'greg' ? 'block' : 'none';
    document.getElementById('ms-heb-input').style.display  = mode === 'heb'  ? 'block' : 'none';
    const btnGreg = document.getElementById('ms-mode-greg');
    const btnHeb  = document.getElementById('ms-mode-heb');
    btnGreg.style.background    = mode === 'greg' ? 'var(--accent)' : 'var(--surface)';
    btnGreg.style.color         = mode === 'greg' ? 'white' : 'var(--text-muted)';
    btnGreg.style.borderColor   = mode === 'greg' ? 'var(--accent)' : 'var(--border-light)';
    btnHeb.style.background     = mode === 'heb'  ? 'var(--accent)' : 'var(--surface)';
    btnHeb.style.color          = mode === 'heb'  ? 'white' : 'var(--text-muted)';
    btnHeb.style.borderColor    = mode === 'heb'  ? 'var(--accent)' : 'var(--border-light)';
};

// ── כשבוחרים תאריך לועזי — הצג המרה לעברי ──
window.onMsGregDateChange = function() {
    if (!window.HebrewDate) return;
    const val = document.getElementById('ms-new-greg-date').value;
    const preview = document.getElementById('ms-greg-preview');
    const previewText = document.getElementById('ms-greg-preview-text');
    if (!val) { preview.style.display = 'none'; return; }
    const hDate = HebrewDate.fromGregorian(new Date(val + 'T12:00:00'));
    previewText.textContent = `${hDate.display} (${hDate.short})`;
    preview.style.display = 'block';
};

// ── כשמשנים סוג אירוע — placeholder חכם ──
window.onMsTypeChange = function() {
    const type = document.getElementById('ms-new-type').value;
    const placeholders = {
        birthday:    'לדוגמה: יום הולדת אבא, יום הולדת דוד...',
        yahrzeit:    'לדוגמה: יארצייט סבא, יארצייט אמא ז״ל...',
        anniversary: 'לדוגמה: יום נישואין',
        bar_mitzva:  'לדוגמה: בר מצווה של יוסי',
        bat_mitzva:  'לדוגמה: בת מצווה של שרה',
        wedding:     'לדוגמה: חתונת הבן',
        other:       'תאר את האירוע...',
    };
    document.getElementById('ms-new-label').placeholder = placeholders[type] || 'מה זה?';
};

// ── הוספת ציון דרך חדש ──
window.addMilestone = function() {
    if (!window.HebrewDate) { showToast('מנוע תאריכים לא נטען', 'error'); return; }

    const type  = document.getElementById('ms-new-type').value;
    const label = document.getElementById('ms-new-label').value.trim();
    if (!label) { showToast('יש להזין תיאור לאירוע', 'warning'); return; }

    let monthName, day, gregDateStr;

    if (_msInputMode === 'greg') {
        const gregVal = document.getElementById('ms-new-greg-date').value;
        if (!gregVal) { showToast('יש לבחור תאריך', 'warning'); return; }
        const hDate = HebrewDate.fromGregorian(new Date(gregVal + 'T12:00:00'));
        monthName   = hDate.monthName;
        day         = hDate.day;
        gregDateStr = gregVal;
    } else {
        day       = parseInt(document.getElementById('ms-new-heb-day').value);
        monthName = document.getElementById('ms-new-heb-month').value;
        const yr  = parseInt(document.getElementById('ms-new-heb-year')?.value);
        if (!day || !monthName) { showToast('יש לבחור יום וחודש עבריים', 'warning'); return; }
        // שמור גם את התאריך הלועזי המדויק אם יש שנה
        if (yr && window.jewishDate) {
            try {
                const greg = new Date(jewishDate.toGregorianDate({ year: yr, monthName, day }));
                gregDateStr = greg.toISOString().split('T')[0];
            } catch(e) {}
        }
    }

    const ms = {
        id:         Date.now(),
        type,
        label,
        monthName,
        day,
        gregDate:   gregDateStr || null,
        createdAt:  new Date().toISOString(),
    };

    tempMilestones.push(ms);
    markDirty();
    renderMilestones();

    // אפס טופס
    document.getElementById('ms-new-label').value = '';
    document.getElementById('ms-new-greg-date').value = '';
    document.getElementById('ms-greg-preview').style.display = 'none';
    document.getElementById('ms-new-heb-day').value = '';
    document.getElementById('ms-new-heb-month').value = '';
    document.getElementById('ms-heb-preview-text').textContent = 'בחר שנה, חודש ויום';

    showToast('ציון דרך נוסף ✓', 'success');
};

// ── מחיקת ציון דרך ──
window.deleteMilestone = function(id) {
    tempMilestones = tempMilestones.filter(m => m.id !== id);
    markDirty();
    renderMilestones();
};

// ── רינדור רשימת ציוני הדרך ──
window.renderMilestones = function() {
    const container = document.getElementById('ms-list');
    if (!container) return;

    if (!tempMilestones.length) {
        container.innerHTML = `
            <div style="text-align:center; padding:24px; color:var(--text-muted); font-size:14px;">
                <i class="fas fa-star-of-david" style="font-size:28px; margin-bottom:10px; opacity:0.3; display:block;"></i>
                אין ציוני דרך עדיין<br>
                <span style="font-size:12px;">הוסף יארצייט, יום הולדת, בר מצווה ועוד</span>
            </div>`;
        return;
    }

    // מיין לפי קרבה
    let items = [...tempMilestones];
    if (window.HebrewDate) {
        items = items.map(ms => {
            try {
                const occ = HebrewDate.nextOccurrence(ms.monthName, ms.day);
                return { ...ms, _daysUntil: occ.daysUntil, _nextGreg: occ.gregDate };
            } catch(e) {
                return { ...ms, _daysUntil: 9999, _nextGreg: null };
            }
        }).sort((a, b) => a._daysUntil - b._daysUntil);
    }

    const TYPE_ICONS = {
        birthday:    { icon: 'fa-birthday-cake', color: '#f59e0b' },
        yahrzeit:    { icon: 'fa-candle',         color: '#64748b' },
        anniversary: { icon: 'fa-heart',           color: '#ec4899' },
        bar_mitzva:  { icon: 'fa-star-of-david',  color: '#8b5cf6' },
        bat_mitzva:  { icon: 'fa-star-of-david',  color: '#8b5cf6' },
        wedding:     { icon: 'fa-ring',            color: '#ec4899' },
        other:       { icon: 'fa-calendar-alt',    color: '#3b82f6' },
    };

    container.innerHTML = items.map(ms => {
        const typeDef = TYPE_ICONS[ms.type] || TYPE_ICONS.other;
        const monthHe = window.HebrewDate ? (HebrewDate.MONTH_HE[ms.monthName] || ms.monthName) : ms.monthName;
        const dateStr = `${ms.day} ${monthHe}`;

        let urgencyBadge = '';
        let nextLine = '';
        if (ms._daysUntil !== undefined && ms._daysUntil !== 9999 && window.HebrewDate) {
            urgencyBadge = HebrewDate.formatDaysUntil(ms._daysUntil);
            if (ms._nextGreg) {
                const greg = ms._nextGreg.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });
                nextLine = `<div style="font-size:11px; color:var(--text-muted); margin-top:3px;">
                    <i class="fas fa-calendar-check"></i> בפעם הבאה: ${greg}
                </div>`;
            }
        }

        // צבע רקע לפי דחיפות
        let urgencyBg = 'var(--surface)';
        let urgencyBorder = 'var(--border-light)';
        if (ms._daysUntil <= 7)  { urgencyBg = 'rgba(239,68,68,0.05)';  urgencyBorder = 'rgba(239,68,68,0.3)'; }
        else if (ms._daysUntil <= 30) { urgencyBg = 'rgba(245,158,11,0.05)'; urgencyBorder = 'rgba(245,158,11,0.3)'; }

        return `
        <div style="background:${urgencyBg}; border:1px solid ${urgencyBorder};
                    border-radius:12px; padding:12px 14px;
                    display:flex; align-items:center; gap:12px;">
            <div style="width:38px; height:38px; border-radius:50%;
                        background:${typeDef.color}22; display:flex; align-items:center;
                        justify-content:center; flex-shrink:0;">
                <i class="fas ${typeDef.icon}" style="color:${typeDef.color}; font-size:16px;"></i>
            </div>
            <div style="flex:1; min-width:0;">
                <div style="font-weight:700; font-size:14px; color:var(--text-main);">${escapeHTML(ms.label)}</div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                    <i class="fas fa-star-of-david" style="font-size:10px;"></i> ${dateStr}
                    ${urgencyBadge ? `&nbsp;·&nbsp; ${urgencyBadge}` : ''}
                </div>
                ${nextLine}
            </div>
            <button onclick="deleteMilestone(${ms.id})"
                style="background:none; border:none; color:var(--danger);
                       cursor:pointer; padding:4px 8px; border-radius:6px; font-size:14px;
                       opacity:0.6;" title="מחק">
                <i class="fas fa-trash"></i>
            </button>
        </div>`;
    }).join('');
};

// ════════════════════════════════════════════════════════════
// ██  KPI — התראות אירועים קרובים בסיידבר  ██
// ════════════════════════════════════════════════════════════

function checkUpcomingMilestonesAlerts() {
    if (!window.HebrewDate) return;

    // אסוף את כל המשפחות עם milestones
    const families = [];
    Object.entries(db).forEach(([bldg, bldgData]) => {
        if (!bldgData || !bldgData.apts) return;
        bldgData.apts.forEach(apt => {
            if ((apt.milestones || []).length > 0) {
                families.push({ bldg, apt });
            }
        });
    });

    const upcoming = HebrewDate.getUpcomingEvents(families, 14);
    if (!upcoming.length) return;

    // הצג badge ב-KPI alerts
    const alertsEl = document.getElementById('kpiAlerts');
    if (!alertsEl) return;

    const existingMs = alertsEl.querySelector('.ms-upcoming-card');
    if (existingMs) existingMs.remove();

    const card = document.createElement('div');
    card.className = 'ms-upcoming-card stat-card';
    card.style.cssText = 'margin-bottom:8px; padding:10px 12px; border:1px solid rgba(245,158,11,0.3); background:rgba(245,158,11,0.05);';

    const rows = upcoming.slice(0, 4).map(ev => {
        const days = HebrewDate.formatDaysUntil(ev.daysUntil);
        return `<div style="display:flex; justify-content:space-between; align-items:center;
                             padding:4px 0; border-bottom:1px solid var(--border-light); font-size:12px;">
            <span style="color:var(--text-main);">${escapeHTML(ev.label)} — ${escapeHTML(ev.aptName)}</span>
            <span style="white-space:nowrap;">${days}</span>
        </div>`;
    }).join('');

    card.innerHTML = `
        <div style="font-size:12px; font-weight:700; color:var(--warning); margin-bottom:6px;">
            <i class="fas fa-bell"></i> אירועים קרובים (14 יום)
        </div>
        ${rows}`;

    alertsEl.prepend(card);

    // בדוק אם צריך ליצור משימות אוטומטיות
    const alertsToday = HebrewDate.getAlertsDueToday(families);
    alertsToday.forEach(ev => {
        const taskText = `${ev.label} — ${ev.aptName} (${HebrewDate.formatDaysUntil(ev.daysUntil)})`;
        if (!db.meta) db.meta = {};
        if (!db.meta.generalTasks) db.meta.generalTasks = [];
        // בדוק שאין כבר משימה כזו
        const exists = db.meta.generalTasks.some(t => t.text === taskText && !t.done);
        if (!exists) {
            db.meta.generalTasks.push({
                text: taskText,
                date: new Date().toLocaleDateString('he-IL'),
                done: false,
                autoCreated: true,
            });
            showToast(`נוצרה משימה אוטומטית: ${ev.label}`, 'info');
        }
    });

    if (alertsToday.length > 0) saveDB();
}

// הפעל בדיקה אחרי טעינת נתונים
setTimeout(() => {
    if (window.db && window.HebrewDate) checkUpcomingMilestonesAlerts();
}, 3000);


// ════════════════════════════════════════════════════════════
// ██  מודול סטטוס משפחה — נפטר/ת + פיצול  ██
// ════════════════════════════════════════════════════════════

// ── טעינת סטטוס בפתיחת כרטיס ──
function _loadFamilyStatus() {
    const a = db[currentBldg]?.apts[currentAptIdx];
    if (!a) return;

    const badge  = document.getElementById('family-status-badge');
    const btnDec = document.getElementById('btn-deceased');
    const btnRes = document.getElementById('btn-restore-active');

    if (!badge) return;

    if (a.lifeStatus === 'deceased') {
        const who = a.deceasedInfo?.who;
        const whoLabel = who === 'father' ? 'האב נפטר' : who === 'mother' ? 'האם נפטרה' : 'שניהם נפטרו';
        const dateLabel = a.deceasedInfo?.date
            ? new Date(a.deceasedInfo.date).toLocaleDateString('he-IL') : '';
        badge.innerHTML = `<span style="background:rgba(100,116,139,0.15); color:#64748b;
            font-size:11px; font-weight:700; padding:3px 10px; border-radius:20px;">
            🕯️ ${whoLabel}${dateLabel ? ' — ' + dateLabel : ''}</span>`;
        if (btnDec) btnDec.style.display = 'none';
        if (btnRes) btnRes.style.display = 'flex';
    } else if (a.lifeStatus === 'split') {
        badge.innerHTML = `<span style="background:rgba(124,58,237,0.1); color:#7c3aed;
            font-size:11px; font-weight:700; padding:3px 10px; border-radius:20px;">
            🔀 פוצל מ-${a.splitInfo?.originalName || ''}</span>`;
        if (btnDec) btnDec.style.display = 'flex';
        if (btnRes) btnRes.style.display = 'flex';
    } else {
        badge.innerHTML = '';
        if (btnDec) btnDec.style.display = 'flex';
        if (btnRes) btnRes.style.display = 'none';
    }
}

// קרא אחרי openClientCard — הוסף לסוף הפונקציה הקיימת
const _origOpenClientCard = window.openClientCard;
window.openClientCard = function(idx) {
    _origOpenClientCard(idx);
    _loadFamilyStatus();
};

// ══════════════════════════════════════════════
//  סימון נפטר/ת
// ══════════════════════════════════════════════

window.openDeceasedDialog = function() {
    const a = db[currentBldg]?.apts[currentAptIdx];
    if (!a) return;

    // עדכן subtitle
    document.getElementById('deceased-subtitle').textContent =
        `משפחת ${a.name || ''}`;

    // ברירת מחדל לתאריך — היום
    document.getElementById('deceased-date').value =
        new Date().toISOString().split('T')[0];
    onDeceasedDateChange();

    document.getElementById('deceasedModal').style.display = 'flex';
};

window.onDeceasedDateChange = function() {
    const val = document.getElementById('deceased-date').value;
    const preview = document.getElementById('deceased-heb-preview');
    const text    = document.getElementById('deceased-heb-text');
    const offer   = document.getElementById('deceased-yahrzeit-offer');
    const yzPreview = document.getElementById('deceased-yahrzeit-preview');

    if (!val || !window.HebrewDate) { preview.style.display = 'none'; offer.style.display = 'none'; return; }

    const hDate = HebrewDate.fromGregorian(new Date(val + 'T12:00:00'));
    text.textContent = hDate.display;
    preview.style.display = 'block';

    // הצג הצעת יארצייט
    offer.style.display = 'block';
    const next = HebrewDate.nextOccurrence(hDate.monthName, hDate.day);
    const nextGreg = next.gregDate.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });
    yzPreview.textContent = `יארצייט: ${hDate.short} — בפעם הבאה: ${nextGreg}`;
};

window.onDeceasedWhoChange = function() {
    // עתיד: אפשר להתאים placeholder לפי הבחירה
};

window.confirmDeceased = function() {
    const a = db[currentBldg]?.apts[currentAptIdx];
    if (!a) return;

    const who  = document.getElementById('deceased-who').value;
    const date = document.getElementById('deceased-date').value;
    const addYahrzeit = document.getElementById('deceased-add-yahrzeit').checked;

    // שמור סטטוס
    a.lifeStatus = 'deceased';
    a.deceasedInfo = { who, date, recordedAt: new Date().toISOString() };

    // הוסף יארצייט אוטומטי
    if (addYahrzeit && date && window.HebrewDate) {
        const hDate = HebrewDate.fromGregorian(new Date(date + 'T12:00:00'));
        const whoLabel = who === 'father' ? 'האב' : who === 'mother' ? 'האם' : 'ע"ה';
        if (!a.milestones) a.milestones = [];
        a.milestones.push({
            id:        Date.now(),
            type:      'yahrzeit',
            label:     `יארצייט ${whoLabel} — ${a.name || ''}`,
            monthName: hDate.monthName,
            day:       hDate.day,
            gregDate:  date,
            autoCreated: true,
            createdAt: new Date().toISOString(),
        });
        // עדכן גם tempMilestones אם הכרטיס עדיין פתוח
        tempMilestones = [...(a.milestones)];
    }

    a.updatedAt = Date.now();
    saveDB();
    document.getElementById('deceasedModal').style.display = 'none';
    _loadFamilyStatus();

    const whoLabel = who === 'father' ? 'האב' : who === 'mother' ? 'האם' : 'שניהם';
    showToast(`${whoLabel} סומן/ה כנפטר/ה${addYahrzeit ? ' · יארצייט נוסף' : ''}`, 'info');
};

// ── שחזור לסטטוס פעיל ──
window.restoreActiveStatus = async function() {
    const confirmed = await showCustomDialog({
        title: 'שחזור לפעיל',
        message: 'האם לשחזר את המשפחה לסטטוס פעיל?',
        showCancel: true,
    });
    if (!confirmed) return;

    const a = db[currentBldg]?.apts[currentAptIdx];
    if (!a) return;
    delete a.lifeStatus;
    delete a.deceasedInfo;
    a.updatedAt = Date.now();
    saveDB();
    _loadFamilyStatus();
    showToast('הכרטיס שוחזר לסטטוס פעיל', 'success');
};

// ══════════════════════════════════════════════
//  פיצול משפחה
// ══════════════════════════════════════════════

window.openSplitFamilyDialog = function() {
    const a = db[currentBldg]?.apts[currentAptIdx];
    if (!a) return;

    // הצע שם ברירת מחדל
    document.getElementById('split-new-name').value = `${a.name || ''} (חדש)`;

    // בנה רשימת ילדים לבחירה
    const list = document.getElementById('split-children-list');
    const children = a.childrenList || [];

    if (children.length === 0) {
        list.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">אין ילדים רשומים בכרטיס זה</div>';
    } else {
        list.innerHTML = children.map((c, i) => `
            <label style="display:flex; align-items:center; gap:8px; padding:8px 10px;
                          background:var(--bg-body); border-radius:8px; cursor:pointer; font-size:13px;">
                <input type="checkbox" class="split-child-cb" data-idx="${i}"
                       style="width:16px; height:16px; accent-color:var(--accent);">
                <span>${escapeHTML(c.name || 'ילד/ה ללא שם')}</span>
                ${c.dob ? `<span style="font-size:11px; color:var(--text-muted);">
                    (${new Date(c.dob).toLocaleDateString('he-IL')})</span>` : ''}
            </label>`
        ).join('');
    }

    document.getElementById('splitFamilyModal').style.display = 'flex';
};

window.confirmSplitFamily = async function() {
    const a = db[currentBldg]?.apts[currentAptIdx];
    if (!a) return;

    const newName = document.getElementById('split-new-name').value.trim();
    if (!newName) { showToast('יש להזין שם לכרטיס החדש', 'warning'); return; }

    const reason        = document.getElementById('split-reason').value;
    const copyHistory   = document.getElementById('split-copy-history').checked;
    const copyTags      = document.getElementById('split-copy-tags').checked;
    const copyMilestones= document.getElementById('split-copy-milestones').checked;

    // אילו ילדים עוברים
    const selectedChildIdxs = [...document.querySelectorAll('.split-child-cb:checked')]
        .map(cb => parseInt(cb.dataset.idx));

    // בנה כרטיס חדש — עותק עמוק
    const newApt = {
        num:         '',
        name:        newName,
        father:      reason === 'divorce' ? a.father  : '',
        mother:      reason === 'divorce' ? a.mother  : '',
        fatherPhone: reason === 'divorce' ? a.fatherPhone : '',
        motherPhone: reason === 'divorce' ? a.motherPhone : '',
        fatherEmail: reason === 'divorce' ? a.fatherEmail : '',
        motherEmail: reason === 'divorce' ? a.motherEmail : '',
        style:       copyTags ? a.style : (appSettings.styles[0] || ''),
        tags:        copyTags ? [...(a.tags || [])] : [],
        notes:       '',
        boards:      {},
        tasks:       [],
        donations:   [],
        customData:  {},
        customFields:{},
        // היסטוריה — העתק עם סימון "לפני פיצול"
        interactions: copyHistory
            ? (a.interactions || []).map(l => ({ ...l, note: `[לפני פיצול] ${l.note || ''}`.trim() }))
            : [],
        milestones: copyMilestones
            ? JSON.parse(JSON.stringify(a.milestones || []))
            : [],
        childrenList: selectedChildIdxs.map(i => ({ ...a.childrenList[i] })),
        lifeStatus:  'split',
        splitInfo: {
            reason,
            originalName:  a.name || '',
            originalBldg:  currentBldg,
            splitAt:       new Date().toISOString(),
        },
        createdAt:   new Date().toISOString(),
        updatedAt:   Date.now(),
    };

    // הוסף לאותו בניין
    db[currentBldg].apts.push(newApt);

    // סמן גם את הכרטיס המקורי
    a.splitInfo = {
        reason,
        splitAt:   new Date().toISOString(),
        newCardName: newName,
    };
    a.updatedAt = Date.now();

    // הסר ילדים שעברו מהכרטיס המקורי
    if (selectedChildIdxs.length > 0) {
        a.childrenList = (a.childrenList || []).filter((_, i) => !selectedChildIdxs.includes(i));
        tempChildren = [...a.childrenList];
        renderModalChildren();
    }

    saveDB();
    document.getElementById('splitFamilyModal').style.display = 'none';
    _loadFamilyStatus();

    showToast(`כרטיס חדש נוצר: "${newName}" — נמצא באותו בניין`, 'success');

    // שאל אם לפתוח את הכרטיס החדש
    const openNew = await showCustomDialog({
        title: 'כרטיס נוצר!',
        message: `האם לפתוח כעת את הכרטיס החדש של "${newName}"?`,
        showCancel: true,
    });
    if (openNew) {
        const newIdx = db[currentBldg].apts.length - 1;
        openClientCard(newIdx);
    }
};


// ════════════════════════════════════════════════════════════
// ██  לשונית אירועים ראשית — Events View  ██
// ════════════════════════════════════════════════════════════

// ── הרחב את switchMainView — מנתב events לתת-תצוגה בפעילות ──
const _origSwitchMainViewEvents = window.switchMainView;
window.switchMainView = function(viewName) {
    if (viewName === 'events') {
        // Route through activity hub
        _origSwitchMainViewEvents('activity');
        if (typeof switchActivitySub === 'function') {
            switchActivitySub('events');
        } else {
            // Fallback if activity-hub not loaded yet
            const evCont = document.getElementById('events-container');
            if (evCont) evCont.style.display = 'flex';
            _initEventsView();
            renderEventsView();
        }
        return;
    }
    _origSwitchMainViewEvents(viewName);
};

// ── אתחול חד-פעמי ──
function _initEventsView() {
    if (!window.HebrewDate) return;
    const todayEl = document.getElementById('events-today-heb');
    if (todayEl && !todayEl.textContent) {
        todayEl.textContent = HebrewDate.todayHebrew().display;
    }
}

// ── אסוף את כל המשפחות עם milestones מה-DB ──
function _getAllFamiliesWithMilestones() {
    const families = [];
    Object.entries(db).forEach(([bldg, bldgData]) => {
        if (!bldgData || !bldgData.apts) return;
        bldgData.apts.forEach((apt, aptIdx) => {
            if ((apt.milestones || []).length > 0) {
                families.push({ bldg, aptIdx, apt });
            }
        });
    });
    return families;
}

// ── רינדור ראשי ──
window.renderEventsView = function() {
    if (!window.HebrewDate) {
        document.getElementById('events-timeline').innerHTML =
            '<div style="text-align:center;color:var(--text-muted);padding:40px;">מנוע תאריכים לא נטען</div>';
        return;
    }

    const days       = parseInt(document.getElementById('events-window')?.value || 30);
    const typeFilter = document.getElementById('events-type-filter')?.value || '';
    const families   = _getAllFamiliesWithMilestones();
    let   events     = HebrewDate.getUpcomingEvents(families, days);

    // סנן לפי סוג
    if (typeFilter) events = events.filter(ev => ev.type === typeFilter);

    // KPI
    _renderEventsKPI(events, days);

    // ריק?
    const timeline = document.getElementById('events-timeline');
    const empty    = document.getElementById('events-empty');
    if (!events.length) {
        timeline.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    // קבץ לפי יום
    _renderEventsTimeline(events);
};

// ── KPI בראש ──
function _renderEventsKPI(events, days) {
    const kpiEl = document.getElementById('events-kpi-row');
    if (!kpiEl) return;

    const total    = events.length;
    const today    = events.filter(e => e.daysUntil === 0).length;
    const week     = events.filter(e => e.daysUntil <= 7).length;
    const yahrzeit = events.filter(e => e.type === 'yahrzeit').length;

    const kpis = [
        { label: `ב-${days} ימים הקרובים`, value: total,    color: 'var(--accent)',   icon: 'fa-calendar-alt' },
        { label: 'היום',                   value: today,    color: 'var(--danger)',   icon: 'fa-exclamation-circle' },
        { label: 'השבוע',                  value: week,     color: 'var(--warning)',  icon: 'fa-clock' },
        { label: 'יארצייטים',              value: yahrzeit, color: '#64748b',         icon: 'fa-candle' },
    ];

    kpiEl.innerHTML = kpis.map(k => `
        <div style="background:var(--surface); border:1px solid var(--border-light);
                    border-radius:14px; padding:14px 16px; text-align:center;
                    box-shadow:var(--card-shadow);">
            <i class="fas ${k.icon}" style="color:${k.color}; font-size:18px; margin-bottom:6px; display:block;"></i>
            <div style="font-size:28px; font-weight:900; color:${k.color}; line-height:1;">${k.value}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${k.label}</div>
        </div>`
    ).join('');
}

// ── ציר זמן מקובץ לפי יום ──
function _renderEventsTimeline(events) {
    const timeline = document.getElementById('events-timeline');

    // קבץ לפי daysUntil
    const groups = {};
    events.forEach(ev => {
        const key = ev.daysUntil;
        if (!groups[key]) groups[key] = [];
        groups[key].push(ev);
    });

    const TYPE_META = {
        birthday:    { icon: 'fa-birthday-cake', color: '#f59e0b', label: 'יום הולדת' },
        yahrzeit:    { icon: 'fa-candle',         color: '#64748b', label: 'יארצייט'   },
        anniversary: { icon: 'fa-heart',           color: '#ec4899', label: 'יום נישואין' },
        bar_mitzva:  { icon: 'fa-star-of-david',  color: '#8b5cf6', label: 'בר מצווה'  },
        bat_mitzva:  { icon: 'fa-star-of-david',  color: '#8b5cf6', label: 'בת מצווה'  },
        wedding:     { icon: 'fa-ring',            color: '#ec4899', label: 'חתונה'     },
        other:       { icon: 'fa-calendar-alt',    color: '#3b82f6', label: 'אחר'       },
    };

    timeline.innerHTML = Object.keys(groups)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(daysKey => {
            const daysNum = parseInt(daysKey);
            const evs     = groups[daysKey];

            // כותרת יום
            let dayLabel, dayBg, dayColor;
            if (daysNum === 0) {
                dayLabel = '🔴 היום!'; dayBg = 'rgba(239,68,68,0.08)'; dayColor = 'var(--danger)';
            } else if (daysNum === 1) {
                dayLabel = '🟠 מחר'; dayBg = 'rgba(234,88,12,0.08)'; dayColor = '#ea580c';
            } else if (daysNum <= 7) {
                dayLabel = `🟡 עוד ${daysNum} ימים`; dayBg = 'rgba(245,158,11,0.06)'; dayColor = 'var(--warning)';
            } else {
                dayLabel = `עוד ${daysNum} ימים`; dayBg = 'var(--surface)'; dayColor = 'var(--text-muted)';
            }

            // תאריך לועזי + עברי של הפעם הבאה
            const gregStr = evs[0]._nextGreg
                ? evs[0]._nextGreg.toLocaleDateString('he-IL', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
                : '';

            const rows = evs.map(ev => {
                const meta = TYPE_META[ev.type] || TYPE_META.other;
                const monthHe = window.HebrewDate
                    ? (HebrewDate.MONTH_HE[ev.ms.monthName] || ev.ms.monthName) : ev.ms.monthName;
                const hebDate = `${ev.ms.day} ${monthHe}`;

                return `
                <div style="display:flex; align-items:center; gap:12px; padding:10px 14px;
                            background:var(--bg-body); border-radius:10px; cursor:pointer;"
                     onclick="openClientCardFromEvent('${encodeURIComponent(ev.bldg)}', ${ev.aptIdx})">
                    <div style="width:36px; height:36px; border-radius:50%; flex-shrink:0;
                                background:${meta.color}18; display:flex; align-items:center; justify-content:center;">
                        <i class="fas ${meta.icon}" style="color:${meta.color}; font-size:15px;"></i>
                    </div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:700; font-size:14px; color:var(--text-main);">
                            ${escapeHTML(ev.label)}
                        </div>
                        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                            משפחת ${escapeHTML(ev.aptName)}
                            &nbsp;·&nbsp;
                            <i class="fas fa-star-of-david" style="font-size:9px;"></i> ${hebDate}
                        </div>
                    </div>
                    <div style="display:flex; gap:6px; flex-shrink:0;">
                        <!-- שלח וואטסאפ -->
                        <button onclick="event.stopPropagation(); sendEventWhatsApp('${encodeURIComponent(ev.bldg)}', ${ev.aptIdx}, '${encodeURIComponent(ev.label)}')"
                            style="padding:5px 10px; border-radius:8px; border:none; background:rgba(37,211,102,0.12);
                                   color:#25D366; cursor:pointer; font-size:12px;" title="שלח וואטסאפ">
                            <i class="fab fa-whatsapp"></i>
                        </button>
                        <!-- הוסף משימה -->
                        <button onclick="event.stopPropagation(); addTaskFromEvent('${encodeURIComponent(ev.bldg)}', ${ev.aptIdx}, '${encodeURIComponent(ev.label)}', ${daysNum})"
                            style="padding:5px 10px; border-radius:8px; border:none; background:rgba(59,130,246,0.1);
                                   color:var(--accent); cursor:pointer; font-size:12px;" title="הוסף משימה">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                </div>`;
            }).join('');

            return `
            <div style="background:${dayBg}; border:1px solid ${daysNum <= 1 ? dayColor + '40' : 'var(--border-light)'};
                        border-radius:14px; overflow:hidden;">
                <!-- כותרת קבוצה -->
                <div style="padding:10px 16px; display:flex; justify-content:space-between; align-items:center;
                            border-bottom:1px solid var(--border-light);">
                    <span style="font-weight:800; font-size:14px; color:${dayColor};">${dayLabel}</span>
                    <span style="font-size:12px; color:var(--text-muted);">${gregStr}</span>
                </div>
                <!-- שורות אירועים -->
                <div style="padding:8px; display:flex; flex-direction:column; gap:6px;">
                    ${rows}
                </div>
            </div>`;
        }).join('');
}

// ── פתח כרטיס משפחה מלחיצה באירועים ──
window.openClientCardFromEvent = function(bldgEnc, aptIdx) {
    const bldg = decodeURIComponent(bldgEnc);
    currentBldg = bldg;
    openClientCard(aptIdx);
    // עבור לציוני דרך
    setTimeout(() => switchCrmTab('milestones'), 100);
};

// ── שלח וואטסאפ עם הודעה מותאמת ──
window.sendEventWhatsApp = function(bldgEnc, aptIdx, labelEnc) {
    const bldg  = decodeURIComponent(bldgEnc);
    const label = decodeURIComponent(labelEnc);
    const apt   = db[bldg]?.apts[aptIdx];
    if (!apt) return;

    const phones = [apt.fatherPhone, apt.motherPhone].filter(Boolean);
    if (!phones.length) { showToast('אין מספר טלפון לשלוח', 'warning'); return; }

    const name = apt.name || 'משפחה';
    const msg  = encodeURIComponent(`שלום משפחת ${name}! מאחלים לכם ${label} שמח 🎉`);
    const phone = phones[0].replace(/[^0-9]/g, '');
    window.open(`https://wa.me/972${phone.replace(/^0/, '')}?text=${msg}`, '_blank');
};

// ── הוסף משימה מאירוע ──
window.addTaskFromEvent = function(bldgEnc, aptIdx, labelEnc, daysUntil) {
    const bldg  = decodeURIComponent(bldgEnc);
    const label = decodeURIComponent(labelEnc);
    const apt   = db[bldg]?.apts[aptIdx];
    if (!apt) return;

    const taskText = `${label} — משפחת ${apt.name || ''} (עוד ${daysUntil} ימים)`;
    if (!db.meta) db.meta = {};
    if (!db.meta.generalTasks) db.meta.generalTasks = [];

    const exists = db.meta.generalTasks.some(t => t.text === taskText && !t.done);
    if (exists) { showToast('משימה כזו כבר קיימת', 'info'); return; }

    db.meta.generalTasks.push({
        text: taskText,
        date: new Date().toLocaleDateString('he-IL'),
        done: false,
        fromEvent: true,
    });
    saveDB();
    showToast('משימה נוספה ✓', 'success');
};


// ════════════════════════════════════════════════════════════
// ██  מודול White-Label — מיתוג קהילה  ██
// ════════════════════════════════════════════════════════════

const BRANDING_PRESETS = [
    { color: '#3b82f6', label: 'כחול' },
    { color: '#8b5cf6', label: 'סגול' },
    { color: '#059669', label: 'ירוק' },
    { color: '#dc2626', label: 'אדום' },
    { color: '#d97706', label: 'זהב' },
    { color: '#0891b2', label: 'תכלת' },
    { color: '#be185d', label: 'ורוד' },
    { color: '#1e293b', label: 'כהה' },
];

// ── החל מיתוג בטעינה ──
function applyBranding() {
    const b = appSettings.branding || {};

    // שם
    const nameEl = document.getElementById('community-name-display');
    if (nameEl) nameEl.textContent = b.name || 'ניהול קהילה';

    // צבע ראשי — עדכן CSS variable
    if (b.color) {
        document.documentElement.style.setProperty('--accent', b.color);
        // חשב גרסה בהירה לרקע
        document.documentElement.style.setProperty('--accent-light', b.color + '18');
    }

    // לוגו
    const logoImg = document.getElementById('community-logo');
    const logoPlaceholder = document.getElementById('community-logo-placeholder');
    if (b.logoUrl && logoImg) {
        logoImg.src = b.logoUrl;
        logoImg.style.display = 'block';
        if (logoPlaceholder) logoPlaceholder.style.display = 'none';
        // אם הלוגו נכשל — חזור ל-placeholder
        logoImg.onerror = function() {
            this.style.display = 'none';
            if (logoPlaceholder) logoPlaceholder.style.display = 'flex';
        };
    } else {
        if (logoImg) logoImg.style.display = 'none';
        if (logoPlaceholder) logoPlaceholder.style.display = 'flex';
    }

    // עדכן צבע הplaceholder
    if (logoPlaceholder && b.color) {
        logoPlaceholder.style.background = b.color;
    }

    // כותרת הדפדפן
    if (b.name) document.title = b.name;
}

// ── פתח דיאלוג מיתוג ──
window.openBrandingSettings = function() {
    const b = appSettings.branding || {};

    // מלא שדות
    document.getElementById('branding-name').value  = b.name  || '';
    document.getElementById('branding-color').value = b.color || '#3b82f6';
    document.getElementById('branding-logo').value  = b.logoUrl || '';

    // בנה preset buttons
    const presetsEl = document.getElementById('branding-presets');
    presetsEl.innerHTML = BRANDING_PRESETS.map(p => `
        <div onclick="selectBrandingPreset('${p.color}')"
             title="${p.label}"
             style="width:28px; height:28px; border-radius:50%; background:${p.color};
                    cursor:pointer; border:3px solid ${b.color === p.color ? 'var(--text-main)' : 'transparent'};
                    transition:transform 0.15s; flex-shrink:0;"
             onmouseover="this.style.transform='scale(1.15)'"
             onmouseout="this.style.transform='scale(1)'">
        </div>`
    ).join('');

    // עדכן preview
    _updateBrandingPreview();

    // אם יש לוגו — הצג preview
    if (b.logoUrl) {
        document.getElementById('branding-logo-img').src = b.logoUrl;
        document.getElementById('branding-logo-preview').style.display = 'block';
    } else {
        document.getElementById('branding-logo-preview').style.display = 'none';
    }

    // חבר live preview לשדות
    document.getElementById('branding-name').oninput  = _updateBrandingPreview;
    document.getElementById('branding-color').oninput = _updateBrandingPreview;

    document.getElementById('brandingModal').style.display = 'flex';
};

// ── בחירת preset ──
window.selectBrandingPreset = function(color) {
    document.getElementById('branding-color').value = color;
    // עדכן border על הכפתורים
    document.querySelectorAll('#branding-presets div').forEach(el => {
        el.style.borderColor = el.title === BRANDING_PRESETS.find(p => p.color === color)?.label
            ? 'var(--text-main)' : 'transparent';
    });
    _updateBrandingPreview();
};

// ── Preview חי ──
function _updateBrandingPreview() {
    const name  = document.getElementById('branding-name').value  || 'ניהול קהילה';
    const color = document.getElementById('branding-color').value || '#3b82f6';

    document.getElementById('branding-preview-name').textContent = name;
    const previewLogo = document.getElementById('branding-preview-logo');
    if (previewLogo) previewLogo.style.background = color;
}

// ── Preview לוגו ──
window.previewBrandingLogo = function() {
    const url = document.getElementById('branding-logo').value.trim();
    const preview = document.getElementById('branding-logo-preview');
    const img     = document.getElementById('branding-logo-img');
    if (url) {
        img.src = url;
        preview.style.display = 'block';
        img.onerror = () => { preview.style.display = 'none'; };
    } else {
        preview.style.display = 'none';
    }
};

// ── שמור הגדרות ──
window.saveBrandingSettings = function() {
    const name   = document.getElementById('branding-name').value.trim();
    const color  = document.getElementById('branding-color').value;
    const logoUrl = document.getElementById('branding-logo').value.trim();

    if (!appSettings.branding) appSettings.branding = {};
    appSettings.branding.name   = name;
    appSettings.branding.color  = color;
    appSettings.branding.logoUrl = logoUrl;

    // שמור
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    // שמור גם ב-Drive אם מחובר
    if (typeof pushToDrive === 'function') pushToDrive();

    // החל מיד
    applyBranding();

    document.getElementById('brandingModal').style.display = 'none';
    showToast(`✅ מיתוג עודכן${name ? ' — ' + name : ''}`, 'success');
};

// ── הפעל בטעינה ──
setTimeout(applyBranding, 500);


// ════════════════════════════════════════════════════════════
// ██  התראות אוטומטיות בפתיחה — Startup Alerts  ██
// ════════════════════════════════════════════════════════════

function checkStartupAlerts() {
    if (!window.HebrewDate) return;

    // אסוף משפחות עם ציוני דרך
    const families = [];
    Object.entries(db).forEach(([bldg, bldgData]) => {
        if (!bldgData?.apts) return;
        bldgData.apts.forEach((apt, aptIdx) => {
            if ((apt.milestones || []).length > 0) {
                families.push({ bldg, aptIdx, apt });
            }
        });
    });

    if (!families.length) return;

    // קבל אירועים ב-14 יום הקרובים
    const upcoming = HebrewDate.getUpcomingEvents(families, 14);
    if (!upcoming.length) return;

    // צור משימות אוטומטיות אם צריך
    _createAutoTasksFromAlerts(upcoming);

    // קבץ לפי דחיפות
    const today   = upcoming.filter(e => e.daysUntil === 0);
    const week    = upcoming.filter(e => e.daysUntil > 0 && e.daysUntil <= 7);
    const later   = upcoming.filter(e => e.daysUntil > 7);

    // בנה הודעה
    let lines = [];
    if (today.length)  lines.push(`🔴 ${today.length} אירוע${today.length > 1 ? 'ים' : ''} היום`);
    if (week.length)   lines.push(`🟡 ${week.length} אירוע${week.length > 1 ? 'ים' : ''} השבוע`);
    if (later.length)  lines.push(`🔵 ${later.length} נוסף${later.length > 1 ? 'ים' : ''} ב-14 יום`);

    const summary = lines.join(' · ');

    // הצג toast מיוחד עם כפתור
    _showAlertToast(summary, upcoming.length, today.length > 0);
}

// ── Toast מיוחד עם כפתור ניווט ──
function _showAlertToast(summary, total, isUrgent) {
    // בדוק אם כבר הוצג היום
    const todayStr = new Date().toDateString();
    const lastShown = localStorage.getItem('alerts_last_shown');
    if (lastShown === todayStr) return;
    localStorage.setItem('alerts_last_shown', todayStr);

    // צור toast מורחב
    const toast = document.createElement('div');
    toast.id = 'startup-alert-toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: var(--surface);
        border: 1px solid ${isUrgent ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)'};
        border-radius: 16px;
        padding: 16px 20px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        z-index: 99998;
        max-width: 380px;
        width: calc(100% - 40px);
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.34,1.56,0.64,1);
        direction: rtl;
    `;

    toast.innerHTML = `
        <div style="display:flex; align-items:flex-start; gap:12px;">
            <div style="font-size:24px; flex-shrink:0; margin-top:2px;">
                ${isUrgent ? '🔴' : '📅'}
            </div>
            <div style="flex:1;">
                <div style="font-weight:800; font-size:14px; color:var(--text-main); margin-bottom:4px;">
                    אירועי קהילה קרובים
                </div>
                <div style="font-size:13px; color:var(--text-muted); margin-bottom:12px; line-height:1.5;">
                    ${summary}
                </div>
                <div style="display:flex; gap:8px;">
                    <button onclick="_goToEventsFromAlert()"
                        style="flex:1; padding:8px 14px; background:var(--accent); color:white;
                               border:none; border-radius:10px; cursor:pointer; font-size:13px;
                               font-weight:700; font-family:inherit;">
                        <i class="fas fa-star-of-david"></i> צפה באירועים
                    </button>
                    <button onclick="document.getElementById('startup-alert-toast').remove()"
                        style="padding:8px 12px; background:var(--bg-body); color:var(--text-muted);
                               border:1px solid var(--border-light); border-radius:10px;
                               cursor:pointer; font-size:13px; font-family:inherit;">
                        סגור
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(toast);

    // אנימציה
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });
    });

    // סגור אוטומטית אחרי 12 שניות אם אין לחיצה
    setTimeout(() => {
        if (document.getElementById('startup-alert-toast')) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 400);
        }
    }, 12000);
}

// ── ניווט ללשונית אירועים ──
window._goToEventsFromAlert = function() {
    const t = document.getElementById('startup-alert-toast');
    if (t) t.remove();
    switchMainView('events');
};

// ── צור משימות אוטומטיות לאירועים שהגיע יומם ──
function _createAutoTasksFromAlerts(upcoming) {
    if (!db.meta) db.meta = {};
    if (!db.meta.generalTasks) db.meta.generalTasks = [];

    const todayStr = new Date().toLocaleDateString('he-IL');
    let created = 0;

    upcoming.forEach(ev => {
        const typeDef = HebrewDate.EVENT_TYPES[ev.type] || {};
        // צור משימה ביום ההתראה המוגדר לסוג האירוע
        if (ev.daysUntil !== (typeDef.alertDays || 7)) return;

        const taskText = `${ev.label} — משפחת ${ev.aptName} (עוד ${ev.daysUntil} ימים)`;
        const exists = db.meta.generalTasks.some(t => t.text === taskText && !t.done);
        if (exists) return;

        db.meta.generalTasks.push({
            text: taskText,
            date: todayStr,
            done: false,
            autoCreated: true,
            fromEvent: true,
            eventType: ev.type,
        });
        created++;
    });

    if (created > 0) {
        saveDB();
        console.log(`✅ נוצרו ${created} משימות אוטומטיות מאירועים`);
    }
}


// ════════════════════════════════════════════════════════════
// ██  מערכת סוגי אירועים — מובנים + מותאמים  ██
// ════════════════════════════════════════════════════════════

// ── סוגים מובנים — לא ניתנים למחיקה ──
const BUILTIN_EVENT_TYPES = [
    { id: 'yahrzeit',    label: 'יארצייט',      emoji: '🕯️', color: '#64748b', recurring: true  },
    { id: 'birthday',    label: 'יום הולדת',    emoji: '🎂', color: '#f59e0b', recurring: true  },
    { id: 'anniversary', label: 'יום נישואין',  emoji: '💍', color: '#ec4899', recurring: true  },
    { id: 'bar_mitzva',  label: 'בר מצווה',     emoji: '✡️', color: '#8b5cf6', recurring: false },
    { id: 'bat_mitzva',  label: 'בת מצווה',     emoji: '✡️', color: '#8b5cf6', recurring: false },
    { id: 'wedding',     label: 'חתונה',         emoji: '💒', color: '#ec4899', recurring: false },
    { id: 'other',       label: 'אחר',           emoji: '📅', color: '#3b82f6', recurring: true  },
];

// ── קבל את כל הסוגים (מובנים + מותאמים) ──
function getAllEventTypes() {
    const custom = appSettings.customEventTypes || [];
    return [...BUILTIN_EVENT_TYPES, ...custom];
}

// ── קבל סוג לפי ID ──
function getEventTypeById(id) {
    return getAllEventTypes().find(t => t.id === id) || BUILTIN_EVENT_TYPES.find(t => t.id === 'other');
}

// ── מצב טאב נוכחי בלשונית ──
let _msModeCurrentTab = 'recurring'; // 'recurring' | 'onetime'
let _tempEventTasks = []; // משימות זמניות לאירוע חד פעמי
let _newTypeIsRecurring = true; // מצב הטוגל בדיאלוג הסוגים

// ── החלף טאב ספירלי/חד פעמי ──
window.switchMsTab = function(tab) {
    _msModeCurrentTab = tab;
    const btnRec = document.getElementById('ms-tab-recurring');
    const btnOne = document.getElementById('ms-tab-onetime');
    if (btnRec && btnOne) {
        btnRec.style.background = tab === 'recurring' ? 'var(--accent)' : 'transparent';
        btnRec.style.color      = tab === 'recurring' ? 'white' : 'var(--text-muted)';
        btnOne.style.background = tab === 'onetime'  ? 'var(--accent)' : 'transparent';
        btnOne.style.color      = tab === 'onetime'  ? 'white' : 'var(--text-muted)';
    }
    _refreshMsTypeSelect();
    renderMilestones();
    _resetMsForm();
};

// ── מלא dropdown סוגי אירועים לפי הטאב ──
function _refreshMsTypeSelect() {
    const sel = document.getElementById('ms-new-type');
    if (!sel) return;
    const types = getAllEventTypes().filter(t =>
        _msModeCurrentTab === 'recurring' ? t.recurring : !t.recurring
    );
    sel.innerHTML = types.map(t =>
        `<option value="${t.id}">${t.emoji} ${t.label}</option>`
    ).join('');
    onMsTypeChange();
}

// ── כשמשנים סוג — עדכן UI ──
window.onMsTypeChange = function() {
    const typeId = document.getElementById('ms-new-type')?.value;
    if (!typeId) return;
    const typeDef = getEventTypeById(typeId);

    // placeholder לתיאור
    const placeholders = {
        birthday:    'לדוגמה: יום הולדת אבא, יום הולדת דוד...',
        yahrzeit:    'לדוגמה: יארצייט סבא, יארצייט אמא ז״ל...',
        anniversary: 'יום נישואין',
        bar_mitzva:  'בר מצווה של...',
        bat_mitzva:  'בת מצווה של...',
        wedding:     'חתונת...',
        other:       'תאר את האירוע...',
    };
    const lbl = document.getElementById('ms-new-label');
    if (lbl) lbl.placeholder = placeholders[typeId] || 'תאר את האירוע...';

    // שיוך לילד — מוצג בבר/בת מצווה ועוד
    const childTypes = ['bar_mitzva', 'bat_mitzva'];
    const childSection = document.getElementById('ms-child-section');
    if (childSection) {
        const showChild = childTypes.includes(typeId) ||
            (appSettings.customEventTypes || []).find(t => t.id === typeId && t.showChild);
        childSection.style.display = showChild ? 'block' : 'none';
        if (showChild) _populateChildSelect();
    }

    // פרטים נוספים — רק בחד פעמי
    const detailsSection = document.getElementById('ms-onetime-details');
    if (detailsSection) {
        detailsSection.style.display = _msModeCurrentTab === 'onetime' ? 'block' : 'none';
    }
};

// ── מלא dropdown ילדים ──
function _populateChildSelect() {
    const sel = document.getElementById('ms-new-child');
    if (!sel) return;
    const apt = db[currentBldg]?.apts[currentAptIdx];
    const children = apt?.childrenList || [];
    sel.innerHTML = '<option value="">— לא משויך לילד ספציפי —</option>';
    children.forEach((c, i) => {
        sel.innerHTML += `<option value="${i}">${c.name || 'ילד ' + (i+1)}</option>`;
    });
}

// ── הוסף משימה לאירוע ──
window.addEventTask = function() {
    const inp = document.getElementById('ms-new-task-text');
    const text = inp?.value.trim();
    if (!text) return;
    _tempEventTasks.push({ text, done: false, id: Date.now() });
    inp.value = '';
    _renderEventTasksList();
};

function _renderEventTasksList() {
    const el = document.getElementById('ms-event-tasks-list');
    if (!el) return;
    if (!_tempEventTasks.length) { el.innerHTML = ''; return; }
    el.innerHTML = _tempEventTasks.map((t, i) => `
        <div style="display:flex; align-items:center; gap:8px; padding:5px 8px;
                    background:var(--surface); border-radius:8px; margin-bottom:4px; font-size:13px;">
            <span style="flex:1; color:var(--text-main);">${escapeHTML(t.text)}</span>
            <button onclick="_removeEventTask(${i})"
                style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:12px; padding:0;">
                <i class="fas fa-times"></i>
            </button>
        </div>`
    ).join('');
}

window._removeEventTask = function(i) {
    _tempEventTasks.splice(i, 1);
    _renderEventTasksList();
};

// ── אפס טופס ──
function _resetMsForm() {
    const fields = ['ms-new-label', 'ms-new-greg-date', 'ms-detail-location', 'ms-detail-time', 'ms-detail-notes', 'ms-new-task-text'];
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const prev = document.getElementById('ms-greg-preview');
    if (prev) prev.style.display = 'none';
    const hebPrev = document.getElementById('ms-heb-preview-text');
    if (hebPrev) hebPrev.textContent = 'בחר שנה, חודש ויום';
    _tempEventTasks = [];
    _renderEventTasksList();
    _refreshMsTypeSelect();
}

// ── הוסף אירוע (override של הפונקציה הקיימת) ──
window.addMilestone = function() {
    if (!window.HebrewDate) { showToast('מנוע תאריכים לא נטען', 'error'); return; }

    const typeId = document.getElementById('ms-new-type').value;
    const label  = document.getElementById('ms-new-label').value.trim();
    if (!label) { showToast('יש להזין תיאור לאירוע', 'warning'); return; }

    const typeDef = getEventTypeById(typeId);
    let monthName, day, year, gregDateStr;

    if (_msInputMode === 'greg') {
        const gregVal = document.getElementById('ms-new-greg-date').value;
        if (!gregVal) { showToast('יש לבחור תאריך', 'warning'); return; }
        const hDate = HebrewDate.fromGregorian(new Date(gregVal + 'T12:00:00'));
        monthName   = hDate.monthName;
        day         = hDate.day;
        year        = hDate.year;
        gregDateStr = gregVal;
    } else {
        day       = parseInt(document.getElementById('ms-new-heb-day').value);
        monthName = document.getElementById('ms-new-heb-month').value;
        year      = parseInt(document.getElementById('ms-new-heb-year').value) || null;
        if (!day || !monthName) { showToast('יש לבחור יום וחודש עבריים', 'warning'); return; }
    }

    // שיוך לילד
    const childIdxEl = document.getElementById('ms-new-child');
    const childIdx   = childIdxEl?.value !== '' ? parseInt(childIdxEl.value) : null;
    const apt        = db[currentBldg]?.apts[currentAptIdx];
    const childName  = childIdx !== null ? apt?.childrenList?.[childIdx]?.name || null : null;

    const ms = {
        id:        Date.now(),
        type:      typeId,
        label,
        recurring: typeDef.recurring,
        monthName,
        day,
        year:      typeDef.recurring ? null : (year || null), // ספירלי אין שנה
        gregDate:  gregDateStr || null,
        childIdx:  childIdx,
        childName: childName,
        createdAt: new Date().toISOString(),
    };

    // פרטי אירוע חד פעמי
    if (!typeDef.recurring) {
        ms.details = {
            location: document.getElementById('ms-detail-location')?.value.trim() || '',
            time:     document.getElementById('ms-detail-time')?.value || '',
            notes:    document.getElementById('ms-detail-notes')?.value.trim() || '',
        };
        ms.tasks = [..._tempEventTasks];
    }

    tempMilestones.push(ms);
    markDirty();
    renderMilestones();
    _resetMsForm();
    showToast('אירוע נוסף ✓', 'success');
};

// ── רינדור רשימה — לפי הטאב הנוכחי ──
window.renderMilestones = function() {
    const container = document.getElementById('ms-list');
    if (!container) return;

    const filtered = tempMilestones.filter(ms => {
        const typeDef = getEventTypeById(ms.type);
        const isRecurring = ms.recurring ?? typeDef?.recurring ?? true;
        return _msModeCurrentTab === 'recurring' ? isRecurring : !isRecurring;
    });

    if (!filtered.length) {
        const label = _msModeCurrentTab === 'recurring' ? 'אירועים ספירליים' : 'אירועים חד פעמיים';
        container.innerHTML = `
            <div style="text-align:center; padding:24px; color:var(--text-muted); font-size:14px;">
                <i class="fas fa-calendar-alt" style="font-size:28px; margin-bottom:10px; opacity:0.3; display:block;"></i>
                אין ${label} עדיין
            </div>`;
        return;
    }

    // מיין לפי קרבה
    let items = filtered.map(ms => {
        let daysUntil = 9999;
        try {
            if (ms.recurring || !ms.year) {
                daysUntil = HebrewDate.nextOccurrence(ms.monthName, ms.day).daysUntil;
            } else {
                // חד פעמי — תאריך מדויק
                const greg = HebrewDate.toGregorian(ms.monthName, ms.day, ms.year);
                const today = new Date(); today.setHours(0,0,0,0);
                daysUntil = Math.max(0, Math.round((greg - today) / 86400000));
            }
        } catch(e) {}
        return { ...ms, _daysUntil: daysUntil };
    }).sort((a, b) => a._daysUntil - b._daysUntil);

    container.innerHTML = items.map(ms => {
        const typeDef = getEventTypeById(ms.type);
        const monthHe = HebrewDate.MONTH_HE[ms.monthName] || ms.monthName;
        let hebDay = ms.day.toString();
        try { hebDay = jewishDate.convertNumberToHebrew(ms.day, false, false) || ms.day.toString(); } catch(e) {}

        const dateStr = ms.year && !ms.recurring
            ? `${hebDay} ${monthHe} ${ms.year}`   // חד פעמי — עם שנה
            : `${hebDay} ${monthHe}`;               // ספירלי — ללא שנה

        const urgency = ms._daysUntil <= 7  ? 'rgba(239,68,68,0.05)'    :
                        ms._daysUntil <= 30 ? 'rgba(245,158,11,0.05)'   : 'var(--surface)';
        const urgencyBorder = ms._daysUntil <= 7  ? 'rgba(239,68,68,0.3)'  :
                              ms._daysUntil <= 30 ? 'rgba(245,158,11,0.3)' : 'var(--border-light)';

        const daysLabel = ms._daysUntil < 9999 ? HebrewDate.formatDaysUntil(ms._daysUntil) : '';

        // פרטים לחד פעמי
        let detailsHtml = '';
        if (!ms.recurring && ms.details) {
            const d = ms.details;
            const parts = [d.location, d.time].filter(Boolean);
            if (parts.length) detailsHtml += `<div style="font-size:11px; color:var(--text-muted);">${parts.map(escapeHTML).join(' · ')}</div>`;
            if (d.notes) detailsHtml += `<div style="font-size:11px; color:var(--text-muted); font-style:italic;">${escapeHTML(d.notes)}</div>`;
        }
        // משימות לחד פעמי
        let tasksHtml = '';
        if (!ms.recurring && ms.tasks?.length) {
            const done = ms.tasks.filter(t => t.done).length;
            tasksHtml = `<div style="font-size:11px; color:var(--accent); margin-top:2px;">
                ✓ ${done}/${ms.tasks.length} משימות
            </div>`;
        }
        // שיוך לילד
        const childHtml = ms.childName
            ? `<span style="font-size:11px; background:rgba(139,92,246,0.1); color:#7c3aed; padding:1px 6px; border-radius:10px; margin-right:4px;">👤 ${escapeHTML(ms.childName)}</span>`
            : '';

        return `
        <div style="background:${urgency}; border:1px solid ${urgencyBorder};
                    border-radius:12px; padding:12px 14px;
                    display:flex; align-items:flex-start; gap:12px;">
            <div style="width:38px; height:38px; border-radius:50%; flex-shrink:0;
                        background:${typeDef.color}22; display:flex; align-items:center;
                        justify-content:center; font-size:18px;">
                ${typeDef.emoji}
            </div>
            <div style="flex:1; min-width:0;">
                <div style="font-weight:700; font-size:14px; color:var(--text-main);">${escapeHTML(ms.label)}</div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px; display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
                    ${childHtml}
                    <span>📅 ${dateStr}</span>
                    ${daysLabel ? `<span>· ${daysLabel}</span>` : ''}
                </div>
                ${detailsHtml}
                ${tasksHtml}
            </div>
            <button onclick="deleteMilestone(${ms.id})"
                style="background:none; border:none; color:var(--danger); cursor:pointer;
                       padding:4px 8px; border-radius:6px; font-size:14px; opacity:0.6; flex-shrink:0;">
                <i class="fas fa-trash"></i>
            </button>
        </div>`;
    }).join('');
};

// ── אתחול לשונית ──
function _initMilestonesTab() {
    if (window.HebrewDate) {
        const today = HebrewDate.todayHebrew();
        const el = document.getElementById('ms-today-display');
        if (el) el.textContent = today.display;
    }
    _populateHebYearSelect();
    _populateHebMonthSelect();
    _populateHebDaySelect();
    _refreshMsTypeSelect();
    _resetMsForm();
    switchMsTab(_msModeCurrentTab);
}

// ════════════════════════════════════════════════════════════
// ██  ניהול סוגי אירועים מותאמים  ██
// ════════════════════════════════════════════════════════════

window.setNewTypeRecurring = function(val) {
    _newTypeIsRecurring = val;
    const btnR = document.getElementById('new-type-recurring-btn');
    const btnO = document.getElementById('new-type-onetime-btn');
    if (btnR) { btnR.style.background = val ? 'var(--accent)' : 'transparent'; btnR.style.color = val ? 'white' : 'var(--text-muted)'; btnR.style.borderColor = val ? 'var(--accent)' : 'var(--border-light)'; }
    if (btnO) { btnO.style.background = !val ? 'var(--accent)' : 'transparent'; btnO.style.color = !val ? 'white' : 'var(--text-muted)'; btnO.style.borderColor = !val ? 'var(--accent)' : 'var(--border-light)'; }
};

window.openManageEventTypes = function() {
    _renderBuiltinTypes();
    _renderCustomTypes();
    document.getElementById('eventTypesModal').style.display = 'flex';
};

function _renderBuiltinTypes() {
    const el = document.getElementById('builtin-types-list');
    if (!el) return;
    el.innerHTML = BUILTIN_EVENT_TYPES.map(t => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 10px;
                    background:var(--bg-body); border-radius:8px; margin-bottom:4px; font-size:13px;">
            <span style="font-size:18px;">${t.emoji}</span>
            <span style="flex:1; font-weight:600;">${t.label}</span>
            <span style="font-size:11px; padding:2px 8px; border-radius:20px;
                  background:${t.recurring ? 'rgba(59,130,246,0.1)' : 'rgba(124,58,237,0.1)'};
                  color:${t.recurring ? 'var(--accent)' : '#7c3aed'};">
                ${t.recurring ? '🔄 ספירלי' : '📌 חד פעמי'}
            </span>
        </div>`
    ).join('');
}

function _renderCustomTypes() {
    const el = document.getElementById('custom-types-list');
    if (!el) return;
    const custom = appSettings.customEventTypes || [];
    if (!custom.length) {
        el.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:8px;">אין סוגים מותאמים עדיין</div>';
        return;
    }
    el.innerHTML = custom.map((t, i) => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 10px;
                    background:var(--bg-body); border-radius:8px; margin-bottom:4px; font-size:13px;">
            <span style="font-size:18px;">${t.emoji || '📅'}</span>
            <span style="flex:1; font-weight:600; color:${t.color || 'var(--text-main)'};">${escapeHTML(t.label)}</span>
            <span style="font-size:11px; padding:2px 8px; border-radius:20px;
                  background:${t.recurring ? 'rgba(59,130,246,0.1)' : 'rgba(124,58,237,0.1)'};
                  color:${t.recurring ? 'var(--accent)' : '#7c3aed'};">
                ${t.recurring ? '🔄 ספירלי' : '📌 חד פעמי'}
            </span>
            <button onclick="deleteCustomEventType(${i})"
                style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:13px; padding:0;">
                <i class="fas fa-trash"></i>
            </button>
        </div>`
    ).join('');
}

window.addCustomEventType = function() {
    const emoji = document.getElementById('new-type-emoji').value.trim() || '📅';
    const label = document.getElementById('new-type-label').value.trim();
    const color = document.getElementById('new-type-color').value;
    if (!label) { showToast('יש להזין שם לסוג', 'warning'); return; }

    if (!appSettings.customEventTypes) appSettings.customEventTypes = [];

    // בדוק כפילות
    const exists = getAllEventTypes().some(t => t.label === label);
    if (exists) { showToast('סוג כזה כבר קיים', 'warning'); return; }

    appSettings.customEventTypes.push({
        id:        'custom_' + Date.now(),
        label,
        emoji,
        color,
        recurring: _newTypeIsRecurring,
    });

    // שמור
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    if (typeof pushToDrive === 'function') pushToDrive();

    // נקה שדות
    document.getElementById('new-type-emoji').value = '';
    document.getElementById('new-type-label').value = '';

    _renderCustomTypes();
    _refreshMsTypeSelect();
    showToast(`סוג "${label}" נוסף ✓`, 'success');
};

window.deleteCustomEventType = function(idx) {
    if (!appSettings.customEventTypes) return;
    const name = appSettings.customEventTypes[idx]?.label;
    appSettings.customEventTypes.splice(idx, 1);
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    if (typeof pushToDrive === 'function') pushToDrive();
    _renderCustomTypes();
    _refreshMsTypeSelect();
    showToast(`סוג "${name}" נמחק`, 'info');
};


// ════════════════════════════════════════════════════════════
// ██  לשונית אירועים כללית — שדרוג עם ספירלי/חד פעמי  ██
// ════════════════════════════════════════════════════════════

let _eventsMainTab = 'recurring'; // 'recurring' | 'onetime'

// ── החלף טאב ראשי ──
window.switchEventsMainTab = function(tab) {
    _eventsMainTab = tab;
    const btnR = document.getElementById('ev-main-tab-recurring');
    const btnO = document.getElementById('ev-main-tab-onetime');
    if (btnR) { btnR.style.background = tab === 'recurring' ? 'var(--accent)' : 'var(--surface)'; btnR.style.color = tab === 'recurring' ? 'white' : 'var(--text-muted)'; btnR.style.border = tab === 'recurring' ? 'none' : '1px solid var(--border-light)'; }
    if (btnO) { btnO.style.background = tab === 'onetime' ? 'var(--accent)' : 'var(--surface)'; btnO.style.color = tab === 'onetime' ? 'white' : 'var(--text-muted)'; btnO.style.border = tab === 'onetime' ? 'none' : '1px solid var(--border-light)'; }
    renderEventsView();
};

// ── מלא dropdown סוגים דינמית ──
function _refreshEventsTypeFilter() {
    const sel = document.getElementById('events-type-filter');
    if (!sel) return;
    const allTypes = getAllEventTypes().filter(t =>
        _eventsMainTab === 'recurring' ? t.recurring : !t.recurring
    );
    sel.innerHTML = '<option value="">כל הסוגים</option>' +
        allTypes.map(t => `<option value="${t.id}">${t.emoji} ${t.label}</option>`).join('');
}

// ── אסוף אירועים מה-DB לפי טאב ──
function _getAllEventsFiltered(days, typeFilter) {
    const families = [];
    Object.entries(db).forEach(([bldg, bldgData]) => {
        if (!bldgData?.apts) return;
        bldgData.apts.forEach((apt, aptIdx) => {
            if (!(apt.milestones || []).length) return;
            families.push({ bldg, aptIdx, apt });
        });
    });

    // סנן לפי ספירלי/חד פעמי
    const today = new Date(); today.setHours(0,0,0,0);
    const results = [];

    families.forEach(({ bldg, aptIdx, apt }) => {
        (apt.milestones || []).forEach(ms => {
            const typeDef = getEventTypeById(ms.type);
            const isRecurring = ms.recurring ?? typeDef?.recurring ?? true;

            // בדוק שמתאים לטאב
            if (_eventsMainTab === 'recurring' && !isRecurring) return;
            if (_eventsMainTab === 'onetime'   &&  isRecurring) return;

            // סנן לפי סוג
            if (typeFilter && ms.type !== typeFilter) return;

            let daysUntil = 9999;
            let gregDate  = null;

            try {
                if (isRecurring) {
                    const occ = HebrewDate.nextOccurrence(ms.monthName, ms.day);
                    daysUntil = occ.daysUntil;
                    gregDate  = occ.gregDate;
                } else if (ms.year) {
                    gregDate  = HebrewDate.toGregorian(ms.monthName, ms.day, ms.year);
                    daysUntil = Math.round((gregDate - today) / 86400000);
                    if (daysUntil < 0) return; // אירוע עבר
                } else return;
            } catch(e) { return; }

            if (daysUntil > days) return;

            results.push({
                bldg, aptIdx,
                aptName: apt.name || '',
                type: ms.type,
                label: ms.label,
                icon: typeDef?.emoji || '📅',
                color: typeDef?.color || '#3b82f6',
                daysUntil,
                gregDate,
                ms,
                isRecurring,
                childName: ms.childName || null,
            });
        });
    });

    return results.sort((a, b) => a.daysUntil - b.daysUntil);
}

// ── רינדור ראשי — override ──
window.renderEventsView = function() {
    if (!window.HebrewDate) return;

    _refreshEventsTypeFilter();

    const days       = parseInt(document.getElementById('events-window')?.value || 30);
    const typeFilter = document.getElementById('events-type-filter')?.value || '';
    const events     = _getAllEventsFiltered(days, typeFilter);

    _renderEventsKPI(events, days);

    const timeline = document.getElementById('events-timeline');
    const empty    = document.getElementById('events-empty');

    if (!events.length) {
        timeline.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';
    _renderEventsTimeline(events);
};

// ── KPI ──
window._renderEventsKPI = function(events, days) {
    const kpiEl = document.getElementById('events-kpi-row');
    if (!kpiEl) return;

    const total   = events.length;
    const today   = events.filter(e => e.daysUntil === 0).length;
    const week    = events.filter(e => e.daysUntil <= 7).length;
    const withKid = events.filter(e => e.childName).length;

    const kpis = [
        { label: `ב-${days} ימים`,  value: total,   color: 'var(--accent)',  icon: 'fa-calendar-alt' },
        { label: 'היום',            value: today,   color: 'var(--danger)',  icon: 'fa-exclamation-circle' },
        { label: 'השבוע',           value: week,    color: 'var(--warning)', icon: 'fa-clock' },
        { label: _eventsMainTab === 'onetime' ? 'מקושר לילד' : 'יארצייטים',
          value: _eventsMainTab === 'onetime'
            ? withKid
            : events.filter(e => e.type === 'yahrzeit').length,
          color: '#64748b', icon: _eventsMainTab === 'onetime' ? 'fa-child' : 'fa-candle' },
    ];

    kpiEl.innerHTML = kpis.map(k => `
        <div style="background:var(--surface); border:1px solid var(--border-light);
                    border-radius:14px; padding:14px 16px; text-align:center; box-shadow:var(--card-shadow);">
            <i class="fas ${k.icon}" style="color:${k.color}; font-size:18px; margin-bottom:6px; display:block;"></i>
            <div style="font-size:28px; font-weight:900; color:${k.color}; line-height:1;">${k.value}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${k.label}</div>
        </div>`
    ).join('');
};

// ── ציר זמן ──
window._renderEventsTimeline = function(events) {
    const timeline = document.getElementById('events-timeline');

    // קבץ לפי יום
    const groups = {};
    events.forEach(ev => {
        const key = ev.daysUntil;
        if (!groups[key]) groups[key] = [];
        groups[key].push(ev);
    });

    timeline.innerHTML = Object.keys(groups)
        .sort((a,b) => parseInt(a)-parseInt(b))
        .map(daysKey => {
            const daysNum = parseInt(daysKey);
            const evs = groups[daysKey];

            let dayLabel, dayBg, dayColor;
            if (daysNum === 0)      { dayLabel = '🔴 היום!';         dayBg = 'rgba(239,68,68,0.08)';  dayColor = 'var(--danger)'; }
            else if (daysNum === 1) { dayLabel = '🟠 מחר';           dayBg = 'rgba(234,88,12,0.08)';  dayColor = '#ea580c'; }
            else if (daysNum <= 7)  { dayLabel = `🟡 עוד ${daysNum} ימים`; dayBg = 'rgba(245,158,11,0.06)'; dayColor = 'var(--warning)'; }
            else                   { dayLabel = `עוד ${daysNum} ימים`; dayBg = 'var(--surface)'; dayColor = 'var(--text-muted)'; }

            const gregStr = evs[0].gregDate
                ? evs[0].gregDate.toLocaleDateString('he-IL', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
                : '';

            const rows = evs.map(ev => {
                // תאריך עברי
                const monthHe = HebrewDate.MONTH_HE[ev.ms.monthName] || ev.ms.monthName;
                let hebDay = ev.ms.day.toString();
                try { hebDay = jewishDate.convertNumberToHebrew(ev.ms.day, false, false) || hebDay; } catch(e) {}
                const hebDate = ev.ms.year && !ev.isRecurring
                    ? `${hebDay} ${monthHe} ${ev.ms.year}`
                    : `${hebDay} ${monthHe}`;

                // פרטים לחד פעמי
                let extraHtml = '';
                if (!ev.isRecurring && ev.ms.details) {
                    const d = ev.ms.details;
                    const parts = [d.location, d.time].filter(Boolean);
                    if (parts.length) extraHtml += `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${parts.map(escapeHTML).join(' · ')}</div>`;
                    if (ev.ms.tasks?.length) {
                        const done = ev.ms.tasks.filter(t=>t.done).length;
                        extraHtml += `<div style="font-size:11px; color:var(--accent);">✓ ${done}/${ev.ms.tasks.length} משימות</div>`;
                    }
                }

                const childBadge = ev.childName
                    ? `<span style="font-size:11px; background:rgba(139,92,246,0.1); color:#7c3aed; padding:1px 7px; border-radius:10px;">👤 ${escapeHTML(ev.childName)}</span>`
                    : '';

                return `
                <div style="display:flex; align-items:flex-start; gap:12px; padding:10px 14px;
                            background:var(--bg-body); border-radius:10px; cursor:pointer;"
                     onclick="openClientCardFromEvent('${encodeURIComponent(ev.bldg)}', ${ev.aptIdx})">
                    <div style="width:36px; height:36px; border-radius:50%; flex-shrink:0;
                                background:${ev.color}18; display:flex; align-items:center; justify-content:center; font-size:18px;">
                        ${ev.icon}
                    </div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:700; font-size:14px; color:var(--text-main);">${escapeHTML(ev.label)}</div>
                        <div style="font-size:12px; color:var(--text-muted); margin-top:2px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                            ${childBadge}
                            <span>משפחת ${escapeHTML(ev.aptName)}</span>
                            <span>· 📅 ${hebDate}</span>
                        </div>
                        ${extraHtml}
                    </div>
                    <div style="display:flex; gap:6px; flex-shrink:0;">
                        <button onclick="event.stopPropagation(); sendEventWhatsApp('${encodeURIComponent(ev.bldg)}', ${ev.aptIdx}, '${encodeURIComponent(ev.label)}')"
                            style="padding:5px 10px; border-radius:8px; border:none; background:rgba(37,211,102,0.12); color:#25D366; cursor:pointer; font-size:12px;">
                            <i class="fab fa-whatsapp"></i>
                        </button>
                        <button onclick="event.stopPropagation(); addTaskFromEvent('${encodeURIComponent(ev.bldg)}', ${ev.aptIdx}, '${encodeURIComponent(ev.label)}', ${daysNum})"
                            style="padding:5px 10px; border-radius:8px; border:none; background:rgba(59,130,246,0.1); color:var(--accent); cursor:pointer; font-size:12px;">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                </div>`;
            }).join('');

            return `
            <div style="background:${dayBg}; border:1px solid ${daysNum<=1 ? dayColor+'40' : 'var(--border-light)'}; border-radius:14px; overflow:hidden;">
                <div style="padding:10px 16px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-light);">
                    <span style="font-weight:800; font-size:14px; color:${dayColor};">${dayLabel}</span>
                    <span style="font-size:12px; color:var(--text-muted);">${gregStr}</span>
                </div>
                <div style="padding:8px; display:flex; flex-direction:column; gap:6px;">${rows}</div>
            </div>`;
        }).join('');
};

// ── אתחול ──
const _origInitEventsView = window._initEventsView || function(){};
window._initEventsView = function() {
    _origInitEventsView();
    switchEventsMainTab('recurring');
};


// ════════════════════════════════════════════════════════════
// ██  תיקוני אמינות ואבטחה  ██
// ════════════════════════════════════════════════════════════

// ── תיקון 1: _resetAllTemp — איפוס מלא לפני כל פתיחת כרטיס ──
window._resetAllTemp = function() {
    tempTags        = [];
    tempTasks       = [];
    tempChildren    = [];
    tempLogs        = [];
    tempDonations   = [];
    tempCustom      = {};
    tempBoards      = {};
    tempMilestones  = [];
    _tempEventTasks = [];
    isDirty         = false;
};

// עטוף את openClientCard המקורי כדי לאפס תמיד לפני פתיחה
const _origOpenClientCardSafe = window.openClientCard;
window.openClientCard = function(idx) {
    _resetAllTemp();
    _origOpenClientCardSafe(idx);
};

// ── תיקון 2: escapeHTML — וודא שקיים ומוגדר כ-global ──
if (!window.escapeHTML) {
    window.escapeHTML = function(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };
}

// ── תיקון 3: renderLogs — עטוף עם escapeHTML ──
window.renderLogs = function() {
    const el = document.getElementById('cLogsList');
    if (!el) return;
    if (!tempLogs.length) {
        el.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><div>עוד לא נוצר קשר. זה הזמן!</div></div>';
        return;
    }
    el.innerHTML = tempLogs
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map((l, i) => `
            <div class="log-item">
                <div class="log-header">
                    <span><i class="fas fa-calendar-alt"></i> ${escapeHTML(l.date)} - ${escapeHTML(l.type)}</span>
                    <button onclick="tempLogs.splice(${i},1);markDirty();renderLogs()"
                        style="background:none;border:none;color:var(--danger);cursor:pointer;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div>${escapeHTML(l.text)}</div>
            </div>`)
        .join('');
};

// ── תיקון 4: renderDonations — עטוף עם escapeHTML ──
window.renderDonations = function() {
    const sum = tempDonations.reduce((a, b) => a + Number(b.amount || 0), 0);
    const sumEl = document.getElementById('cDonationsSum');
    if (sumEl) sumEl.innerText = `₪${sum}`;
    const el = document.getElementById('cDonationsList');
    if (!el) return;
    if (!tempDonations.length) {
        el.innerHTML = '<div class="empty-state"><i class="fas fa-hand-holding-heart"></i><div>אין תרומות.</div></div>';
        return;
    }
    el.innerHTML = tempDonations
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map((d, i) => `
            <div class="log-item">
                <div class="log-header">
                    <span style="color:var(--success);"><i class="fas fa-shekel-sign"></i> ${escapeHTML(String(d.amount))}</span>
                    <span>${escapeHTML(d.date)}</span>
                </div>
                <div>${escapeHTML(d.reason)}
                    <button onclick="tempDonations.splice(${i},1);markDirty();renderDonations()"
                        style="float:left;background:none;border:none;color:var(--danger);cursor:pointer;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>`)
        .join('');
};

// ── תיקון 5: crmFamilyTitle — escapeHTML ──
const _origOpenClientCardTitle = window.openClientCard;
window.openClientCard = function(idx) {
    _origOpenClientCardTitle(idx);
    // תיקן את הכותרת אחרי הפתיחה
    const a = db[currentBldg]?.apts[idx];
    const titleEl = document.getElementById('crmFamilyTitle');
    if (titleEl && a) {
        titleEl.innerHTML = `<i class="fas fa-id-card"></i> ${escapeHTML(a.name || 'משפחה חדשה')} <span style="font-size:12px;">${currentBldg === NO_ADDRESS_KEY ? '(ללא כתובת)' : ''}</span>`;
    }
};

// ── תיקון 6: search results — escapeHTML ──
const _origHandleOmniSearch = window.handleOmniSearch;
if (_origHandleOmniSearch) {
    window.handleOmniSearch = function() {
        _origHandleOmniSearch.apply(this, arguments);
        // תיקן תוצאות חיפוש אחרי רינדור
        setTimeout(() => {
            const dd = document.getElementById('searchDropdown');
            if (dd) {
                dd.querySelectorAll('.search-item-title').forEach(el => {
                    // הטקסט כבר רונדר — אי אפשר לתקן post-hoc בקלות
                    // הפתרון הנכון הוא ברינדור עצמו
                });
            }
        }, 0);
    };
}

// ── תיקון 7: polygon coords comparison — תיקון ===  ──
window._isPolygonClosed = function(coords) {
    if (!coords || coords.length < 2) return false;
    const first = coords[0];
    const last  = coords[coords.length - 1];
    // השוואה נכונה של קואורדינטות (מערכים)
    return first[0] === last[0] && first[1] === last[1];
};

window._ensureClosedRing = function(coords) {
    if (!coords || coords.length < 3) return coords;
    if (window._isPolygonClosed(coords)) return coords;
    return [...coords, coords[0]];
};

// ── תיקון 8: fetch בלי try/catch — Drive file read ──
// תיקון ל-syncWithDrive שיש בו fetch לא מוגן
const _origSyncWithDrive = window.syncWithDrive;
if (typeof _origSyncWithDrive === 'function') {
    window.syncWithDrive = async function(forcePull) {
        try {
            return await _origSyncWithDrive(forcePull);
        } catch(e) {
            console.error('syncWithDrive error:', e);
            setSyncStatus('error', 'שגיאת סנכרון');
            showToast('שגיאה בסנכרון עם Drive', 'error');
        }
    };
}

// ── תיקון 9: toast — escapeHTML ──
const _origShowToast = window.showToast;
if (_origShowToast) {
    window.showToast = function(msg, type, duration) {
        // msg יכול להכיל HTML מכוון (icons) — לא נברח ממנו
        // אבל נוודא שהוא string
        return _origShowToast(String(msg), type, duration);
    };
}

// ── תיקון 10: וודא שהפונקציות החדשות של polygon משתמשות ב-_ensureClosedRing ──
// patch לשני המקומות שמשתמשים ב-tempTerritoryPolygon[0] === tempTerritoryPolygon[last]
(function() {
    // override של tmUpdateFromDraw אם קיים
    const _origTmUpdateFromDraw = window.tmUpdateFromDraw;
    if (_origTmUpdateFromDraw) {
        window.tmUpdateFromDraw = function() {
            _origTmUpdateFromDraw.apply(this, arguments);
            // וודא שהפוליגון סגור נכון אחרי עדכון
            if (tempTerritoryPolygon && Array.isArray(tempTerritoryPolygon)) {
                tempTerritoryPolygon = window._ensureClosedRing(tempTerritoryPolygon);
            }
        };
    }
})();


// ════════════════════════════════════════════════════════════
// ██  איחוד Wrappers — openClientCard + switchMainView  ██
// ════════════════════════════════════════════════════════════

// ── שמור reference לפונקציה המקורית של openClientCard ──
// (לפני כל ה-wrappers שנוספו)
const _coreOpenClientCard = (function() {
    // מצא את הפונקציה הראשונה האמיתית — לא wrapper
    // ה-wrappers השתרשרו כך:
    // orig(3294) ← milestones(6412) ← safe/reset(7938) ← title(8011)
    // כל אחד קורא ל-_orig שלו
    // הפתרון: כתוב פונקציה אחת שעושה הכל
    return window.openClientCard; // הנוכחית כבר מכילה את כל ה-chain
})();

// ── פונקציה אחידה שמחליפה את כל ה-wrappers ──
window.openClientCard = function(idx) {
    // 1. אפס temp arrays — תמיד לפני הכל
    _resetAllTemp();

    // 2. קרא לפונקציה הבסיסית (כבר מכילה את milestone + familyStatus)
    _coreOpenClientCard(idx);

    // 3. תקן כותרת עם escapeHTML
    const a = db[currentBldg]?.apts?.[idx];
    const titleEl = document.getElementById('crmFamilyTitle');
    if (titleEl && a) {
        titleEl.innerHTML = `<i class="fas fa-id-card"></i> ${escapeHTML(a.name || 'משפחה חדשה')} <span style="font-size:12px;">${currentBldg === NO_ADDRESS_KEY ? '(ללא כתובת)' : ''}</span>`;
    }
};

// ── פונקציה אחידה לswitchMainView ──
const _coreSwitchMainView = (function() {
    return window.switchMainView; // כבר מכיל tasks + events chains
})();

window.switchMainView = function(viewName) {
    _coreSwitchMainView(viewName);
};

// ── ESC לסגירת כל modal פתוח ──
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;

    const modals = [
        'clientModal', 'buildingModal', 'deceasedModal', 'splitFamilyModal',
        'brandingModal', 'eventTypesModal', 'fieldUpdatesModal',
        'addressSearchModal', 'contactSyncModal'
    ];

    for (const id of modals) {
        const el = document.getElementById(id);
        if (el && el.style.display !== 'none' && el.style.display !== '') {
            el.style.display = 'none';
            // אפס dirty flag אם סוגרים clientModal
            if (id === 'clientModal' && isDirty) {
                isDirty = false;
            }
            break; // סגור רק modal אחד בכל פעם
        }
    }
});

// ── refreshMapIfNeeded — רנדר מחדש רק אם צריך ──
// קורא ל-handleOmniSearch רק אם המפה גלויה או הרשימה גלויה
window.refreshAfterSave = function() {
    if (currentMainView === 'map' || currentMainView === 'table') {
        handleOmniSearch();
    }
};
