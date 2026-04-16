'use strict';

// ==========================================
// 1. הגדרות ומשתנים גלובליים
// ==========================================
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
    let watchId = null, fabIsOpen = false, isDark = false, tokenClient = null;
    let isMissionActive = false, pressTimer = null, isDraggingMap = false;
    let recognition = null, isRecording = false;
    let pendingAutoTaskContext = null, editingFamilyContext = null; 

    // --- משתני ניהול מסלולים וקליקים (החדשים) ---
    let isRouteBuilderMode = false;      
    let selectedRouteBuildings = [];     
    let routeStepMarkers = [];           
    let activeBuildingFeatureId = null;  
    let pendingRouteWaypoints = [];      
    let cardPressTimer = null;           
    let currentMissionWaypoints = [];
    let currentMissionIndex = 0;

    const storageGet = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
    const storageSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));
    const getVisited = () => storageGet(VISITED_KEY) || {};
    const markVisited = (id) => { const v = getVisited(); v[id] = new Date().toISOString(); storageSet(VISITED_KEY, v); };

    // ==========================================
    // 2. אתחול, התחברות וסנכרון
    // ==========================================
    async function init() {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('field-sw.js').catch(e=>console.log(e));
        window.addEventListener('offline', () => setSyncStatus('offline'));
        window.addEventListener('online', forceSync);
        isDark = localStorage.getItem('field_theme') === 'dark';
        if(isDark) { document.body.classList.add('dark-mode'); document.getElementById('f-theme-btn').innerHTML = '<i class="fas fa-sun"></i>'; }
        if (!document.getElementById('f-toast-container')) { 
            const tc = document.createElement('div'); tc.id = 'f-toast-container'; 
            tc.style.cssText = 'position:fixed; top:70px; left:50%; transform:translateX(-50%); z-index:9999; display:flex; flex-direction:column; gap:10px; width:90%; pointer-events:none;'; 
            document.body.appendChild(tc); 
        }
        initSpeech();
        if (typeof google !== 'undefined') { 
            tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: handleGoogleAuthResponse }); 
            if (localStorage.getItem('field_has_logged_in') === 'true') tokenClient.requestAccessToken({ prompt: '' }); 
            else { showAuthScreen(); setSyncStatus('error'); } 
        } else continueOffline();
    }

    function showAuthScreen() { document.getElementById('f-splash').style.display = 'none'; document.getElementById('f-login').style.display = 'block'; }
    function login() { if(tokenClient) tokenClient.requestAccessToken({ prompt: 'consent' }); else showToast("שירותי גוגל טרם נטענו"); }

    async function handleGoogleAuthResponse(resp) {
        if (resp.error) { showAuthScreen(); setSyncStatus('error'); return; }
        accessToken = resp.access_token; localStorage.setItem('field_has_logged_in', 'true');
        document.getElementById('f-login').style.display = 'none'; document.getElementById('f-splash').style.display = 'flex';
        await pushOutboxToDrive(); await loadDataFromDrive(); bootMap(); startLocationTracking();
    }

    async function loadDataFromDrive() {
        setSyncStatus('syncing');
        try {
            const query = encodeURIComponent(`name='community_data_final.json' and trashed=false`);
            const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder,drive&orderBy=modifiedTime desc&fields=files(id,name)`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const searchData = await searchRes.json();
            if (!searchData.files || searchData.files.length === 0) { showToast("⚠️ לא נמצא קובץ נתונים"); setSyncStatus('error'); continueOffline(); return; }
            const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const textData = await dlRes.text();
            try { 
                db = JSON.parse(textData); if(!db.meta) db.meta = {}; storageSet(DATA_KEY, db); setSyncStatus('success'); 
                document.getElementById('f-fab-wrapper').style.display = 'block';
                if(map) { renderMarkers(); renderCommunity(); } 
            } catch(e) { setSyncStatus('error'); continueOffline(); }
        } catch (e) { setSyncStatus('offline'); continueOffline(); }
    }

    function continueOffline() {
        isOfflineMode = true; db = storageGet(DATA_KEY); setSyncStatus('offline');
        if (db) { document.getElementById('f-login').style.display = 'none'; document.getElementById('f-fab-wrapper').style.display = 'block'; bootMap(); startLocationTracking(); }
        else { showToast("❌ חובה חיבור רשת לאיפוס ראשוני"); showAuthScreen(); }
    }

    async function pushOutboxToDrive() { return true; /* Placeholder for your outbox logic */ }
    async function forceSync() { if (!navigator.onLine) { showToast("אין חיבור רשת"); return; } if (!accessToken) { login(); return; } const pushSuccess = await pushOutboxToDrive(); if (pushSuccess) await loadDataFromDrive(); }

    function setSyncStatus(state) {
        const el = document.getElementById('f-sync-status'); if(!el) return;
        const span = el.querySelector('span'); const icon = el.querySelector('i');
        el.className = 'f-sync-indicator'; 
        if (state === 'syncing') { el.classList.add('syncing'); icon.className = 'fas fa-sync-alt'; span.innerText = 'מסנכרן...'; } 
        else if (state === 'success') { el.classList.add('success'); icon.className = 'fas fa-check-circle'; const timeStr = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); span.innerText = `מעודכן ל- ${timeStr}`; localStorage.setItem(SYNC_TIME_KEY, timeStr); } 
        else if (state === 'offline' || state === 'error') { el.classList.add('offline'); icon.className = state === 'offline' ? 'fas fa-wifi-slash' : 'fas fa-exclamation-triangle'; span.innerText = 'לא מסונכרן'; }
    }

    // ==========================================
    // 3. מפה, תלת-ממד, וקליקים (הלוגיקה החדשה!)
    // ==========================================
    function bootMap() {
        if(map) return;
        setTimeout(() => document.getElementById('f-splash').style.display = 'none', 500);
        let centerCoords = db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928];
        map = new mapboxgl.Map({ container: 'f-map', style: isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12', center: centerCoords, zoom: 15, pitch: 60, antialias: true });
        map.on('load', () => { add3DLayer(); renderMarkers(); renderCommunity(); initClickLogic(); });
    }

    function add3DLayer() { 
        if (map.getLayer('3d-buildings')) return; 
        map.addLayer({ 
            'id': '3d-buildings', 'source': 'composite', 'source-layer': 'building', 'filter': ['==', 'extrude', 'true'], 'type': 'fill-extrusion', 'minzoom': 15, 
            'paint': { 
                'fill-extrusion-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 'var(--accent)',  // מסלול כחול
                    ['boolean', ['feature-state', 'active'], false], 'var(--warning)',   // פתוח כתום
                    isDark ? '#1e293b' : '#e2e8f0' 
                ], 
                'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.8 
            } 
        }); 
    }

    function initClickLogic() {
        map.on('click', '3d-buildings', async (e) => {
            if (!e.features.length) return;
            const feature = e.features[0];
            const lngLat = e.lngLat;
            try {
                const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lngLat.lng},${lngLat.lat}.json?types=address&language=he&access_token=${mapboxgl.accessToken}`);
                const d = await r.json();
                if (!d.features || d.features.length === 0) return;
                let addr = (d.features[0].place_name_he || d.features[0].place_name).split(',')[0].trim();
                
                // === מצב בניית מסלול ===
                if (isRouteBuilderMode) {
                    const existingIdx = selectedRouteBuildings.findIndex(b => b.featureId === feature.id);
                    if (existingIdx > -1) {
                        selectedRouteBuildings.splice(existingIdx, 1);
                        map.setFeatureState({source: 'composite', sourceLayer: 'building', id: feature.id}, { selected: false });
                        showToast("הוסר מהמסלול");
                    } else {
                        selectedRouteBuildings.push({ address: addr, coords: [lngLat.lng, lngLat.lat], featureId: feature.id });
                        map.setFeatureState({source: 'composite', sourceLayer: 'building', id: feature.id}, { selected: true });
                        showToast(`נוסף למסלול (תחנה ${selectedRouteBuildings.length})`);
                        if (db[addr]) openBuildingCard(addr, true); 
                    }
                    updateRouteVisuals();
                    return;
                }

                // === מצב שוטף (פתיחת חלון) ===
                if (activeBuildingFeatureId) map.setFeatureState({source: 'composite', sourceLayer: 'building', id: activeBuildingFeatureId}, { active: false });
                activeBuildingFeatureId = feature.id;
                map.setFeatureState({source: 'composite', sourceLayer: 'building', id: feature.id}, { active: true });
                
                if (db[addr]) openBuildingCard(addr, false);
                else showToast("בניין זה לא קיים במאגר. פתח תפריט והוסף משפחה.");
            } catch(err) { console.error(err); }
        });
    }

    function renderMarkers() {
        if (!map || !db) return;
        markers.forEach(m => m.remove()); markers = [];

        if(db.__SETTINGS__?.homeLocation?.coords && db.__SETTINGS__?.homeLocation?.isChabad) {
            const homeCoords = db.__SETTINGS__.homeLocation.coords;
            const homeEl = document.createElement('div'); homeEl.className = 'chabad-pin-wrapper'; 
            homeEl.innerHTML = `<div class="chabad-pin-container"><div class="chabad-pin-circle"><div class="chabad-pin-image"></div></div><div class="chabad-pin-arrow"></div></div>`;
            const homeMarker = new mapboxgl.Marker({ element: homeEl, anchor: 'bottom' }).setLngLat(homeCoords).addTo(map);
            homeEl.addEventListener('click', () => { showToast("מרכז בית חב״ד"); map.flyTo({ center: homeCoords, zoom: 18, pitch: 60 }); }); 
            markers.push(homeMarker);
        } else if (db.__SETTINGS__?.homeLocation?.coords) {
            const homeCoords = db.__SETTINGS__.homeLocation.coords;
            const homeEl = document.createElement('div'); homeEl.className = 'f-pin-marker'; homeEl.innerHTML = `<img src="favicon.ico" style="width:100%">`;
            const homeMarker = new mapboxgl.Marker(homeEl).setLngLat(homeCoords).addTo(map);
            homeEl.addEventListener('click', () => { map.flyTo({ center: homeCoords, zoom: 18, pitch: 60 }); }); markers.push(homeMarker);
        }

        Object.keys(db).forEach(bldg => {
            if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return;
            if(!db[bldg].apts || db[bldg].apts.length === 0) return;
            const coords = db[bldg].info?.coords; if(!coords || isNaN(coords[0])) return;
            const el = document.createElement('div');
            el.style.cssText = 'width:28px; height:28px; background:var(--accent); border:2px solid white; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; box-shadow:0 2px 6px rgba(0,0,0,0.4); cursor:pointer;';
            el.innerText = db[bldg].apts.length;
            const marker = new mapboxgl.Marker(el).setLngLat(coords).addTo(map);
            el.addEventListener('click', (e) => { e.stopPropagation(); 
                if (activeBuildingFeatureId) map.setFeatureState({source: 'composite', sourceLayer: 'building', id: activeBuildingFeatureId}, { active: false });
                openBuildingCard(bldg); 
            }); 
            markers.push(marker);
        });
    }

    // ==========================================
    // 4. בניית מסלולים ועורך גרירה
    // ==========================================
    function toggleRouteBuilderMode() {
        isRouteBuilderMode = true; closeOverlays(); showToast("מצב בניית מסלול פעיל! לחץ על בניינים במפה."); updateRouteVisuals();
    }

    function updateRouteVisuals() {
        routeStepMarkers.forEach(m => m.remove()); routeStepMarkers = [];
        selectedRouteBuildings.forEach((bldg, index) => {
            const el = document.createElement('div');
            el.style.cssText = 'width:24px; height:24px; background:var(--warning); color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; border:2px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.4); z-index: 1000; font-size:12px; pointer-events:none;';
            el.innerText = index + 1;
            const marker = new mapboxgl.Marker(el).setLngLat(bldg.coords).addTo(map);
            routeStepMarkers.push(marker);
        });
        const bar = document.getElementById('f-route-action-bar');
        if (isRouteBuilderMode && selectedRouteBuildings.length > 0) { bar.style.display = 'flex'; document.getElementById('f-route-counter').innerText = selectedRouteBuildings.length; } 
        else { bar.style.display = 'none'; }
    }

    function promptAddToRoute(bldgEnc) {
        const bldg = decodeURIComponent(bldgEnc); const coords = db[bldg]?.info?.coords;
        if(!coords) return showToast("אין מיקום למשפחה זו");
        isRouteBuilderMode = true;
        const existingIdx = selectedRouteBuildings.findIndex(b => b.address === bldg);
        if(existingIdx === -1) selectedRouteBuildings.push({ address: bldg, coords: coords });
        closeOverlays(); updateRouteVisuals(); showToast("הבניין נוסף למסלול! סרגל המסלול מוצג למטה.");
    }

    function startCustomRoute() {
        if (selectedRouteBuildings.length === 0) return;
        pendingRouteWaypoints = selectedRouteBuildings.map(b => b.coords);
        document.getElementById('f-route-action-bar').style.display = 'none';
        document.getElementById('f-route-dialog').style.display = 'flex';
    }

    function openRouteEditor() {
        document.getElementById('f-route-dialog').style.display = 'none';
        renderRouteEditorList(); document.getElementById('f-route-editor-sheet').classList.add('open'); document.getElementById('f-scrim').style.display = 'block';
    }

    function renderRouteEditorList() {
        const container = document.getElementById('f-route-editor-list');
        if (selectedRouteBuildings.length === 0) { container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">המסלול כרגע ריק.</div>'; return; }
        container.innerHTML = selectedRouteBuildings.map((bldg, idx) => `
            <div class="route-editor-item">
                <div class="content"><div style="font-weight:700; font-size:15px;"><span style="color:var(--warning); font-weight:900;">${idx+1}.</span> ${escapeHTML(bldg.address)}</div></div>
                <div class="actions">
                    <button onclick="fieldApp.moveRouteItem(${idx}, -1)" ${idx === 0 ? 'disabled style="opacity:0.3"' : ''}><i class="fas fa-chevron-up"></i></button>
                    <button onclick="fieldApp.moveRouteItem(${idx}, 1)" ${idx === selectedRouteBuildings.length - 1 ? 'disabled style="opacity:0.3"' : ''}><i class="fas fa-chevron-down"></i></button>
                    <button class="delete-btn" onclick="fieldApp.removeRouteItem(${idx})"><i class="fas fa-trash"></i></button>
                </div>
            </div>`).join('');
    }

    function moveRouteItem(idx, direction) {
        if (idx + direction < 0 || idx + direction >= selectedRouteBuildings.length) return;
        const temp = selectedRouteBuildings[idx]; selectedRouteBuildings[idx] = selectedRouteBuildings[idx + direction]; selectedRouteBuildings[idx + direction] = temp;
        renderRouteEditorList(); updateRouteVisuals();
    }

    function removeRouteItem(idx) {
        const removed = selectedRouteBuildings.splice(idx, 1)[0];
        if (removed && removed.featureId) map.setFeatureState({source: 'composite', sourceLayer: 'building', id: removed.featureId}, { selected: false });
        renderRouteEditorList(); updateRouteVisuals();
    }

    function saveAndStartEditedRoute() {
        closeOverlays();
        if (selectedRouteBuildings.length === 0) { isRouteBuilderMode = false; return; }
        pendingRouteWaypoints = selectedRouteBuildings.map(b => b.coords);
        const name = prompt("הכנס שם למסלול זה:", `מסלול מותאם - ${new Date().toLocaleDateString('he-IL')}`);
        if(name) { saveRoute(pendingRouteWaypoints, name); showToast("המסלול נשמר בהצלחה!"); }
        document.getElementById('f-route-dialog').style.display = 'flex'; 
        isRouteBuilderMode = false;
        selectedRouteBuildings.forEach(b => { if(b.featureId) map.setFeatureState({source: 'composite', sourceLayer: 'building', id: b.featureId}, { selected: false }); });
        selectedRouteBuildings = []; updateRouteVisuals();
    }

    function routeDialogGoNow() {
        document.getElementById('f-route-dialog').style.display = 'none';
        if(pendingRouteWaypoints.length > 0) startMissionMode(pendingRouteWaypoints);
    }

    function routeDialogSaveLater() {
        document.getElementById('f-route-dialog').style.display = 'none';
        showToast("המסלול ממתין לך ברשימת המסלולים השמורים.");
        pendingRouteWaypoints = [];
    }

    function saveRoute(waypoints, name) { /* Logic to save route in local DB */ }

    // ==========================================
    // 5. חלונות (Sheets) וממשק משתמש
    // ==========================================
    function switchView(viewId, btnEl) {
        closeOverlays();
        document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
        document.getElementById('view-' + viewId).classList.add('active');
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        if(btnEl) btnEl.classList.add('active');
        if (viewId === 'map') { if(map) map.resize(); document.getElementById('f-fab-wrapper').style.display = 'block'; }
        else { document.getElementById('f-fab-wrapper').style.display = 'none'; }
    }

    function closeOverlays(keepRouteVisuals = false) { 
        document.querySelectorAll('.f-sheet').forEach(s => s.classList.remove('open')); 
        if (fabIsOpen) { fabIsOpen = false; document.getElementById('f-fab-wrapper')?.classList.remove('open'); } 
        document.getElementById('f-scrim').style.display = 'none'; 
        if(db) document.getElementById('f-fab-wrapper').style.display = 'block'; 
        
        if (activeBuildingFeatureId && map) {
            map.setFeatureState({source: 'composite', sourceLayer: 'building', id: activeBuildingFeatureId}, { active: false });
            activeBuildingFeatureId = null;
        }
    }

    function toggleFab() { fabIsOpen = !fabIsOpen; document.getElementById('f-fab-wrapper').classList.toggle('open', fabIsOpen); }
    function showToast(msg) { 
        const tc = document.getElementById('f-toast-container');
        const t = document.createElement('div'); t.style.cssText = 'background:var(--text-main); color:var(--bg-body); padding:12px 20px; border-radius:12px; font-weight:bold; font-size:14px; text-align:center; box-shadow:0 4px 12px rgba(0,0,0,0.2); animation:dfabIn 0.3s;';
        t.innerText = msg; tc.appendChild(t); setTimeout(() => { t.style.opacity = '0'; setTimeout(()=>t.remove(), 300); }, 3000);
    }
    function jumpToCenter() { if(db?.__SETTINGS__?.homeLocation?.coords) map.flyTo({ center: db.__SETTINGS__.homeLocation.coords, zoom: 16 }); }
    function toggleDarkMode() { isDark = !isDark; document.body.classList.toggle('dark-mode', isDark); localStorage.setItem('field_theme', isDark ? 'dark' : 'light'); document.getElementById('f-theme-btn').innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>'; if(map) map.setStyle(isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12'); }
    function openExternalNav(lng, lat, app) { const url = app === 'waze' ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` : `https://maps.google.com/?q=${lat},${lng}`; window.open(url, '_blank'); }
    function callFamilyNumber(phone) { if(phone) window.open(`tel:${phone}`); }

    // ==========================================
    // 6. כרטיסי בניין ומשפחה
    // ==========================================
    function openBuildingCard(bldg, isFromRouteMode = false) {
        closeOverlays(); 
        const sheet = document.getElementById('f-sheet');
        const coords = db[bldg].info?.coords; if(coords && !isNaN(coords[0])) map.flyTo({ center: coords, zoom: 18, pitch: 60 });
        const apts = db[bldg].apts || []; const bldgCode = db[bldg].info?.code || 'אין';
        
        let html = `<button class="sheet-close-btn" onclick="fieldApp.closeOverlays()"><i class="fas fa-times"></i></button>`;
        html += `<div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-light); padding-bottom: 15px; margin-bottom: 15px; margin-top:5px; padding-right: 35px;"><div><h3 style="margin: 0 0 5px 0; font-size: 20px;"><i class="fas fa-building" style="color:var(--accent);"></i> ${bldg}</h3><div style="color: var(--text-muted); font-size: 13px;">${apts.length} משפחות בבניין</div></div><div style="background: var(--bg-body); padding: 5px 10px; border-radius: 8px; text-align: center; border: 1px solid var(--border-light);"><div style="font-size: 11px; color: var(--text-muted);">אינטרקום</div><div style="font-weight: 800; font-size: 16px; color: var(--success);">${escapeHTML(bldgCode)}</div></div></div>`;
        
        if (!isFromRouteMode) {
             html += `<button onclick="fieldApp.promptAddToRoute('${encodeURIComponent(bldg)}')" style="width:100%; margin-bottom:15px; padding:12px; background:var(--accent); color:white; border:none; border-radius:12px; font-weight:bold; font-size:15px; cursor:pointer;"><i class="fas fa-plus"></i> הוסף למסלול מהיר</button>`;
        }
        
        html += `<div style="max-height: 35vh; overflow-y: auto; padding-right: 5px;">`;
        apts.forEach((fam, idx) => { html += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-body); padding:12px; border-radius:12px; margin-bottom:10px; cursor:pointer;" onclick="fieldApp.openFamilyCard('${encodeURIComponent(bldg)}', ${idx})"><div><div style="font-weight:bold; font-size:15px;">משפחת ${escapeHTML(fam.name || 'ללא שם')}</div><div style="font-size:12px; color:var(--text-muted);">${fam.num ? 'דירה ' + escapeHTML(fam.num) : ''}</div></div><i class="fas fa-chevron-left" style="color:var(--text-muted);"></i></div>`; });
        html += `</div>`;
        
        document.getElementById('f-sheet-content').innerHTML = html;
        sheet.classList.add('open'); document.getElementById('f-scrim').style.display = 'block';
    }

    function openFamilyCard(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc); currentTarget = { bldg, aptIdx }; const fam = db[bldg].apts[aptIdx];
        const safeName = escapeHTML(fam.name || 'ללא שם');
        const parents = [fam.fatherName, fam.motherName].filter(Boolean).join(' ו-');
        const parentsHTML = parents ? `<div style="font-size:14px; color:var(--text-muted); margin-bottom:5px;">${escapeHTML(parents)}</div>` : '';
        const phone = fam.fatherPhone || fam.motherPhone || fam.phone || '';
        const waLink = phone ? `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '972')}` : '#';
        const disableStyle = !phone ? 'opacity:0.3; pointer-events:none;' : '';
        
        let html = `<button class="sheet-close-btn" onclick="fieldApp.closeOverlays()"><i class="fas fa-times"></i></button>`;
        html += `<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; margin-top:5px; padding-right: 35px;"><div><h3 style="margin: 0 0 2px 0; font-size: 22px;">משפחת ${safeName}</h3>${parentsHTML}<div style="color: var(--text-muted); font-size: 14px;"><i class="fas fa-map-marker-alt"></i> ${bldg} ${fam.num ? 'דירה '+escapeHTML(fam.num) : ''}</div></div><div style="display:flex; gap:8px;"><button style="width:40px; height:40px; border-radius:50%; background:var(--bg-body); border:1px solid var(--border-light); color:var(--text-main); font-size:16px; cursor:pointer; ${disableStyle}" onclick="fieldApp.callFamilyNumber('${phone}')"><i class="fas fa-phone"></i></button><button style="width:40px; height:40px; border-radius:50%; background:#25D366; border:none; color:white; font-size:16px; cursor:pointer; ${disableStyle}" onclick="window.open('${waLink}', '_blank')"><i class="fab fa-whatsapp"></i></button></div></div>`;
        html += `<div style="font-size:14px; font-weight:bold; color:var(--text-muted); margin-bottom:10px;">דווח סטטוס ביקור:</div><div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;"><button style="padding: 12px; background: var(--success); color: white; border: none; border-radius: 12px; font-weight: bold; cursor:pointer;" onclick="fieldApp.showToast('דווח בוצע')"><i class="fas fa-check"></i> בוצע</button><button style="padding: 12px; background: var(--warning); color: white; border: none; border-radius: 12px; font-weight: bold; cursor:pointer;" onclick="fieldApp.showToast('דווח אין מענה')"><i class="fas fa-door-closed"></i> אין מענה</button></div>`;
        
        document.getElementById('f-sheet-content').innerHTML = html;
        document.getElementById('f-sheet').classList.add('open'); document.getElementById('f-scrim').style.display = 'block';
    }

    // ==========================================
    // 7. קהילה ואקורדיון
    // ==========================================
    function renderCommunity() {
        const c = document.getElementById('f-community-list'); if (!c) return;
        let allFams = []; Object.keys(db).forEach(bldg => { if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return; (db[bldg].apts || []).forEach((apt, aptIdx) => { allFams.push({ bldg, aptIdx, apt, address: bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : bldg }); }); });
        
        c.innerHTML = allFams.slice(0, 50).map((f) => {
            const phone = f.apt.fatherPhone || f.apt.motherPhone || f.apt.phone || ''; 
            const waLink = phone ? `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '972')}` : '#'; 
            const disableStyle = !phone ? 'opacity:0.3; pointer-events:none;' : '';
            const coords = db[f.bldg]?.info?.coords; const lng = coords?.[0]; const lat = coords?.[1];
            const parents = [f.apt.fatherName, f.apt.motherName].filter(Boolean).join(' ו-');
            
            return `
            <div class="expandable-card" oncontextmenu="event.preventDefault();" ontouchstart="fieldApp.handleCardTouchStart(event, '${encodeURIComponent(f.bldg)}', ${f.aptIdx})" ontouchend="fieldApp.handleCardTouchEnd()" onmousedown="fieldApp.handleCardTouchStart(event, '${encodeURIComponent(f.bldg)}', ${f.aptIdx})" onmouseup="fieldApp.handleCardTouchEnd()" onmouseleave="fieldApp.handleCardTouchEnd()">
                <div class="expandable-card-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <div>
                        <div style="font-weight:700; font-size:16px;">משפחת ${escapeHTML(f.apt.name || 'ללא שם')}</div>
                        <div style="font-size:13px; color:var(--text-muted);">${escapeHTML(parents) || 'ללא שמות הורים'}</div>
                    </div>
                    <i class="fas fa-chevron-down" style="color:var(--text-muted);"></i>
                </div>
                <div class="expandable-card-body">
                    <div style="font-size:13px; color:var(--text-main); margin-bottom:10px;">
                        <div><i class="fas fa-map-marker-alt"></i> ${escapeHTML(f.address)} ${f.apt.num ? 'דירה '+escapeHTML(f.apt.num) : ''}</div>
                        ${phone ? `<div style="margin-top:5px;"><i class="fas fa-phone"></i> <span dir="ltr">${phone}</span></div>` : ''}
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="card-action-btn" style="${disableStyle}" onclick="event.stopPropagation(); fieldApp.callFamilyNumber('${phone}')"><i class="fas fa-phone" style="color:var(--success);"></i>חייג</button>
                        <button class="card-action-btn" style="${disableStyle}" onclick="event.stopPropagation(); window.open('${waLink}', '_blank')"><i class="fab fa-whatsapp" style="color:#25D366;"></i>הודעה</button>
                        <button class="card-action-btn" onclick="event.stopPropagation(); fieldApp.openFamilyCard('${encodeURIComponent(f.bldg)}', ${f.aptIdx});"><i class="fas fa-id-card" style="color:var(--accent);"></i>כרטיס</button>
                        <button class="card-action-btn" onclick="event.stopPropagation(); fieldApp.openExternalNav(${lng || 0}, ${lat || 0}, 'waze')"><i class="fab fa-waze" style="color:#33ccff;"></i>נווט</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    function handleCardTouchStart(e, bldgEnc, aptIdx) {
        cardPressTimer = setTimeout(() => { if (navigator.vibrate) navigator.vibrate(50); openCardActionMenu(bldgEnc, aptIdx); }, 600);
    }
    function handleCardTouchEnd() { clearTimeout(cardPressTimer); }

    function openCardActionMenu(bldgEnc, aptIdx) {
        closeOverlays(); const bldg = decodeURIComponent(bldgEnc); const famName = db[bldg].apts[aptIdx].name || 'ללא שם';
        let html = `
        <button class="sheet-close-btn" onclick="fieldApp.closeOverlays()"><i class="fas fa-times"></i></button>
        <h3 style="margin: 0 0 15px 0; font-size: 20px; padding-right:30px;">פעולות מסלול - ${escapeHTML(famName)}</h3>
        <div style="display:flex; flex-direction:column; gap:10px;">
            <button onclick="fieldApp.addSingleToRoute('${bldgEnc}')" style="width:100%; padding:14px; background:var(--accent); color:white; border:none; border-radius:12px; font-weight:bold; font-size:16px; cursor:pointer;"><i class="fas fa-plus"></i> הוסף למסלול פעיל</button>
            <button onclick="fieldApp.removeSingleFromRoute('${bldgEnc}')" style="width:100%; padding:14px; background:var(--bg-body); color:var(--danger); border:1px solid var(--danger); border-radius:12px; font-weight:bold; font-size:16px; cursor:pointer;"><i class="fas fa-trash"></i> הסר ממסלול פעיל</button>
        </div>`;
        document.getElementById('f-sheet-content').innerHTML = html; document.getElementById('f-sheet').classList.add('open'); document.getElementById('f-scrim').style.display = 'block';
    }

    function addSingleToRoute(bldgEnc) {
        const bldg = decodeURIComponent(bldgEnc); const coords = db[bldg]?.info?.coords;
        if(!coords || isNaN(coords[0])) return showToast("אין מיקום למשפחה זו");
        isRouteBuilderMode = true;
        const existingIdx = selectedRouteBuildings.findIndex(b => b.address === bldg);
        if(existingIdx === -1) selectedRouteBuildings.push({ address: bldg, coords: coords });
        showToast("נוסף למסלול בהצלחה"); closeOverlays(); updateRouteVisuals();
    }
    
    function removeSingleFromRoute(bldgEnc) {
        const bldg = decodeURIComponent(bldgEnc);
        const existingIdx = selectedRouteBuildings.findIndex(b => b.address === bldg);
        if(existingIdx > -1) {
            const removed = selectedRouteBuildings.splice(existingIdx, 1)[0];
            if (removed.featureId) map.setFeatureState({source: 'composite', sourceLayer: 'building', id: removed.featureId}, { selected: false });
            showToast("הוסר מהמסלול");
        } else showToast("הבניין לא נמצא במסלול הפעיל");
        closeOverlays(); updateRouteVisuals();
    }

    // ==========================================
    // 8. ניווט משימות (Mission HUD)
    // ==========================================
    function startMissionMode(waypoints) {
        isMissionActive = true; currentMissionWaypoints = waypoints; currentMissionIndex = 0;
        document.getElementById('f-mission-hud').style.display = 'flex';
        closeOverlays(); updateMissionUI();
    }

    function updateMissionUI() {
        if(currentMissionIndex >= currentMissionWaypoints.length) { finishMission(); return; }
        const coords = currentMissionWaypoints[currentMissionIndex];
        document.getElementById('f-mission-progress-text').innerText = `יעד ${currentMissionIndex + 1} מתוך ${currentMissionWaypoints.length}`;
        document.getElementById('f-mission-progress-bar').style.width = `${((currentMissionIndex + 1) / currentMissionWaypoints.length) * 100}%`;
        document.getElementById('f-mission-target-name').innerText = "תחנה מספר " + (currentMissionIndex + 1);
        map.flyTo({ center: coords, zoom: 19, pitch: 70 });
    }

    function nextMissionTarget() { currentMissionIndex++; updateMissionUI(); }
    function prevMissionTarget() { if(currentMissionIndex > 0) currentMissionIndex--; updateMissionUI(); }
    function finishMission() {
        isMissionActive = false; document.getElementById('f-mission-hud').style.display = 'none';
        document.getElementById('f-mission-summary').style.display = 'flex';
        document.getElementById('f-summary-stops').innerText = currentMissionWaypoints.length;
    }
    function closeMissionSummary() { document.getElementById('f-mission-summary').style.display = 'none'; jumpToCenter(); }

    function escapeHTML(str) { return String(str).replace(/[&<>'"]/g, tag => ({'&': '&amp;','<': '&lt;','>': '&gt;',"'": '&#39;','"': '&quot;'}[tag])); }
    function initSpeech() {} 

    // פלייסהולדרים לפונקציות שאולי מופעלות מה-HTML אך אינן קריטיות לזרימה הנוכחית (מונע קריסות)
    function openRouteMenu() { document.getElementById('f-route-sheet').classList.add('open'); document.getElementById('f-scrim').style.display = 'block'; }
    function openSavedRoutesSheet() { showToast("פתיחת מסלולים שמורים"); }
    function openFamilyForm() { showToast("פתיחת טופס משפחה"); }
    function openAddTask() { showToast("פתיחת הוספת משימה"); }
    function toggleTaskLayer() { showToast("שכבת משימות הוחלפה"); }
    function recenter() { jumpToCenter(); }
    function startLocationTracking() {}
    function pauseMission() { showToast("מבצע הושהה"); }
    function refreshMissionRoute() { updateMissionUI(); }
    function switchMissionTab() {}
    function markAllDoneInBuilding() { showToast("סומן כבוצע"); }

    return { 
        init, login, switchView, toggleFab, closeOverlays, openRouteMenu, openFamilyForm, openAddTask, 
        openBuildingCard, openFamilyCard, jumpToCenter, recenter, callFamilyNumber, toggleDarkMode, forceSync, openExternalNav, 
        startCustomRoute, showToast, finishMission, pauseMission, refreshMissionRoute, markAllDoneInBuilding, 
        toggleTaskLayer, switchMissionTab, nextMissionTarget, prevMissionTarget, closeMissionSummary, openSavedRoutesSheet, 
        routeDialogGoNow, routeDialogSaveLater,
        // הפונקציות החדשות!
        toggleRouteBuilderMode, promptAddToRoute, openRouteEditor, moveRouteItem, removeRouteItem, saveAndStartEditedRoute,
        handleCardTouchStart, handleCardTouchEnd, addSingleToRoute, removeSingleFromRoute
    };
})();

window.addEventListener('DOMContentLoaded', () => fieldApp.init());
