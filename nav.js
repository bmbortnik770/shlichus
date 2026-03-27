// ==================== מנוע ניווט חכם ====================
// nav.js — מודול ניווט עצמאי למערכת ניהול קהילה

window.NavModule = (() => {

  // ===== מצב הניווט =====
  let state = {
    active: false,
    route: [],        // [{ bldg, aptIdx, familyName, address, coords, tasks:[], status: 'pending'|'done'|'no_answer'|'later'|'skipped' }]
    currentStop: 0,
    watchId: null,
    userCoords: null,
    startTime: null,
    editMode: false,
  };

  // ===== פונקציות עזר =====
  function deg2rad(d) { return d * Math.PI / 180; }

  function haversine(c1, c2) {
    if (!c1 || !c2) return Infinity;
    const R = 6371000;
    const dLat = deg2rad(c2[1] - c1[1]);
    const dLon = deg2rad(c2[0] - c1[0]);
    const a = Math.sin(dLat/2)**2 + Math.cos(deg2rad(c1[1]))*Math.cos(deg2rad(c2[1]))*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // מיון גריידי nearest-neighbor מנקודת המוצא
  function greedySort(stops, origin) {
    if (!stops.length) return [];
    let sorted = [], remaining = [...stops], cur = origin || (stops[0] && stops[0].coords);
    while (remaining.length) {
      remaining.sort((a, b) => haversine(cur, a.coords) - haversine(cur, b.coords));
      sorted.push(remaining.shift());
      cur = sorted[sorted.length-1].coords;
    }
    return sorted;
  }

  // ===== בניית מסלול =====
  function buildRoute(familyList, smartSort = true) {
    // familyList: [{bldg, aptIdx}]
    const stops = familyList.map(f => {
      const apt = db[f.bldg] && db[f.bldg].apts[f.aptIdx];
      if (!apt) return null;
      const coords = db[f.bldg].info && db[f.bldg].info.coords;
      const tasks = (apt.tasks || []).filter(t => !t.done).map((t, ti) => ({
        idx: ti,
        text: t.text,
        date: t.date,
        done: false
      }));
      return {
        bldg: f.bldg,
        aptIdx: f.aptIdx,
        familyName: apt.name || '(ללא שם)',
        address: f.bldg !== NO_ADDRESS_KEY ? f.bldg : 'ללא כתובת',
        coords: coords || null,
        tasks,
        status: 'pending',
        note: ''
      };
    }).filter(Boolean);

    const origin = (appSettings.homeLocation && appSettings.homeLocation.coords) || state.userCoords || null;
    state.route = smartSort ? greedySort(stops, origin) : stops;
    state.currentStop = 0;
    return state.route;
  }

  // ===== הפעלת מסלול =====
  function startNavigation() {
    state.active = true;
    state.startTime = Date.now();
    state.currentStop = state.route.findIndex(s => s.status === 'pending');
    if (state.currentStop < 0) state.currentStop = 0;
    startGPS();
    renderNavUI();
    showNavPanel();
  }

  function stopNavigation() {
    state.active = false;
    stopGPS();
    hideNavPanel();
  }

  // ===== GPS =====
  function startGPS() {
    if (!navigator.geolocation) return;
    state.watchId = navigator.geolocation.watchPosition(
      pos => {
        state.userCoords = [pos.coords.longitude, pos.coords.latitude];
        updateDistanceIndicator();
      },
      err => console.warn('GPS:', err),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }

  function stopGPS() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
  }

  function updateDistanceIndicator() {
    const stop = state.route[state.currentStop];
    if (!stop || !state.userCoords || !stop.coords) return;
    const dist = haversine(state.userCoords, stop.coords);
    const el = document.getElementById('nav-distance');
    if (!el) return;
    el.textContent = dist < 1000 ? `${Math.round(dist)} מ'` : `${(dist/1000).toFixed(1)} ק"מ`;
    el.style.color = dist < 100 ? 'var(--success)' : 'var(--text-main)';
  }

  // ===== פעולות על תחנות =====
  function markStopStatus(stopIdx, status) {
    const stop = state.route[stopIdx];
    if (!stop) return;
    stop.status = status;

    // עדכון DB אם "בוצע"
    if (status === 'done') {
      const apt = db[stop.bldg] && db[stop.bldg].apts[stop.aptIdx];
      if (apt) {
        // סמן כל משימות התחנה כבוצעות
        stop.tasks.forEach(navTask => {
          if (navTask.done && apt.tasks && apt.tasks[navTask.idx]) {
            apt.tasks[navTask.idx].done = true;
          }
        });
        // עדכן אינטראקציה אחרונה
        if (!apt.interactions) apt.interactions = [];
        apt.interactions.push({ date: new Date().toISOString().split('T')[0], type: 'ביקור', note: stop.note || 'ביקור במסלול' });
        apt.lastContact = new Date().toISOString().split('T')[0];
      }
      if (typeof saveDB === 'function') saveDB();
    }

    // קדם לתחנה הבאה
    if (status !== 'pending') {
      advanceToNext();
    }
    renderNavUI();
  }

  function markTaskInNav(stopIdx, taskLocalIdx, done) {
    const stop = state.route[stopIdx];
    if (!stop || !stop.tasks[taskLocalIdx]) return;
    stop.tasks[taskLocalIdx].done = done;
    renderNavUI();
  }

  function skipStop(stopIdx) {
    state.route[stopIdx].status = 'skipped';
    advanceToNext();
    renderNavUI();
  }

  function removeStopFromRoute(stopIdx) {
    state.route.splice(stopIdx, 1);
    if (state.currentStop >= state.route.length) state.currentStop = Math.max(0, state.route.length - 1);
    renderNavUI();
  }

  function advanceToNext() {
    const next = state.route.findIndex((s, i) => i > state.currentStop && s.status === 'pending');
    if (next >= 0) {
      state.currentStop = next;
    } else {
      // בדוק אם יש בכלל תחנות פתוחות
      const anyPending = state.route.findIndex(s => s.status === 'pending');
      if (anyPending >= 0) {
        state.currentStop = anyPending;
      } else {
        // סוף מסלול
        showRouteComplete();
      }
    }
  }

  function addStopToRoute(bldg, aptIdx) {
    const apt = db[bldg] && db[bldg].apts[aptIdx];
    if (!apt) return;
    const existing = state.route.findIndex(s => s.bldg === bldg && s.aptIdx === aptIdx);
    if (existing >= 0) {
      showToast('תחנה זו כבר נמצאת במסלול', 'warning');
      return;
    }
    const coords = db[bldg].info && db[bldg].info.coords;
    const tasks = (apt.tasks || []).filter(t => !t.done).map((t, ti) => ({ idx: ti, text: t.text, date: t.date, done: false }));
    const stop = { bldg, aptIdx, familyName: apt.name || '(ללא שם)', address: bldg !== NO_ADDRESS_KEY ? bldg : 'ללא כתובת', coords, tasks, status: 'pending', note: '' };
    state.route.push(stop);
    renderNavUI();
    showToast(`✅ ${apt.name} נוספה למסלול`, 'success');
  }

  // ===== ייצוא לניווט חיצוני =====
  function openExternalNav(stop) {
    if (!stop || !stop.coords) { showToast('אין קואורדינטות לתחנה', 'warning'); return; }
    const [lng, lat] = stop.coords;
    const wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
    window.open(wazeUrl, '_blank');
  }

  // ===== ממשק =====

  function showNavPanel() {
    let panel = document.getElementById('nav-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'nav-panel';
      document.body.appendChild(panel);
    }
    panel.style.display = 'flex';
    renderNavUI();
  }

  function hideNavPanel() {
    const panel = document.getElementById('nav-panel');
    if (panel) panel.style.display = 'none';
  }

  function renderNavUI() {
    const panel = document.getElementById('nav-panel');
    if (!panel || !state.active) return;

    const total = state.route.length;
    const done = state.route.filter(s => s.status === 'done').length;
    const skipped = state.route.filter(s => s.status === 'skipped').length;
    const pending = state.route.filter(s => s.status === 'pending').length;

    const stop = state.route[state.currentStop];
    const elapsed = state.startTime ? Math.floor((Date.now() - state.startTime) / 60000) : 0;

    panel.innerHTML = `
      <div class="nav-header">
        <div class="nav-header-top">
          <div class="nav-title"><i class="fas fa-route"></i> מסלול פעיל</div>
          <div class="nav-stats">
            <span class="nav-stat-done"><i class="fas fa-check-circle"></i> ${done}</span>
            <span class="nav-stat-pending"><i class="fas fa-clock"></i> ${pending}</span>
            ${skipped ? `<span class="nav-stat-skip"><i class="fas fa-forward"></i> ${skipped}</span>` : ''}
            <span class="nav-stat-time"><i class="fas fa-stopwatch"></i> ${elapsed} דק'</span>
          </div>
          <div class="nav-header-actions">
            <button class="nav-icon-btn" onclick="NavModule.toggleEditMode()" title="עריכת מסלול"><i class="fas fa-${state.editMode ? 'map-marker-alt' : 'list-ol'}"></i></button>
            <button class="nav-icon-btn nav-icon-btn-danger" onclick="NavModule.confirmStop()" title="סיים מסלול"><i class="fas fa-flag-checkered"></i></button>
          </div>
        </div>
        <div class="nav-progress-bar"><div class="nav-progress-fill" style="width:${total ? Math.round(done/total*100) : 0}%"></div></div>
      </div>

      <div class="nav-body">
        ${state.editMode ? renderEditMode() : renderActiveStop(stop)}
      </div>

      <div class="nav-footer">
        <button class="nav-add-stop-btn" onclick="NavModule.openAddStopSearch()">
          <i class="fas fa-plus-circle"></i> הוסף תחנה למסלול
        </button>
      </div>
    `;
  }

  function renderActiveStop(stop) {
    if (!stop) {
      return `<div class="nav-empty-state"><i class="fas fa-flag-checkered" style="font-size:40px;color:var(--success);"></i><div>כל התחנות טופלו!</div><button class="nav-btn nav-btn-success" onclick="NavModule.confirmStop()">סיים מסלול</button></div>`;
    }

    const pendingBefore = state.route.slice(0, state.currentStop).filter(s => s.status === 'pending').length;
    const stopNum = state.currentStop + 1;
    const total = state.route.length;

    const tasksHtml = stop.tasks.length ? `
      <div class="nav-tasks-section">
        <div class="nav-tasks-title"><i class="fas fa-tasks"></i> משימות בתחנה:</div>
        ${stop.tasks.map((t, ti) => `
          <label class="nav-task-item ${t.done ? 'done' : ''}">
            <input type="checkbox" ${t.done ? 'checked' : ''} onchange="NavModule.markTaskInNav(${state.currentStop}, ${ti}, this.checked)">
            <span>${escapeHTML(t.text)}</span>
            ${t.date ? `<small style="color:var(--text-muted); margin-right:auto;">${t.date}</small>` : ''}
          </label>
        `).join('')}
      </div>
    ` : '';

    const noteHtml = `
      <div class="nav-note-section">
        <input class="nav-note-input" type="text" placeholder="הוסף הערה לביקור..." value="${escapeHTML(stop.note||'')}"
          oninput="NavModule.updateStopNote(${state.currentStop}, this.value)">
      </div>
    `;

    return `
      <div class="nav-stop-card">
        <div class="nav-stop-badge">${stopNum} / ${total}</div>
        <div class="nav-stop-name">${escapeHTML(stop.familyName)}</div>
        <div class="nav-stop-address"><i class="fas fa-map-marker-alt"></i> ${escapeHTML(stop.address)}</div>
        <div class="nav-stop-distance" id="nav-distance">${stop.coords ? '...' : 'אין קואורדינטות'}</div>

        <div class="nav-stop-nav-btns">
          <button class="nav-nav-btn" onclick="NavModule.openExternalNav(${state.currentStop})">
            <i class="fab fa-waze" style="color:#33ccff;"></i> Waze
          </button>
          <button class="nav-nav-btn" onclick="NavModule.openGoogleMaps(${state.currentStop})">
            <i class="fas fa-map" style="color:#4285F4;"></i> Maps
          </button>
          <button class="nav-nav-btn" onclick="NavModule.openClientCardFromNav(${state.currentStop})">
            <i class="fas fa-user-circle"></i> כרטיס
          </button>
        </div>

        ${tasksHtml}
        ${noteHtml}

        <div class="nav-action-btns">
          <button class="nav-btn nav-btn-success" onclick="NavModule.markStopStatus(${state.currentStop}, 'done')">
            <i class="fas fa-check-circle"></i> בוצע!
          </button>
          <button class="nav-btn nav-btn-warning" onclick="NavModule.markStopStatus(${state.currentStop}, 'no_answer')">
            <i class="fas fa-phone-slash"></i> אין מענה
          </button>
          <button class="nav-btn nav-btn-info" onclick="NavModule.markStopStatus(${state.currentStop}, 'later')">
            <i class="fas fa-clock"></i> לחזור מאוחר יותר
          </button>
        </div>
        <div class="nav-secondary-btns">
          <button class="nav-skip-btn" onclick="NavModule.skipStop(${state.currentStop})">
            <i class="fas fa-forward"></i> דלג
          </button>
          <button class="nav-remove-btn" onclick="NavModule.removeStopFromRoute(${state.currentStop})">
            <i class="fas fa-trash-alt"></i> הסר מהמסלול
          </button>
        </div>
      </div>

      ${renderMiniStopList()}
    `;
  }

  function renderMiniStopList() {
    const mini = state.route.map((s, i) => {
      const icon = s.status === 'done' ? '✅' : s.status === 'no_answer' ? '📵' : s.status === 'later' ? '⏰' : s.status === 'skipped' ? '⏭' : i === state.currentStop ? '📍' : '⭕';
      const active = i === state.currentStop ? ' nav-mini-active' : '';
      const done = s.status !== 'pending' ? ' nav-mini-done' : '';
      return `<div class="nav-mini-stop${active}${done}" onclick="NavModule.jumpToStop(${i})">
        <span class="nav-mini-icon">${icon}</span>
        <span class="nav-mini-name">${escapeHTML(s.familyName)}</span>
      </div>`;
    }).join('');
    return `<div class="nav-mini-list">${mini}</div>`;
  }

  function renderEditMode() {
    return `
      <div class="nav-edit-header"><i class="fas fa-list-ol"></i> עריכת סדר תחנות</div>
      <div class="nav-edit-list" id="nav-edit-list">
        ${state.route.map((s, i) => `
          <div class="nav-edit-stop" data-idx="${i}">
            <div class="nav-edit-drag"><i class="fas fa-grip-vertical"></i></div>
            <div class="nav-edit-info">
              <div class="nav-edit-name">${escapeHTML(s.familyName)}</div>
              <div class="nav-edit-addr">${escapeHTML(s.address)}</div>
            </div>
            <div class="nav-edit-status nav-status-${s.status}">${statusLabel(s.status)}</div>
            <button class="nav-edit-remove" onclick="NavModule.removeStopFromRoute(${i})" title="הסר"><i class="fas fa-times"></i></button>
          </div>
        `).join('')}
      </div>
      <button class="nav-resort-btn" onclick="NavModule.resortRoute()">
        <i class="fas fa-magic"></i> מיין מחדש (הכי חכם)
      </button>
    `;
  }

  function statusLabel(s) {
    return { pending: 'ממתין', done: 'בוצע', no_answer: 'אין מענה', later: 'מאוחר יותר', skipped: 'דולג' }[s] || s;
  }

  // ===== מסך בחירת משפחות לפני ניווט =====
  function openRoutePlannerModal() {
    let modal = document.getElementById('nav-planner-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'nav-planner-modal';
      modal.className = 'modal';
      document.body.appendChild(modal);
    }

    // איסוף כל המשפחות עם משימות פתוחות
    const familiesWithTasks = [];
    const familiesNoTasks = [];

    Object.keys(db).forEach(b => {
      if (b === '__BOARDS__' || b === '__SETTINGS__' || b === 'meta') return;
      if (!db[b] || !db[b].apts) return;
      db[b].apts.forEach((a, i) => {
        const openTasks = (a.tasks || []).filter(t => !t.done).length;
        const entry = { bldg: b, aptIdx: i, name: a.name || '(ללא שם)', address: b !== NO_ADDRESS_KEY ? b : 'ללא כתובת', openTasks };
        if (openTasks > 0) familiesWithTasks.push(entry);
        else familiesNoTasks.push(entry);
      });
    });

    modal.innerHTML = `
      <div class="modal-content nav-planner-content">
        <div class="nav-planner-header">
          <h3><i class="fas fa-route" style="color:var(--accent);"></i> תכנון מסלול חדש</h3>
          <button class="btn-icon" onclick="document.getElementById('nav-planner-modal').style.display='none'" style="font-size:18px;"><i class="fas fa-times"></i></button>
        </div>

        <div class="nav-planner-search">
          <i class="fas fa-search"></i>
          <input id="nav-planner-search" type="text" placeholder="חיפוש משפחה..." oninput="NavModule.filterPlannerList(this.value)">
        </div>

        <div class="nav-planner-quick-btns">
          <button class="nav-quick-btn" onclick="NavModule.selectAllWithTasks()">
            <i class="fas fa-tasks"></i> בחר הכל עם משימות (${familiesWithTasks.length})
          </button>
          <button class="nav-quick-btn" onclick="NavModule.clearPlannerSelection()">
            <i class="fas fa-times-circle"></i> נקה בחירה
          </button>
        </div>

        <div class="nav-planner-sections">
          ${familiesWithTasks.length ? `
            <div class="nav-planner-section-title"><i class="fas fa-exclamation-circle" style="color:var(--warning);"></i> משפחות עם משימות פתוחות</div>
            <div id="nav-planner-list-tasks" class="nav-planner-list">
              ${familiesWithTasks.map(f => renderPlannerItem(f)).join('')}
            </div>
          ` : ''}
          <div class="nav-planner-section-title" style="margin-top:12px;"><i class="fas fa-users" style="color:var(--text-muted);"></i> כל שאר המשפחות</div>
          <div id="nav-planner-list-all" class="nav-planner-list">
            ${familiesNoTasks.map(f => renderPlannerItem(f)).join('')}
          </div>
        </div>

        <div class="nav-planner-footer">
          <label class="nav-planner-sort-label">
            <input type="checkbox" id="nav-smart-sort" checked>
            <i class="fas fa-magic"></i> מיון חכם לפי מרחק
          </label>
          <div class="nav-selected-count" id="nav-selected-count">0 נבחרו</div>
          <button class="nav-start-btn" onclick="NavModule.launchFromPlanner()">
            <i class="fas fa-play-circle"></i> התחל מסלול
          </button>
        </div>
      </div>
    `;
    modal.style.display = 'flex';
    window._navPlannerFamilies = { withTasks: familiesWithTasks, noTasks: familiesNoTasks };
    window._navSelectedFamilies = new Set();
  }

  function renderPlannerItem(f) {
    return `
      <label class="nav-planner-item" data-bldg="${encodeURIComponent(f.bldg)}" data-idx="${f.aptIdx}">
        <input type="checkbox" class="nav-planner-check" 
          data-bldg="${encodeURIComponent(f.bldg)}" data-apt="${f.aptIdx}"
          onchange="NavModule.togglePlannerSelection('${encodeURIComponent(f.bldg)}', ${f.aptIdx}, this.checked)">
        <div class="nav-planner-item-info">
          <div class="nav-planner-item-name">${escapeHTML(f.name)}</div>
          <div class="nav-planner-item-addr">${escapeHTML(f.address)}</div>
        </div>
        ${f.openTasks ? `<span class="nav-task-badge">${f.openTasks} <i class="fas fa-tasks"></i></span>` : ''}
      </label>
    `;
  }

  // ===== אירועי תכנון =====
  window.NavModule = {
    openRoutePlannerModal,
    startNavigation,
    stopNavigation,
    buildRoute,
    addStopToRoute,
    markStopStatus,
    markTaskInNav,
    skipStop,
    removeStopFromRoute,
    openExternalNav: (idx) => openExternalNav(state.route[idx]),
    openGoogleMaps: (idx) => {
      const s = state.route[idx];
      if (!s || !s.coords) return;
      window.open(`https://maps.google.com/?q=${s.coords[1]},${s.coords[0]}`, '_blank');
    },
    openClientCardFromNav: (idx) => {
      const s = state.route[idx];
      if (!s) return;
      currentBldg = s.bldg;
      currentAptIdx = s.aptIdx;
      openClientCard(s.aptIdx);
    },
    updateStopNote: (idx, val) => { if (state.route[idx]) state.route[idx].note = val; },
    jumpToStop: (idx) => { state.currentStop = idx; renderNavUI(); },
    toggleEditMode: () => { state.editMode = !state.editMode; renderNavUI(); },
    resortRoute: () => {
      const origin = (appSettings.homeLocation && appSettings.homeLocation.coords) || state.userCoords;
      const pending = state.route.filter(s => s.status === 'pending');
      const done = state.route.filter(s => s.status !== 'pending');
      state.route = [...done, ...greedySort(pending, origin)];
      state.currentStop = state.route.findIndex(s => s.status === 'pending');
      if (state.currentStop < 0) state.currentStop = 0;
      renderNavUI();
      showToast('המסלול מוין מחדש לפי מרחק 🗺', 'success');
    },
    confirmStop: async () => {
      const done = state.route.filter(s => s.status === 'done').length;
      const pending = state.route.filter(s => s.status === 'pending').length;
      const msg = pending > 0
        ? `נשארו ${pending} תחנות פתוחות. האם לסיים את המסלול?`
        : `המסלול הסתיים! ביקרת ב-${done} תחנות. מעולה! 🏆`;
      const ok = await showCustomDialog({ title: 'סיום מסלול', message: msg, showCancel: pending > 0 });
      if (!ok && pending > 0) return;
      stopNavigation();
      showToast(`מסלול הסתיים! ✅ ${done} תחנות בוצעו`, 'success');
      if (typeof refreshMap === 'function') refreshMap();
    },
    togglePlannerSelection: (bldgEnc, aptIdx, checked) => {
      const key = `${bldgEnc}__${aptIdx}`;
      if (checked) window._navSelectedFamilies.add(key);
      else window._navSelectedFamilies.delete(key);
      const cnt = document.getElementById('nav-selected-count');
      if (cnt) cnt.textContent = `${window._navSelectedFamilies.size} נבחרו`;
    },
    selectAllWithTasks: () => {
      const pf = window._navPlannerFamilies;
      if (!pf) return;
      pf.withTasks.forEach(f => {
        const key = `${encodeURIComponent(f.bldg)}__${f.aptIdx}`;
        window._navSelectedFamilies.add(key);
      });
      document.querySelectorAll('#nav-planner-list-tasks .nav-planner-check').forEach(cb => cb.checked = true);
      const cnt = document.getElementById('nav-selected-count');
      if (cnt) cnt.textContent = `${window._navSelectedFamilies.size} נבחרו`;
    },
    clearPlannerSelection: () => {
      window._navSelectedFamilies = new Set();
      document.querySelectorAll('.nav-planner-check').forEach(cb => cb.checked = false);
      const cnt = document.getElementById('nav-selected-count');
      if (cnt) cnt.textContent = '0 נבחרו';
    },
    filterPlannerList: (q) => {
      const lower = q.toLowerCase();
      document.querySelectorAll('.nav-planner-item').forEach(el => {
        const name = el.querySelector('.nav-planner-item-name')?.textContent.toLowerCase() || '';
        const addr = el.querySelector('.nav-planner-item-addr')?.textContent.toLowerCase() || '';
        el.style.display = (!q || name.includes(lower) || addr.includes(lower)) ? '' : 'none';
      });
    },
    launchFromPlanner: () => {
      const selected = window._navSelectedFamilies;
      if (!selected || selected.size === 0) {
        showToast('יש לבחור לפחות משפחה אחת', 'warning');
        return;
      }
      const smartSort = document.getElementById('nav-smart-sort')?.checked !== false;
      const familyList = Array.from(selected).map(key => {
        const [bldgEnc, aptIdx] = key.split('__');
        return { bldg: decodeURIComponent(bldgEnc), aptIdx: parseInt(aptIdx) };
      });
      document.getElementById('nav-planner-modal').style.display = 'none';
      buildRoute(familyList, smartSort);
      startNavigation();
    },
    openAddStopSearch: () => {
      const modal = document.getElementById('nav-add-stop-modal');
      if (!modal) {
        const m = document.createElement('div');
        m.id = 'nav-add-stop-modal';
        m.className = 'modal';
        m.innerHTML = `
          <div class="modal-content" style="max-width:500px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
              <h3 style="margin:0;color:var(--accent);"><i class="fas fa-plus-circle"></i> הוסף תחנה למסלול</h3>
              <button class="btn-icon" onclick="document.getElementById('nav-add-stop-modal').style.display='none'"><i class="fas fa-times"></i></button>
            </div>
            <div class="search-wrapper" style="margin-bottom:15px;">
              <i class="fas fa-search"></i>
              <input type="text" id="nav-add-stop-search" placeholder="חפש משפחה..." oninput="NavModule._searchAddStop(this.value)" autocomplete="off">
            </div>
            <div id="nav-add-stop-results" style="max-height:350px;overflow-y:auto;"></div>
          </div>
        `;
        document.body.appendChild(m);
      }
      document.getElementById('nav-add-stop-modal').style.display = 'flex';
      document.getElementById('nav-add-stop-search').value = '';
      document.getElementById('nav-add-stop-results').innerHTML = '';
    },
    _searchAddStop: (q) => {
      const results = [];
      Object.keys(db).forEach(b => {
        if (b === '__BOARDS__' || b === '__SETTINGS__' || b === 'meta') return;
        if (!db[b] || !db[b].apts) return;
        db[b].apts.forEach((a, i) => {
          if (!q || (a.name || '').includes(q) || (b !== NO_ADDRESS_KEY && b.includes(q))) {
            results.push({ bldg: b, aptIdx: i, name: a.name || '(ללא שם)', address: b !== NO_ADDRESS_KEY ? b : 'ללא כתובת' });
          }
        });
      });
      const container = document.getElementById('nav-add-stop-results');
      if (!container) return;
      container.innerHTML = results.slice(0, 20).map(r => `
        <div class="search-item" style="cursor:pointer;" onclick="NavModule.addStopToRoute('${r.bldg.replace(/'/g, "\\'")}', ${r.aptIdx}); document.getElementById('nav-add-stop-modal').style.display='none';">
          <div class="search-item-title">${escapeHTML(r.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);">${escapeHTML(r.address)}</div>
        </div>
      `).join('') || '<div class="empty-state" style="padding:20px;">לא נמצאו תוצאות</div>';
    },
    getState: () => state,
    isActive: () => state.active,
  };

  function showRouteComplete() {
    showToast('🏆 כל תחנות המסלול טופלו! מעולה!', 'success');
  }

  return window.NavModule;
})();
