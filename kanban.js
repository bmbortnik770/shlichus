window.createNewBoard = async () => {
    const name = await showCustomDialog({ title: 'פרויקט חדש', message: 'הכנס שם לפרויקט החדש (למשל: רישום לקייטנה):', showInput: true });
    if(!name) return;
    const newId = 'b_' + Date.now();
    db.__BOARDS__.push({ id: newId, name: name, columns: ['חדש', 'בטיפול', 'הושלם'], archived: false });
    saveDB(); showToast("פרויקט נפתח בהצלחה! " + getRandomCompliment(), "success"); renderKanbanView();
};
window.editCurrentBoard = async () => {
    const sel = document.getElementById('activeKanbanBoard'); const bId = sel.value;
    const board = db.__BOARDS__.find(b => b.id === bId);
    if(!board) return;
    const cols = await showCustomDialog({ title: 'עריכת עמודות', message: `ערוך עמודות לפרויקט "${board.name}" (הפרד בפסיק):`, showInput: true, defaultValue: board.columns.join(', ') });
    if(cols) { board.columns = cols.split(',').map(c => c.trim()); saveDB(); renderKanbanView(); showToast("עמודות עודכנו", "success"); }
};
window.toggleBoardArchive = (id) => {
    let b = db.__BOARDS__.find(x => x.id === id);
    b.archived = !b.archived;
    saveDB(); renderKanbanView();
    showToast(b.archived ? "הפרויקט ננעל והועבר לארכיון" : "הפרויקט שוחזר לפעילות", "success");
};
window.deleteBoard = async (id) => {
    const proceed = await showCustomDialog({ title: 'מחיקת פרויקט', message: 'האם למחוק את הפרויקט לחלוטין? (הפעולה לא תמחק את המשפחות, אלא רק את הלוח)', showCancel: true });
    if(proceed) {
        db.__BOARDS__ = db.__BOARDS__.filter(x => x.id !== id);
        Object.keys(db).forEach(bldg => {
           if(bldg !== '__BOARDS__' && bldg !== '__SETTINGS__' && bldg !== 'meta' && db[bldg] && db[bldg].apts) { db[bldg].apts.forEach(a => { if(a.boards && a.boards[id]) delete a.boards[id]; }); }
        });
        saveDB(); renderKanbanView(); showToast("הפרויקט נמחק לצמיתות", "success");
    }
};

