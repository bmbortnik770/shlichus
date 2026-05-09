// ========== Smart Tasks & Mentions Engine ==========
if(!db.meta.generalTasks) db.meta.generalTasks = [];
window.currentTaskMentions = [];
let mentionSearchIndex = 0;
let gtInput = null; // יאותחל לאחר טעינת ה-DOM

function initTasksEngine() {
    gtInput = document.getElementById('globalTaskInput');
    if(!gtInput) return;

    gtInput.addEventListener('input', (e) => {
        const val = e.target.value;
        const words = val.split(' ');
        const lastWord = words[words.length - 1];

        if(lastWord.startsWith('@') && lastWord.length > 1) {
            const query = lastWord.substring(1).toLowerCase();
            renderMentionSuggestions(query);
        } else {
            document.getElementById('mentionDropdown').style.display = 'none';
        }
    });

    gtInput.addEventListener('keydown', (e) => {
        const dd = document.getElementById('mentionDropdown');
        if(dd.style.display === 'block') {
            const items = dd.querySelectorAll('.mention-item');
            if(e.key === 'ArrowDown') { e.preventDefault(); mentionSearchIndex = Math.min(mentionSearchIndex + 1, items.length - 1); updateMentionSelection(items); }
            if(e.key === 'ArrowUp') { e.preventDefault(); mentionSearchIndex = Math.max(mentionSearchIndex - 1, 0); updateMentionSelection(items); }
            if(e.key === 'Enter' && items[mentionSearchIndex]) { e.preventDefault(); items[mentionSearchIndex].click(); }
        }
    });
}

// קריאה לאתחול לאחר switchMainView (הטאסק קונטיינר רק אז מרונדר)
const _origSwitchMainView = window.switchMainView;
window.switchMainView = function(viewName) {
    _origSwitchMainView(viewName);
    if(viewName === 'tasks') initTasksEngine();
};

function renderMentionSuggestions(query) {
    const dd = document.getElementById('mentionDropdown');
    if(!dd) return;

    // זיהוי מצב חיפוש ילדים: המשתמש הקליד "ילד ..." או "ילד:"
    const childMode = query.startsWith('ילד');
    const childQuery = childMode ? query.replace(/^ילד[:\s]*/, '').trim() : '';

    let results = [];
    Object.keys(db).forEach(b => {
        if(b==='__BOARDS__' || b==='__SETTINGS__' || b==='meta') return;
        if(!db[b] || !db[b].apts) return;
        db[b].apts.forEach((a, i) => {
            if(childMode) {
                // חיפוש בילדים בלבד
                (a.childrenList || []).forEach((c, ci) => {
                    if(c.name && c.name.toLowerCase().includes(childQuery)) {
                        results.push({ bldg: b, idx: i, name: a.name, matchName: c.name, role: 'ילד', icon: 'fa-child' });
                    }
                });
            } else {
                // ברירת מחדל: שם משפחה, שם אב, שם אם
                const familyMatch = a.name && a.name.toLowerCase().includes(query);
                const fatherMatch = a.father && a.father.toLowerCase().includes(query);
                const motherMatch = a.mother && a.mother.toLowerCase().includes(query);
                if(familyMatch) {
                    results.push({ bldg: b, idx: i, name: a.name, matchName: a.name, role: 'משפחה', icon: 'fa-users' });
                } else if(fatherMatch) {
                    results.push({ bldg: b, idx: i, name: a.name, matchName: a.father, role: 'אב', icon: 'fa-user' });
                } else if(motherMatch) {
                    results.push({ bldg: b, idx: i, name: a.name, matchName: a.mother, role: 'אם', icon: 'fa-user' });
                }
            }
        });
    });

    if(results.length > 0) {
        dd.innerHTML = results.slice(0, 10).map((r, i) => `
            <div class="mention-item ${i===0?'active':''}" onclick="addMention('${encodeURIComponent(r.bldg)}', ${r.idx}, '${escapeHTML(r.name)}')">
                <span><i class="fas ${r.icon}" style="color:var(--text-muted); margin-left:8px;"></i>
                    ${r.matchName !== r.name ? `<span style="opacity:0.6; font-size:12px;">(${escapeHTML(r.role)})</span> ${escapeHTML(r.matchName)} — ` : ''}
                    משפחת ${escapeHTML(r.name)}
                </span>
                <span class="cp-hint">${r.bldg===NO_ADDRESS_KEY?'ללא כתובת':escapeHTML(r.bldg)}</span>
            </div>
        `).join('');
        dd.style.display = 'block';
        mentionSearchIndex = 0;
    } else {
        dd.style.display = 'none';
    }
}

