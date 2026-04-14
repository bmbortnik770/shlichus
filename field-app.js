'use strict';

const CLIENT_ID   = '348261974014-242r9b0dvctlka7rj3aetu81v96ere46.apps.googleusercontent.com';
const SCOPES      = 'email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
const GEOFENCE_M  = 30;   
const DATA_KEY    = 'field_data';
const VISITED_KEY = 'field_visited';
const OUTBOX_KEY  = 'field_outbox'; 
const SYNC_TIME_KEY = 'field_last_sync';
const NO_ADDRESS_KEY = "__NO_ADDRESS__";

mapboxgl.accessToken = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';
mapboxgl.setRTLTextPlugin('https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js', null, true);

const fieldApp = (function () {
    let map = null, markers = [], db = null;
    let accessToken = null, isOfflineMode = false, currentTarget = null;
    let watchId = null;
    let fabIsOpen = false;
    let isDark = false;
    let tokenClient = null;

    let isMissionActive = false; 
    let highlightedFeatures = []; 
    let pressTimer = null;      
    let isDraggingMap = false;
    
    let recognition = null;
    let isRecording = false;

    const storageGet = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
    const storageSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));
    const getVisited = () => storageGet(VISITED_KEY) || {};
    const markVisited = (id) => { const v = getVisited(); v[id] = new Date().toISOString(); storageSet(VISITED_KEY, v); };
    const isVisited = (id) => !!getVisited()[id];

    function setSyncStatus(state) {
        const el = document.getElementById('f-sync-status'); if(!el) return;
        const span = el.querySelector('span'); const icon = el.querySelector('i');
        el.className = 'f-sync-indicator'; 
        if (state === 'syncing') { el.classList.add('syncing'); icon.className = 'fas fa-sync-alt'; span.innerText = 'מסנכרן...'; } 
        else if (state === 'success') { el.classList.add('success'); icon.className = 'fas fa-check-circle'; const timeStr = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); span.innerText = `מעודכן ל- ${timeStr}`; localStorage.setItem(SYNC_TIME_KEY, timeStr); } 
        else if (state === 'offline' || state === 'error') { el.classList.add('offline'); icon.className = state === 'offline' ? 'fas fa-wifi-slash' : 'fas fa-exclamation-triangle'; const last = localStorage.getItem(SYNC_TIME_KEY); span.innerText = last ? `אופליין (מ- ${last})` : 'לא מסונכרן'; }
    }

    function forceSync() { if (!navigator.onLine) { showToast("אין חיבור רשת"); return; } if (accessToken) loadDataFromDrive(); else login(); }

    async function init() {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('field-sw.js').catch(e=>console.log(e));
        window.addEventListener('offline', () => setSyncStatus('offline'));
        window.addEventListener('online', forceSync);
        isDark = localStorage.getItem('field_theme') === 'dark';
        if(isDark) { document.body.classList.add('dark-mode'); document.getElementById('f-theme-btn').innerHTML = '<i class="fas fa-sun"></i>'; }
        if (!document.getElementById('f-toast-container')) { const tc = document.createElement('div'); tc.id = 'f-toast-container'; tc.style.cssText = 'position:fixed; top:70px; left:50%; transform:translateX(-50%); z-index:9999; display:flex; flex-direction:column; gap:10px; width:90%; pointer-events:none;'; document.body.appendChild(tc); }
        initSpeech();
        if (typeof google !== 'undefined') { tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: handleGoogleAuthResponse }); if (localStorage.getItem('field_has_logged_in') === 'true') tokenClient.requestAccessToken({ prompt: '' }); else { showAuthScreen(); setSyncStatus('error'); } } else continueOffline();
    }

    function initSpeech() {
        window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (window.SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.lang = 'he-IL'; recognition.interimResults = true; recognition.continuous = true;
            recognition.onresult = (e) => { let t = ''; for (let i = e.resultIndex; i < e.results.length; ++i) t += e.results[i][0].transcript; document.getElementById('f-voice-result').value = t; };
            recognition.onerror = (e) => { console.error("Speech error:", e.error); stopVoiceRecording(); };
            recognition.onend = () => { if(isRecording) recognition.start(); };
        }
    }

    function showAuthScreen() { document.getElementById('f-splash').style.display = 'none'; document.getElementById('f-login').style.display = 'block'; }
    function login() { if(tokenClient) tokenClient.requestAccessToken({ prompt: 'consent' }); else showToast("שירותי גוגל טרם נטענו"); }

    async function handleGoogleAuthResponse(resp) {
        if (resp.error) { showAuthScreen(); setSyncStatus('error'); return; }
        accessToken = resp.access_token; localStorage.setItem('field_has_logged_in', 'true');
        document.getElementById('f-login').style.display = 'none'; document.getElementById('f-splash').style.display = 'flex';
        await loadDataFromDrive(); bootMap(); startLocationTracking();
    }

    function getFamilyCount() { let count = 0; Object.keys(db).forEach(k => { if(k !== '__BOARDS__' && k !== '__SETTINGS__' && k !== 'meta' && db[k].apts) count += db[k].apts.length; }); return count; }

    async function loadDataFromDrive() {
        setSyncStatus('syncing');
        try {
            const query = encodeURIComponent(`name='community_data_final.json' and trashed=false`);
            const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder,drive&orderBy=modifiedTime desc&fields=files(id,name)`;
            const searchRes = await fetch(searchUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const searchData = await searchRes.json();
            if (!searchData.files || searchData.files.length === 0) { showToast("⚠️ לא נמצא קובץ נתונים"); setSyncStatus('error'); continueOffline(); return; }
            const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const textData = await dlRes.text();
            try { db = JSON.parse(textData); if(!db.meta) db.meta = {}; storageSet(DATA_KEY, db); setSyncStatus('success'); showToast(`✅ סונכרן! נטענו ${getFamilyCount()} משפחות.`); if(map) { renderMarkers(); renderTasks(); renderCommunity(); } } catch(e) { setSyncStatus('error'); continueOffline(); }
        } catch (e) { setSyncStatus('offline'); continueOffline(); }
    }

    function continueOffline() {
        isOfflineMode = true; db = storageGet(DATA_KEY); setSyncStatus('offline');
        if (db) { document.getElementById('f-login').style.display = 'none'; bootMap(); startLocationTracking(); }
        else { showToast("❌ חובה חיבור רשת לאיפוס ראשוני"); showAuthScreen(); }
    }

    function bootMap() {
        if(map) return;
        setTimeout(() => document.getElementById('f-splash').style.display = 'none', 500);
        let centerCoords = db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928];
        map = new mapboxgl.Map({ container: 'f-map', style: isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12', center: centerCoords, zoom: 14, pitch: 60, antialias: true });
        map.on('load', () => { add3DLayer(); addHighlightLayer(); renderMarkers(); renderTasks(); renderCommunity(); initClickLogic(); });
    }

    function add3DLayer() { if (map.getLayer('3d-buildings')) return; map.addLayer({ 'id': '3d-buildings', 'source': 'composite', 'source-layer': 'building', 'filter': ['==', 'extrude', 'true'], 'type': 'fill-extrusion', 'minzoom': 15, 'paint': { 'fill-extrusion-color': isDark ? '#1e293b' : '#e2e8f0', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.6 } }); }
    function addHighlightLayer() { map.addSource('highlighted-bldgs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }); map.addLayer({ 'id': '3d-highlight', 'source': 'highlighted-bldgs', 'type': 'fill-extrusion', 'minzoom': 15, 'paint': { 'fill-extrusion-color': '#38bdf8', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.8 } }); }

    function initClickLogic() {
        map.on('mousedown', handlePointerDown); map.on('mousemove', () => isDraggingMap = true); map.on('mouseup', handlePointerUp);
        map.on('touchstart', handlePointerDown, {passive: true}); map.on('touchmove', () => isDraggingMap = true, {passive: true}); map.on('touchend', handlePointerUp, {passive: true});
    }
    function handlePointerDown(e) { isDraggingMap = false; pressTimer = setTimeout(() => { if(!isDraggingMap) handleLongPress(e); }, 500); }
    function handlePointerUp(e) { clearTimeout(pressTimer); }

    async function handleLongPress(e) {
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]); 
        const features = map.queryRenderedFeatures(e.point, { layers: ['3d-buildings'] });
        if (features.length === 0) return; 
        const feature = features[0]; const geomString = JSON.stringify(feature.geometry);
        const existingIdx = highlightedFeatures.findIndex(f => JSON.stringify(f.geometry) === geomString);
        if (existingIdx >= 0) { highlightedFeatures.splice(existingIdx, 1); showToast("בניין הוסר מהמסלול"); } else { highlightedFeatures.push(feature); showToast("בניין סומן!"); }
        map.getSource('highlighted-bldgs').setData({ type: 'FeatureCollection', features: highlightedFeatures });
        document.getElementById('f-bldg-count').innerText = highlightedFeatures.length;
        openRouteMenu(); 
    }

    function openBuildingCard(bldg) {
        closeOverlays();
        const sheet = document.getElementById('f-sheet');
        const coords = db[bldg].info?.coords; if(coords && !isNaN(coords[0])) map.flyTo({ center: coords, zoom: 18, pitch: 60, duration: 1500 });
        const apts = db[bldg].apts || []; const bldgCode = db[bldg].info?.code || 'אין';
        let html = `<div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-light); padding-bottom: 15px; margin-bottom: 15px;"><div><h3 style="margin: 0 0 5px 0; font-size: 20px;"><i class="fas fa-building" style="color:var(--accent);"></i> ${bldg}</h3><div style="color: var(--text-muted); font-size: 13px;">${apts.length} משפחות בבניין</div></div><div style="background: var(--bg-body); padding: 5px 10px; border-radius: 8px; text-align: center; border: 1px solid var(--border-light);"><div style="font-size: 11px; color: var(--text-muted);">אינטרקום</div><div style="font-weight: 800; font-size: 16px; color: var(--success);">${escapeHTML(bldgCode)}</div></div></div><div style="max-height: 40vh; overflow-y: auto; padding-right: 5px;">`;
        apts.forEach((fam, idx) => { html += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-body); padding:12px; border-radius:12px; margin-bottom:10px; cursor:pointer;" onclick="fieldApp.openFamilyCard('${encodeURIComponent(bldg)}', ${idx})"><div><div style="font-weight:bold; font-size:15px;">משפחת ${escapeHTML(fam.name || 'ללא שם')}</div><div style="font-size:12px; color:var(--text-muted);">${fam.num ? 'דירה ' + escapeHTML(fam.num) : ''}</div></div><i class="fas fa-chevron-left" style="color:var(--text-muted);"></i></div>`; });
        html += `</div>`;
        document.getElementById('f-sheet-content').innerHTML = html;
        sheet.classList.add('open'); document.getElementById('f-scrim').style.display = 'block';
    }

    // ==========================================
    // 1. כרטיס המשפחה המבצעי (שדרוג מטורף!)
    // ==========================================
    function openFamilyCard(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        currentTarget = { bldg, aptIdx };
        const fam = db[bldg].apts[aptIdx];
        
        // שליפת שמות ההורים
        const safeName = escapeHTML(fam.name || 'ללא שם');
        const parents = [fam.fatherName, fam.motherName].filter(Boolean).join(' ו');
        const parentsHTML = parents ? `<div style="font-size:14px; color:var(--text-muted); margin-bottom:5px;">${escapeHTML(parents)}</div>` : '';
        
        // לחצני קשר
        const phone = fam.fatherPhone || fam.motherPhone || fam.phone || '';
        const waLink = phone ? `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '972')}` : '#';
        const disableStyle = !phone ? 'opacity:0.3; pointer-events:none;' : '';

        // שליפת המשימה הפתוחה
        const activeTask = (fam.tasks || []).find(t => !t.done);
        const taskHTML = activeTask ? `
            <div style="background:rgba(37, 99, 235, 0.1); border:1px solid rgba(37, 99, 235, 0.3); padding:10px; border-radius:8px; margin-bottom:15px;">
                <div style="font-size:12px; color:var(--accent); font-weight:bold; margin-bottom:4px;"><i class="fas fa-thumbtack"></i> משימה פתוחה:</div>
                <div style="font-size:15px; color:var(--text-main);">${escapeHTML(activeTask.text)}</div>
            </div>
        ` : '';

        let html = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                <div>
                    <h3 style="margin: 0 0 2px 0; font-size: 22px;">משפחת ${safeName}</h3>
                    ${parentsHTML}
                    <div style="color: var(--text-muted); font-size: 14px;"><i class="fas fa-map-marker-alt"></i> ${bldg} ${fam.num ? 'דירה '+escapeHTML(fam.num) : ''}</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button style="width:40px; height:40px; border-radius:50%; background:var(--bg-body); border:1px solid var(--border-light); color:var(--text-main); font-size:16px; cursor:pointer; ${disableStyle}" onclick="fieldApp.callFamilyNumber('${phone}')"><i class="fas fa-phone"></i></button>
                    <button style="width:40px; height:40px; border-radius:50%; background:#25D366; border:none; color:white; font-size:16px; cursor:pointer; ${disableStyle}" onclick="window.open('${waLink}', '_blank')"><i class="fab fa-whatsapp"></i></button>
                </div>
            </div>
            ${taskHTML}
            <div style="font-size:14px; font-weight:bold; color:var(--text-muted); margin-bottom:10px;">דווח סטטוס ביקור:</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <button style="padding: 12px; background: var(--success); color: white; border: none; border-radius: 12px; font-weight: bold; cursor:pointer;" onclick="fieldApp.openVoiceSummary('בוצע')">
                    <i class="fas fa-check"></i> בוצע
                </button>
                <button style="padding: 12px; background: var(--warning); color: white; border: none; border-radius: 12px; font-weight: bold; cursor:pointer;" onclick="fieldApp.openVoiceSummary('אין מענה')">
                    <i class="fas fa-door-closed"></i> אין מענה
                </button>
                <button style="padding: 12px; background: var(--text-muted); color: white; border: none; border-radius: 12px; font-weight: bold; cursor:pointer;" onclick="fieldApp.openVoiceSummary('לא רלוונטי')">
                    <i class="fas fa-ban"></i> לא רלוונטי
                </button>
                <button style="padding: 12px; background: var(--danger); color: white; border: none; border-radius: 12px; font-weight: bold; cursor:pointer;" onclick="fieldApp.openVoiceSummary('לא מעוניינים')">
                    <i class="fas fa-times-circle"></i> לא מעוניינים
                </button>
            </div>
        `;

        document.getElementById('f-sheet-content').innerHTML = html;
        // מוודא שהמגירה נשארת פתוחה או נפתחת אם הגענו מהקהילה
        document.getElementById('f-sheet').classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
    }

    // ==========================================
    // 2. סיכום קולי עם סטטוס
    // ==========================================
    function openVoiceSummary(status) {
        closeOverlays();
        if(currentTarget) currentTarget.status = status; // שמירת הסטטוס שנבחר
        
        document.getElementById('f-voice-status-badge').innerText = status; // עדכון התגית הוויזואלית

        document.getElementById('f-voice-sheet').classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
        document.getElementById('f-voice-result').value = '';
        
        if(recognition) toggleVoiceRecording(); // מתחיל להקליט מיד!
        else showToast("הקלטה קולית לא נתמכת, ניתן להקליד ידנית.");
    }

    function toggleVoiceRecording() {
        const btn = document.getElementById('f-mic-btn');
        if (isRecording) { stopVoiceRecording(); } 
        else {
            if(recognition) {
                try { recognition.start(); } catch(e) {}
                isRecording = true;
                btn.style.background = 'var(--danger)';
                btn.style.boxShadow = '0 0 15px rgba(239,68,68,0.8)';
            }
        }
    }

    function stopVoiceRecording() {
        if(recognition && isRecording) {
            recognition.stop(); isRecording = false;
            const btn = document.getElementById('f-mic-btn');
            if(btn) { btn.style.background = 'var(--text-muted)'; btn.style.boxShadow = 'none'; }
        }
    }

    function saveVisitLog() {
        stopVoiceRecording();
        const text = document.getElementById('f-voice-result').value.trim();
        if(!currentTarget) return;

        const bldg = currentTarget.bldg;
        const aptIdx = currentTarget.aptIdx;
        const status = currentTarget.status || 'כללי';
        const famName = db[bldg].apts[aptIdx].name;

        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({
            type: 'visit_log',
            bldg: bldg,
            aptName: famName,
            status: status,
            timestamp: new Date().toISOString(),
            content: text // גם אם ריק זה בסדר, העיקר שיש לנו את הסטטוס
        });
        storageSet(OUTBOX_KEY, outbox);
        
        closeOverlays();
        showToast(`✅ הסטטוס '${status}' נשמר בהצלחה!`);
    }

    // ==========================================
    // טפסים (Placeholder לשלבים הבאים)
    // ==========================================
    function openAddFamily() { closeOverlays(); document.getElementById('f-add-family-sheet').classList.add('open'); document.getElementById('f-scrim').style.display = 'block'; }
    function saveNewFamily() { closeOverlays(); showToast("✅ משפחה נשמרה במערכת"); }
    function openAddTask() { closeOverlays(); document.getElementById('f-add-task-sheet').classList.add('open'); document.getElementById('f-scrim').style.display = 'block'; }
    function saveNewTask() { closeOverlays(); showToast("✅ משימה נוצרה"); }

    function renderMarkers() {
        if (!map || !db) return;
        markers.forEach(m => m.remove()); markers = [];

        if(db.__SETTINGS__?.homeLocation?.coords) {
            const homeCoords = db.__SETTINGS__.homeLocation.coords;
            const homeEl = document.createElement('div'); homeEl.className = 'f-pin-marker'; homeEl.innerHTML = `<img src="https://raw.githubusercontent.com/bmbortnik770/shlichus/refs/heads/main/favicon.ico">`;
            const homeMarker = new mapboxgl.Marker(homeEl).setLngLat(homeCoords).addTo(map);
            homeEl.addEventListener('click', () => { showToast("מרכז בית חב״ד"); map.flyTo({ center: homeCoords, zoom: 18, pitch: 60 }); });
            markers.push(homeMarker);
        }

        Object.keys(db).forEach(bldg => {
            if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return;
            if(!db[bldg].apts || db[bldg].apts.length === 0) return;
            const coords = db[bldg].info?.coords; if(!coords || isNaN(coords[0])) return;
            const el = document.createElement('div');
            el.style.cssText = 'width:28px; height:28px; background:var(--accent); border:2px solid white; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; box-shadow:0 2px 6px rgba(0,0,0,0.4); cursor:pointer;';
            el.innerText = db[bldg].apts.length;
            const marker = new mapboxgl.Marker(el).setLngLat(coords).addTo(map);
            el.addEventListener('click', (e) => { e.stopPropagation(); openBuildingCard(bldg); }); markers.push(marker);
        });
    }

    function renderCommunity() {
        const c = document.getElementById('f-community-list'); if (!c) return;
        let allFams = [];
        Object.keys(db).forEach(bldg => {
            if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            (db[bldg].apts || []).forEach((apt, aptIdx) => { allFams.push({ bldg, aptIdx, apt, address: bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : bldg }); });
        });
        c.innerHTML = allFams.slice(0, 50).map((f) => {
            const phone = f.apt.fatherPhone || f.apt.motherPhone || f.apt.phone || '';
            const waLink = phone ? `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '972')}` : '#';
            const disableStyle = !phone ? 'opacity:0.3; pointer-events:none;' : '';
            return `
            <div style="background:var(--surface); border:1px solid var(--border-light); padding:16px; border-radius:16px; margin-bottom:12px; box-shadow:var(--shadow);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 12px;"><div><div style="font-weight:600; font-size:16px;">משפחת ${escapeHTML(f.apt.name || 'ללא שם')}</div><div style="font-size:13px; color:var(--text-muted); margin-top:4px;">${escapeHTML(f.address)} ${f.apt.num ? 'דירה '+f.apt.num : ''}</div></div></div>
                <div style="display:flex; gap:8px; border-top: 1px solid var(--border-light); padding-top: 12px;">
                    <button style="flex:1; background:var(--bg-body); border:1px solid var(--border-light); padding:10px; border-radius:10px; color:var(--text-main); font-size:16px; ${disableStyle}" onclick="fieldApp.callFamilyNumber('${phone}')"><i class="fas fa-phone"></i></button>
                    <button style="flex:1; background:#25D366; border:none; padding:10px; border-radius:10px; color:white; font-size:16px; ${disableStyle}" onclick="window.open('${waLink}', '_blank')"><i class="fab fa-whatsapp"></i></button>
                    <button style="flex:2; background:var(--accent); border:none; padding:10px; border-radius:10px; color:white; font-weight:bold;" onclick="fieldApp.openFamilyCard('${encodeURIComponent(f.bldg)}', ${f.aptIdx}); fieldApp.switchView('map');">כרטיס מלא</button>
                </div>
            </div>`;
        }).join('');
    }

    function openRouteMenu() { closeOverlays(); switchView('map', document.querySelector('.nav-item')); document.getElementById('f-route-sheet').classList.add('open'); document.getElementById('f-scrim').style.display = 'block'; }

    async function buildRoute(sourceType) {
        closeOverlays(); isMissionActive = true; showToast("🗺️ מצב מבצעים הופעל! מייצר מסלול...");
        let waypoints = [];
        if (sourceType === 'buildings') {
            if (highlightedFeatures.length === 0) { showToast("לא סימנת בניינים במפה."); return; }
            waypoints = highlightedFeatures.map(f => { let coords = f.geometry.coordinates[0][0]; if(Array.isArray(coords[0])) coords = coords[0]; return coords; });
        } else if (sourceType === 'tasks' || sourceType === 'community') {
            let allCoords = [];
            Object.keys(db).forEach(bldg => { if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return; const coords = db[bldg].info?.coords; if(coords && !isNaN(coords[0]) && db[bldg].apts.length > 0) allCoords.push(coords); });
            waypoints = allCoords.slice(0, sourceType==='tasks'?3:5);
        }
        if (waypoints.length === 0) { showToast("לא נמצאו יעדים למסלול."); return; }
        if (navigator.geolocation) { navigator.geolocation.getCurrentPosition( pos => drawMultiStopRoute([pos.coords.longitude, pos.coords.latitude], waypoints), () => drawMultiStopRoute(db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928], waypoints) ); }
    }

    function startLocationTracking() {
        if (!navigator.geolocation) return;
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (!db || !isMissionActive) return; 
                const user = [pos.coords.longitude, pos.coords.latitude];
                Object.keys(db).forEach(bldg => {
                    if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return;
                    if(!db[bldg].apts || db[bldg].apts.length === 0) return;
                    const coords = db[bldg].info?.coords; if(!coords || isNaN(coords[0])) return;
                    if (calculateDistance(user, coords) < GEOFENCE_M && !isVisited(bldg)) { markVisited(bldg); openBuildingCard(bldg); }
                });
            }, (err) => console.error(err), { enableHighAccuracy: true }
        );
    }

    function closeOverlays() {
        stopVoiceRecording(); 
        document.querySelectorAll('.f-sheet').forEach(s => s.classList.remove('open'));
        if (fabIsOpen) { fabIsOpen = false; document.getElementById('f-fab-wrapper')?.classList.remove('open'); }
        document.getElementById('f-scrim').style.display = 'none';
    }

    function toggleFab() {
        fabIsOpen = !fabIsOpen; document.getElementById('f-fab-wrapper')?.classList.toggle('open', fabIsOpen);
        const scrim = document.getElementById('f-scrim');
        if (fabIsOpen) { document.querySelectorAll('.f-sheet').forEach(s => s.classList.remove('open')); scrim.style.display = 'block'; if (navigator.vibrate) navigator.vibrate(20); } else { scrim.style.display = 'none'; }
    }

    function switchView(viewId, element) {
        if (element) { document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active')); element.classList.add('active'); }
        document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
        document.getElementById('view-' + viewId).classList.add('active');
        closeOverlays(); if (viewId === 'map' && map) setTimeout(() => map.resize(), 100);
    }

    function renderTasks() {
        const c = document.getElementById('f-tasks-list'); if (!c) return;
        let allTasks = [];
        (db.meta?.generalTasks || []).forEach((t, i) => { if(!t.done) allTasks.push({...t, isGeneral: true, idx: i}); });
        Object.keys(db).forEach(bldg => { if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return; (db[bldg].apts || []).forEach((apt, aptIdx) => { (apt.tasks || []).forEach((t, tIdx) => { if(!t.done) allTasks.push({...t, isGeneral: false, bldg, aptIdx, tIdx, famName: apt.name}); }); }); });
        if(allTasks.length === 0) { c.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);"><i class="fas fa-glass-cheers" style="font-size:40px; color:var(--accent); opacity:0.5; margin-bottom:15px;"></i><h3>אין משימות פתוחות!</h3></div>`; return; }
        c.innerHTML = allTasks.map((t, i) => { const dataAttr = t.isGeneral ? `data-general="true" data-idx="${t.idx}"` : `data-general="false" data-bldg="${encodeURIComponent(t.bldg)}" data-apt="${t.aptIdx}" data-task="${t.tIdx}"`; const titlePrefix = t.isGeneral ? '' : `משפחת ${t.famName}: `; return `<div class="task-swipe-container" style="position:relative; margin-bottom:12px; overflow:hidden; border-radius:16px; box-shadow:var(--shadow);"><div class="task-bg-success" style="position:absolute; top:0; left:0; width:100%; height:100%; background:var(--success); color:white; display:flex; align-items:center; padding-left:20px; font-size:20px; font-weight:bold; z-index:1;"><i class="fas fa-check"></i></div><div class="task-item-front" ${dataAttr} style="position:relative; background:var(--surface); border:1px solid var(--border-light); padding:16px; border-radius:16px; display:flex; justify-content:space-between; align-items:center; z-index:2; transition: transform 0.2s ease;"><div><div style="font-weight:600; font-size:16px;">${escapeHTML(titlePrefix + t.text)}</div><div style="font-size:13px; color:var(--text-muted); margin-top:4px;"><i class="far fa-calendar"></i> ${t.date || 'ללא מועד'}</div></div></div></div>`; }).join('');
        initSwipeLogic();
    }
    function initSwipeLogic() { const items = document.querySelectorAll('.task-item-front'); items.forEach(item => { let startX = 0; let currentX = 0; let isDragging = false; item.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; isDragging = true; item.style.transition = 'none'; }, {passive: true}); item.addEventListener('touchmove', (e) => { if (!isDragging) return; currentX = e.touches[0].clientX; let diff = currentX - startX; if (diff < 0) item.style.transform = `translateX(${diff}px)`; }, {passive: true}); item.addEventListener('touchend', (e) => { if (!isDragging) return; isDragging = false; item.style.transition = 'transform 0.3s ease'; let diff = currentX - startX; if (diff < -80) completeTask(item); else item.style.transform = 'translateX(0)'; }); }); }
    function completeTask(item) {
        item.style.transform = 'translateX(-100%)'; if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
        const isGeneral = item.getAttribute('data-general') === 'true'; let payload = null;
        if (isGeneral) { const idx = item.getAttribute('data-idx'); db.meta.generalTasks[idx].done = true; payload = { type: 'general_task_complete', taskIndex: idx }; } 
        else { const bldg = decodeURIComponent(item.getAttribute('data-bldg')); const aptIdx = item.getAttribute('data-apt'); const taskIdx = item.getAttribute('data-task'); const taskObj = db[bldg].apts[aptIdx].tasks[taskIdx]; taskObj.done = true; payload = { type: 'task_done', bldg, aptName: db[bldg].apts[aptIdx].name, aptNum: db[bldg].apts[aptIdx].num, payload: { taskText: taskObj.text } }; }
        storageSet(DATA_KEY, db); const outbox = storageGet(OUTBOX_KEY) || []; outbox.push({ ...payload, timestamp: new Date().toISOString() }); storageSet(OUTBOX_KEY, outbox);
        showToast("✅ המשימה הושלמה!"); setTimeout(() => { const container = item.closest('.task-swipe-container'); container.style.opacity = '0'; setTimeout(() => container.remove(), 300); }, 300);
    }
    async function drawMultiStopRoute(startCoords, waypointsArray) { try { const allPoints = [startCoords, ...waypointsArray.slice(0, 23)]; const coordsString = allPoints.map(c => `${c[0]},${c[1]}`).join(';'); const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsString}?geometries=geojson&access_token=${mapboxgl.accessToken}`; const res = await fetch(url); const json = await res.json(); if (!json.routes?.[0]) { showToast("לא ניתן לייצר מסלול לנקודות אלו."); return; } const geojson = { type: 'Feature', geometry: json.routes[0].geometry }; if (map.getSource('route')) map.getSource('route').setData(geojson); else map.addLayer({ id: 'route', type: 'line', source: { type: 'geojson', data: geojson }, paint: { 'line-color': '#2563eb', 'line-width': 6, 'line-opacity': 0.8 } }); const bounds = new mapboxgl.LngLatBounds(allPoints[0], allPoints[0]); allPoints.forEach(coord => bounds.extend(coord)); map.fitBounds(bounds, { padding: { top: 80, bottom: 80, left: 50, right: 50 }, duration: 2000 }); showToast("🚗 מסלול נוצר בהצלחה!"); } catch (e) { showToast("שגיאה ביצירת מסלול."); } }
    function callFamilyNumber(p) { if(p) window.location.href = `tel:${p}`; else showToast("אין מספר"); }
    function jumpToCenter() { const c = db?.__SETTINGS__?.homeLocation?.coords ? db.__SETTINGS__.homeLocation.coords : [34.8878, 31.9928]; map.flyTo({ center: c, zoom: 18, pitch: 60 }); }
    function recenter() { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 17, pitch: 60 })); }
    function toggleDarkMode() { isDark = !isDark; document.body.classList.toggle('dark-mode', isDark); localStorage.setItem('field_theme', isDark ? 'dark' : 'light'); document.getElementById('f-theme-btn').innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>'; if (map) { map.setStyle(isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12'); map.once('style.load', () => { add3DLayer(); addHighlightLayer(); renderMarkers(); }); } }
    function escapeHTML(str) { return String(str).replace(/[&<>"']/g, function(m) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]; }); }
    function openArrivalSheetEncoded(bEnc, idx) { openFamilyCard(bEnc, idx); }

    return { init, login, switchView, toggleFab, closeOverlays, openRouteMenu, buildRoute, openAddFamily, saveNewFamily, openAddTask, saveNewTask, openBuildingCard, openFamilyCard, openArrivalSheet: openArrivalSheetEncoded, openVoiceSummary, toggleVoiceRecording, saveVisitLog, jumpToCenter, recenter, callFamilyNumber, toggleDarkMode, forceSync };
})();

window.addEventListener('DOMContentLoaded', () => fieldApp.init());