window.renderKanbanView = (filteredRes = null) => {
    const sel = document.getElementById('activeKanbanBoard');
    let currentBoardId = sel.value;

    let activeOptions = db.__BOARDS__.filter(b=>!b.archived).map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    let archivedOptions = db.__BOARDS__.filter(b=>b.archived).map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    sel.innerHTML = `<optgroup label="פרויקטים פעילים">${activeOptions}</optgroup><optgroup label="ארכיון (סגורים)">${archivedOptions}</optgroup>`;

    if(currentBoardId && db.__BOARDS__.find(b=>b.id===currentBoardId)) sel.value = currentBoardId;
    else currentBoardId = db.__BOARDS__[0].id;

    const activeBoard = db.__BOARDS__.find(b => b.id === currentBoardId);

    if (!activeBoard) {
        document.getElementById('activeKanbanBoard').value = 'b_default';
        return renderKanbanView(filteredRes);
    }

    const actionsSpan = document.getElementById('kanbanBoardActions');
    if(activeBoard.id === 'b_default') {
         actionsSpan.innerHTML = `<button class="btn-icon" onclick="editCurrentBoard()"><i class="fas fa-cog"></i> ערוך עמודות</button> <span class="tag-badge" style="background:#e2e8f0; color:#64748b; border:none; margin-right:10px;"><i class="fas fa-lock"></i> מוגן</span>`;
    } else if(activeBoard.archived) {
         actionsSpan.innerHTML = `<span class="tag-badge" style="background:rgba(239,68,68,0.1); color:var(--danger); border:none; margin-left:10px;"><i class="fas fa-archive"></i> בארכיון</span><button class="btn-icon" onclick="toggleBoardArchive('${activeBoard.id}')" title="שחזר פרויקט"><i class="fas fa-unlock"></i> שחזר</button><button class="btn-icon" style="color:var(--danger);" onclick="deleteBoard('${activeBoard.id}')" title="מחק פרויקט"><i class="fas fa-trash"></i></button>`;
    } else {
         actionsSpan.innerHTML = `<button class="btn-icon" onclick="editCurrentBoard()"><i class="fas fa-cog"></i> ערוך עמודות</button><button class="btn-icon" onclick="toggleBoardArchive('${activeBoard.id}')" title="נעל והעבר לארכיון"><i class="fas fa-archive"></i> לארכיון</button><button class="btn-icon" style="color:var(--danger);" onclick="deleteBoard('${activeBoard.id}')" title="מחק פרויקט"><i class="fas fa-trash"></i></button>`;
    }

    const c = document.getElementById('kanban-board-scroll');
    c.innerHTML = '';
    if(!activeBoard) return;

    let arr = filteredRes || [];
    if(!filteredRes) Object.keys(db).forEach(b=>{ if(b!=='__BOARDS__' && b!=='__SETTINGS__' && b!=='meta' && db[b] && db[b].apts) db[b].apts.forEach((a,i)=>arr.push({bldg:b,idx:i,apt:a})) });

    // ── DESKTOP: original columns ──
    activeBoard.columns.forEach(stage => {
        let colCards = arr.filter(r => r.apt.boards && r.apt.boards[currentBoardId] === stage);
        let colHtml = `<div class="kanban-col" data-stage="${escapeHTML(stage)}" ondragover="allowDrop(event)" ondragleave="dragLeave(event)" ondrop="dropCard(event, '${stage}')"><div class="kanban-header">${escapeHTML(stage)} <span style="background:rgba(0,0,0,0.2);padding:2px 8px;border-radius:12px;font-size:12px;">${colCards.length}</span></div><div class="kanban-body">`;
        colCards.forEach(r => {
            const safeName = escapeHTML(r.apt.name || 'ללא שם');
            const safeBldg = escapeHTML(r.bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : r.bldg);
            colHtml += `<div class="kanban-card" data-enc-bldg="${encodeURIComponent(r.bldg)}" data-idx="${r.idx}" draggable="true" ondragstart="dragCard(event, '${encodeURIComponent(r.bldg)}', ${r.idx})" onclick="currentBldg='${r.bldg}'; openClientCard(${r.idx})"><div class="kanban-card-title">${safeName}</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:5px;">${safeBldg}</div></div>`;
        });
        c.innerHTML += colHtml + `</div></div>`;
    });

    c.querySelectorAll('.kanban-card').forEach(cardEl => {
        const encBldg = cardEl.getAttribute('data-enc-bldg');
        const idx = cardEl.getAttribute('data-idx');
        if(encBldg !== null && idx !== null) initTouchDrag(cardEl, encBldg, parseInt(idx));
    });
};

// Stage picker for mobile kanban
window.openStagePicker = function(encBldg, idx, boardId, currentStage) {
    const bldg = decodeURIComponent(encBldg);
    const board = db.__BOARDS__.find(b => b.id === boardId);
    if (!board) return;

    const list = document.getElementById('stagePickerList');
    const modal = document.getElementById('stagePickerModal');
    if (!list || !modal) return;

    list.innerHTML = board.columns.map(stage => `
        <button class="stage-picker-btn ${stage === currentStage ? 'current' : ''}"
            onclick="moveToStage('${encBldg}', ${idx}, '${boardId}', '${escapeHTML(stage)}')">
            ${stage === currentStage ? '<i class="fas fa-check" style="margin-left:8px; color:var(--accent);"></i>' : ''}
            ${escapeHTML(stage)}
        </button>
    `).join('');

    modal.style.display = 'flex';
};

window.moveToStage = function(encBldg, idx, boardId, stage) {
    const bldg = decodeURIComponent(encBldg);
    if (!db[bldg] || !db[bldg].apts[idx]) return;
    if (!db[bldg].apts[idx].boards) db[bldg].apts[idx].boards = {};
    db[bldg].apts[idx].boards[boardId] = stage;
    saveDB();
    showToast('הועבר ל-' + stage, 'success');
    if (window.haptic) haptic('medium');
    document.getElementById('stagePickerModal').style.display = 'none';
    renderKanbanView();
};