function updateMentionSelection(items) {
    items.forEach(el => el.classList.remove('active'));
    if(items[mentionSearchIndex]) {
        items[mentionSearchIndex].classList.add('active');
        items[mentionSearchIndex].scrollIntoView({ block: 'nearest' });
    }
}

window.addMention = (bEnc, idx, name) => {
    const bldg = decodeURIComponent(bEnc);
    if(!window.currentTaskMentions.find(m => m.bldg === bldg && m.idx === idx)) {
        window.currentTaskMentions.push({ bldg, idx, name });
    }
    if(gtInput) {
        const words = gtInput.value.split(' ');
        words.pop();
        gtInput.value = words.join(' ') + (words.length > 0 ? ' ' : '');
        gtInput.focus();
    }
    const dd = document.getElementById('mentionDropdown');
    if(dd) dd.style.display = 'none';
    renderTaskTags();
};

// סגירת דרופדאון התיוגים (@) אם לוחצים מחוץ לאזור
document.addEventListener('click', (e) => {
    const mentionDd = document.getElementById('mentionDropdown');
    if (mentionDd && mentionDd.style.display === 'block') {
        const taskInput = document.getElementById('globalTaskInput');
        if (e.target !== taskInput && !mentionDd.contains(e.target)) {
            mentionDd.style.display = 'none';
        }
    }
});

function renderTaskTags() {
    const c = document.getElementById('taskTagsContainer');
    if(!c) return;
    c.innerHTML = window.currentTaskMentions.map((m, i) => `
        <span class="task-tag"><i class="fas fa-user-check"></i> עבור ${escapeHTML(m.name)} <i class="fas fa-times" onclick="window.currentTaskMentions.splice(${i},1); renderTaskTags();" title="הסר שיוך"></i></span>
    `).join('');
}

window.saveGlobalTask = () => {
    if(!gtInput) gtInput = document.getElementById('globalTaskInput');
    const text = gtInput ? gtInput.value.trim() : '';
    const dateEl = document.getElementById('globalTaskDate');
    const date = dateEl ? dateEl.value : '';
    if(!text) return showToast('נא להזין את תוכן המשימה קודם', 'warning');

    const taskObj = { text, date, done: false };

    if(window.currentTaskMentions.length > 0) {
        window.currentTaskMentions.forEach(m => {
            if(!db[m.bldg].apts[m.idx].tasks) db[m.bldg].apts[m.idx].tasks = [];
            db[m.bldg].apts[m.idx].tasks.push({...taskObj});
        });
        showToast(`המשימה פוצלה ונוספה ל-${window.currentTaskMentions.length} כרטיסי משפחה!`, 'success');
    } else {
        if(!db.meta.generalTasks) db.meta.generalTasks = [];
        db.meta.generalTasks.push(taskObj);
        showToast('המשימה נשמרה כמשימה כללית ללא שיוך.', 'success');
    }

    if(gtInput) gtInput.value = '';
    window.currentTaskMentions = [];
    renderTaskTags();
    saveDB();
    renderGlobalTasks();
};