window.allowDrop = (e) => { 
    const activeBoard = db.__BOARDS__.find(b => b.id === document.getElementById('activeKanbanBoard').value);
    if(activeBoard && activeBoard.archived) return; 
    e.preventDefault(); e.currentTarget.classList.add('drag-over'); 
};
window.dragLeave = (e) => { e.currentTarget.classList.remove('drag-over'); };
window.dragCard = (e, encBldg, idx) => { 
    const activeBoard = db.__BOARDS__.find(b => b.id === document.getElementById('activeKanbanBoard').value);
    if(activeBoard && activeBoard.archived) { e.preventDefault(); return; } 
    e.dataTransfer.setData("text/plain", `${encBldg}|${idx}`); e.dataTransfer.effectAllowed = "move"; 
};
window.dropCard = (e, stage) => {
    e.preventDefault(); e.currentTarget.classList.remove('drag-over');
    const data = e.dataTransfer.getData("text/plain");
    if(data) {
        const [encBldg, idx] = data.split('|'); const bldg = decodeURIComponent(encBldg);
        const activeBoardId = document.getElementById('activeKanbanBoard').value;
        if(!db[bldg]?.apts[idx]) return;
        if(!db[bldg].apts[idx].boards) db[bldg].apts[idx].boards = {};
        db[bldg].apts[idx].boards[activeBoardId] = stage;
        saveDB(); showToast(`הועבר ל-${stage}`, 'info');
    }
};

// --- גרירה במגע (Touch Drag & Drop) ---
let touchDragData = null, touchGhost = null;

function initTouchDrag(cardEl, encBldg, idx) {
    cardEl.addEventListener('touchstart', (e) => {
        const activeBoard = db.__BOARDS__.find(b => b.id === document.getElementById('activeKanbanBoard').value);
        if(activeBoard && activeBoard.archived) return;

        touchDragData = { encBldg, idx };

        // יצירת "רוח רפאים" שזזה עם האצבע
        touchGhost = cardEl.cloneNode(true);
        touchGhost.style.cssText = `position:fixed; opacity:0.75; pointer-events:none; z-index:9999; width:${cardEl.offsetWidth}px; transform:rotate(2deg); box-shadow:0 8px 24px rgba(0,0,0,0.25);`;
        document.body.appendChild(touchGhost);
    }, { passive: true });

    cardEl.addEventListener('touchmove', (e) => {
        if(!touchDragData) return;
        e.preventDefault();
        const t = e.touches[0];
        touchGhost.style.left = (t.clientX - touchGhost.offsetWidth / 2) + 'px';
        touchGhost.style.top  = (t.clientY - 30) + 'px';

        // הדגשת העמודה שמתחת לאצבע
        document.querySelectorAll('.kanban-col').forEach(col => col.classList.remove('drag-over'));
        touchGhost.style.display = 'none';
        const elBelow = document.elementFromPoint(t.clientX, t.clientY);
        touchGhost.style.display = '';
        const col = elBelow && elBelow.closest('.kanban-col');
        if(col) col.classList.add('drag-over');
    }, { passive: false });

    cardEl.addEventListener('touchend', (e) => {
        if(!touchDragData) return;
        const t = e.changedTouches[0];

        // הסרת הדגשות
        document.querySelectorAll('.kanban-col').forEach(col => col.classList.remove('drag-over'));
        if(touchGhost) { touchGhost.remove(); touchGhost = null; }

        // זיהוי העמודה שעליה שוחררה הכרטיסייה
        const elBelow = document.elementFromPoint(t.clientX, t.clientY);
        const targetCol = elBelow && elBelow.closest('.kanban-col');
        if(targetCol && targetCol.dataset.stage) {
            const bldg = decodeURIComponent(touchDragData.encBldg);
            const activeBoardId = document.getElementById('activeKanbanBoard').value;
            db[bldg].apts[touchDragData.idx].boards[activeBoardId] = targetCol.dataset.stage;
            saveDB();
            renderKanbanView();
            showToast(`הועבר ל-${targetCol.dataset.stage}`, 'info');
        }
        touchDragData = null;
    });
}