window.renderGlobalTasks = () => {
    const c = document.getElementById('globalTasksList');
    if(!c) return;

    let allTasks = [];

    (db.meta.generalTasks || []).forEach((t, i) => {
        if(!t.done) allTasks.push({ ...t, isGeneral: true, idx: i });
    });

    Object.keys(db).forEach(b => {
        if(b==='__BOARDS__' || b==='__SETTINGS__' || b==='meta') return;
        if(!db[b] || !db[b].apts) return;
        db[b].apts.forEach((a, i) => {
            (a.tasks || []).forEach((t, tIdx) => {
                if(!t.done) allTasks.push({ ...t, isGeneral: false, bldg: b, aptIdx: i, taskIdx: tIdx, familyName: a.name });
            });
        });
    });

    allTasks.sort((x, y) => new Date(x.date || '2099-01-01') - new Date(y.date || '2099-01-01'));

    if(allTasks.length === 0) {
        c.innerHTML = '<div class="empty-state modern-empty"><i class="fas fa-glass-cheers" style="font-size:45px;"></i><h4>אין משימות פתוחות!</h4><p>איזה אלוף! הכל נקי ומסודר.</p></div>';
        return;
    }

    c.innerHTML = allTasks.map(t => {
        let clickFn = t.isGeneral
            ? `completeGlobalTask(true, null, null, ${t.idx}, this)`
            : `completeGlobalTask(false, '${encodeURIComponent(t.bldg)}', ${t.aptIdx}, ${t.taskIdx}, this)`;

        let badge = t.isGeneral
            ? `<span class="tag-badge" style="background:var(--border-light); color:var(--text-muted); cursor:default;"><i class="fas fa-globe"></i> משימה כללית</span>`
            : `<span class="tag-badge" style="cursor:pointer;" onclick="currentBldg='${t.bldg}'; openClientCard(${t.aptIdx})"><i class="fas fa-user-circle"></i> ${escapeHTML(t.familyName)} (פתח כרטיס)</span>`;

        let isPastDue = t.date && new Date(t.date) < new Date(new Date().setHours(0,0,0,0));
        let dateColor = isPastDue ? 'var(--danger)' : 'var(--text-muted)';

        return `
        <div class="global-task-row">
            <div style="display:flex; align-items:flex-start; gap:15px; flex:1;">
                <button class="btn-icon" style="background:transparent; border:2px solid var(--border-light); color:transparent; padding:8px 12px; transition:0.2s;" onmouseover="this.style.color='var(--success)';this.style.borderColor='var(--success)';" onmouseout="this.style.color='transparent';this.style.borderColor='var(--border-light)';" onclick="${clickFn}" title="סמן כמבוצע"><i class="fas fa-check"></i></button>
                <div>
                    <div style="font-weight:700; font-size:16px; margin-bottom:6px; color:var(--text-main);">${escapeHTML(t.text)}</div>
                    <div style="display:flex; gap:10px; align-items:center; font-size:13px; flex-wrap:wrap;">
                        ${badge}
                        <span style="color:${dateColor}; font-weight:${isPastDue?'bold':'normal'};"><i class="far fa-calendar-alt"></i> ${t.date || 'ללא תאריך יעד'} ${isPastDue?'(באיחור)':''}</span>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
};

window.completeGlobalTask = (isGeneral, bEnc, aptIdx, tIdx, btnEl) => {
    if(btnEl) {
        btnEl.disabled = true;
        btnEl.closest('.global-task-row').classList.add('task-done-anim');
        btnEl.style.color = 'var(--success)';
        btnEl.style.background = 'rgba(16,185,129,0.1)';
        btnEl.style.borderColor = 'var(--success)';
    }
    setTimeout(() => {
        if(isGeneral) {
            db.meta.generalTasks[tIdx].done = true;
        } else {
            const bldg = decodeURIComponent(bEnc);
            db[bldg].apts[aptIdx].tasks[tIdx].done = true;
        }
        saveDB();
        showToast('המשימה הושלמה וירדה מהדאשבורד!', 'success');
        renderGlobalTasks();
    }, 500);
};


// ════════════════════════════════════════════════════════
