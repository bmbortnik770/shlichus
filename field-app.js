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

    let selectedBuildings = []; 
    let buildingMarkers = [];   
    let pressTimer = null;      

    const storageGet = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
    const storageSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));
    const getVisited = () => storageGet(VISITED_KEY) || {};
    const markVisited = (id) => { const v = getVisited(); v[id] = new Date().toISOString(); storageSet(VISITED_KEY, v); };
    const isVisited = (id) => !!getVisited()[id];

    function setSyncStatus(state) {
        const el = document.getElementById('f-sync-status');
        if(!el) return;
        const span = el.querySelector('span');
        const icon = el.querySelector('i');
        
        el.className = 'f-sync-indicator'; 
        
        if (state === 'syncing') {
            el.classList.add('syncing'); icon.className = 'fas fa-sync-alt'; span.innerText = 'מסנכרן...';
        } else if (state === 'success') {
            el.classList.add('success'); icon.className = 'fas fa-check-circle';
            const timeStr = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
            span.innerText = `מעודכן ל- ${timeStr}`; localStorage.setItem(SYNC_TIME_KEY, timeStr);
        } else if (state === 'offline' || state === 'error') {
            el.classList.add('offline'); icon.className = state === 'offline' ? 'fas fa-wifi-slash' : 'fas fa-exclamation-triangle';
            const last = localStorage.getItem(SYNC_TIME_KEY);
            span.innerText = last ? `אופליין (מ- ${last})` : 'לא מסונכרן';
        }
    }

    function forceSync() {
        if (!navigator.onLine) { showToast("אין חיבור לאינטרנט כרגע"); return; }
        if (accessToken) loadDataFromDrive(); else login();
    }

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
        accessToken = resp.access_token;
        localStorage.setItem('field_has_logged_in', 'true');
        document.getElementById('f-login').style.display = 'none';
        document.getElementById('f-splash').style.display = 'flex';
        await loadDataFromDrive();
        bootMap();
        startLocationTracking();
    }

    function getFamilyCount() {
        let count = 0;
        Object.keys(db).forEach(k => {
            if(k !== '__BOARDS__' && k !== '__SETTINGS__' && k !== 'meta' && db[k].apts) count += db[k].apts.length;
        });
        return count;
    }

    async function loadDataFromDrive() {
        setSyncStatus('syncing');
        try {
            const query = encodeURIComponent(`name='community_data_final.json' and trashed=false`);
            const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder,drive&orderBy=modifiedTime desc&fields=files(id,name)`;
            
            const searchRes = await fetch(searchUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const searchData = await searchRes.json();
            
            if (!searchData.files || searchData.files.length === 0) { 
                showToast("⚠️ לא נמצא קובץ נתונים (בדוק אם סונכרן במערכת)"); setSyncStatus('error'); continueOffline(); return; 
            }
            
            const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const textData = await dlRes.text();
            
            try {
                db = JSON.parse(textData);
                if(!db.meta) db.meta = {};
                storageSet(DATA_KEY, db);
                setSyncStatus('success');
                showToast(`✅ סונכרן! נטענו ${getFamilyCount()} משפחות.`);
                if(map) { renderMarkers(); renderTasks(); renderCommunity(); }
            } catch(e) { setSyncStatus('error'); continueOffline(); }
        } catch (e) { setSyncStatus('offline'); continueOffline(); }
    }

    function continueOffline() {
        isOfflineMode = true; db = storageGet(DATA_KEY);
        setSyncStatus('offline');
        if (db) { document.getElementById('f-login').style.display = 'none'; bootMap(); startLocationTracking(); }
        else { showToast("❌ חובה חיבור רשת לאיפוס ראשוני"); showAuthScreen(); }
    }

    function bootMap() {
        if(map) return;
        setTimeout(() => document.getElementById('f-splash').style.display = 'none', 500);
        
        let centerCoords = [34.8878, 31.9928]; 
        if(db?.__SETTINGS__?.homeLocation?.coords) centerCoords = db.__SETTINGS__.homeLocation.coords;

        map = new mapboxgl.Map({
            container: 'f-map',
            style: isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12',
            center: centerCoords, zoom: 14, pitch: 60, antialias: true
        });

        map.on('load', () => {
            add3DLayer(); renderMarkers(); renderTasks(); renderCommunity(); initLongPressLogic();
        });
    }

    function initLongPressLogic() {
        map.on('touchstart', (e) => { pressTimer = setTimeout(() => handleLongPress(e), 600); });
        map.on('touchend', () => clearTimeout(pressTimer)); map.on('touchmove', () => clearTimeout(pressTimer));
        map.on('mousedown', (e) => { pressTimer = setTimeout(() => handleLongPress(e), 600); });
        map.on('mouseup', () => clearTimeout(pressTimer)); map.on('mousemove', () => clearTimeout(pressTimer));
    }

    async function handleLongPress(e) {
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]); 
        const coords = [e.lngLat.lng, e.lngLat.lat]; let addressName = "טוען כתובת...";
        const el = document.createElement('div');
        el.style.cssText = 'width:30px; height:30px; background:var(--danger); border:3px solid white; border-radius:50%; box-shadow:0 0 15px rgba(239, 68, 68, 0.8); display:flex; align-items:center; justify-content:center; color:white; font-size:12px; cursor:pointer; z-index:10;';
        el.innerHTML = '<i class="fas fa-building"></i>';
        const popup = new mapboxgl.Popup({ offset: 25, closeButton: false, className: 'f-custom-popup' }).setText(addressName);
        const marker = new mapboxgl.Marker(el).setLngLat(coords).setPopup(popup).addTo(map);
        marker.togglePopup(); buildingMarkers.push(marker);

        try {
            const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${coords[0]},${coords[1]}.json?access_token=${mapboxgl.accessToken}&language=he&types=address,poi`);
            const data = await res.json();
            if (data.features && data.features.length > 0) {
                addressName = data.features[0].place_name_he || data.features[0].place_name;
                addressName = addressName.split(',').slice(0, 2).join(','); 
            } else addressName = "בניין לא ידוע";
        } catch (err) { addressName = "כתובת לא זמינה"; }

        popup.setText(addressName);
        selectedBuildings.push({ lng: coords[0], lat: coords[1], address: addressName });
        document.getElementById('f-bldg-count').innerText = selectedBuildings.length;
        showToast(`📍 סומן: ${addressName}`); openRouteMenu();
    }

    function openRouteMenu() {
        if (fabIsOpen) toggleFab();
        switchView('map', document.querySelector('.nav-item')); 
        document.getElementById('f-route-sheet').classList.add('open'); 
        document.getElementById('f-scrim').style.display = 'block';
    }

    async function buildRoute(sourceType) {
        closeSheet(); showToast("🗺️ מייצר מסלול ניווט...");
        let waypoints = [];
        if (sourceType === 'buildings') {
            if (selectedBuildings.length === 0) { showToast("לא סימנת בניינים במפה."); return; }
            waypoints = selectedBuildings.map(b => [b.lng, b.lat]); 
        } 
        else if (sourceType === 'tasks' || sourceType === 'community') {
            let allCoords = [];
            Object.keys(db).forEach(bldg => {
                if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return;
                const coords = db[bldg].info?.coords;
                if(coords && !isNaN(coords[0]) && db[bldg].apts.length > 0) allCoords.push(coords);
            });
            waypoints = allCoords.slice(0, sourceType==='tasks'?3:5);
        }

        if (waypoints.length === 0) { showToast("לא נמצאו יעדים למסלול."); return; }
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => drawMultiStopRoute([pos.coords.longitude, pos.coords.latitude], waypoints), 
                () => {
                    const start = db?.__SETTINGS__?.homeLocation?.coords ? db.__SETTINGS__.homeLocation.coords : [34.8878, 31.9928];
                    drawMultiStopRoute(start, waypoints);
                }
            );
        }
    }

    async function drawMultiStopRoute(startCoords, waypointsArray) {
        try {
            const allPoints = [startCoords, ...waypointsArray.slice(0, 23)];
            const coordsString = allPoints.map(c => `${c[0]},${c[1]}`).join(';');
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsString}?geometries=geojson&access_token=${mapboxgl.accessToken}`;
            const res = await fetch(url); const json = await res.json();
            
            if (!json.routes?.[0]) { showToast("לא ניתן לייצר מסלול לנקודות אלו."); return; }
            const geojson = { type: 'Feature', geometry: json.routes[0].geometry };
            if (map.getSource('route')) map.getSource('route').setData(geojson);
            else map.addLayer({ id: 'route', type: 'line', source: { type: 'geojson', data: geojson }, paint: { 'line-color': '#2563eb', 'line-width': 6, 'line-opacity': 0.8 } });
            
            const bounds = new mapboxgl.LngLatBounds(allPoints[0], allPoints[0]);
            allPoints.forEach(coord => bounds.extend(coord));
            map.fitBounds(bounds, { padding: { top: 80, bottom: 80, left: 50, right: 50 }, duration: 2000 });
            showToast("🚗 מסלול נוצר בהצלחה!");
        } catch (e) { showToast("שגיאה ביצירת מסלול מול שרתי הניווט."); }
    }

    function add3DLayer() {
        if (map.getLayer('3d-buildings')) return;
        map.addLayer({
            'id': '3d-buildings', 'source': 'composite', 'source-layer': 'building', 'filter': ['==', 'extrude', 'true'],
            'type': 'fill-extrusion', 'minzoom': 15,
            'paint': { 'fill-extrusion-color': isDark ? '#1e293b' : '#e2e8f0', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.6 }
        });
    }

    function renderMarkers() {
        if (!map || !db) return;
        markers.forEach(m => m.remove()); markers = [];

        if(db.__SETTINGS__?.homeLocation?.coords) {
            const homeCoords = db.__SETTINGS__.homeLocation.coords;
            const homeEl = document.createElement('div');
            homeEl.style.cssText = `width:45px; height:45px; background-image:url('https://raw.githubusercontent.com/bmbortnik770/shlichus/refs/heads/main/favicon.ico'); background-size:contain; background-repeat:no-repeat; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5)); cursor:pointer; z-index: 5;`;
            const homeMarker = new mapboxgl.Marker(homeEl).setLngLat(homeCoords).addTo(map);
            homeEl.addEventListener('click', () => { showToast("מרכז בית חב״ד"); map.flyTo({ center: homeCoords, zoom: 18, pitch: 60 }); });
            markers.push(homeMarker);
        }

        Object.keys(db).forEach(bldg => {
            if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return;
            if(!db[bldg].apts || db[bldg].apts.length === 0) return;
            const coords = db[bldg].info?.coords;
            if(!coords || isNaN(coords[0])) return;

            const el = document.createElement('div');
            el.style.cssText = 'width:28px; height:28px; background:var(--accent); border:2px solid white; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; box-shadow:0 2px 6px rgba(0,0,0,0.4); cursor:pointer;';
            el.innerText = db[bldg].apts.length;

            const marker = new mapboxgl.Marker(el).setLngLat(coords).addTo(map);
            el.addEventListener('click', () => openArrivalSheet(bldg, 0)); 
            markers.push(marker);
        });
    }

    function toggleDarkMode() {
        isDark = !isDark; document.body.classList.toggle('dark-mode', isDark);
        localStorage.setItem('field_theme', isDark ? 'dark' : 'light');
        document.getElementById('f-theme-btn').innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        if (map) { map.setStyle(isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12'); map.once('style.load', () => { add3DLayer(); renderMarkers(); }); }
    }

    function startLocationTracking() {
        if (!navigator.geolocation) return;
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (!db) return;
                const user = [pos.coords.longitude, pos.coords.latitude];
                Object.keys(db).forEach(bldg => {
                    if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return;
                    if(!db[bldg].apts || db[bldg].apts.length === 0) return;
                    const coords = db[bldg].info?.coords;
                    if(!coords || isNaN(coords[0])) return;

                    if (calculateDistance(user, coords) < GEOFENCE_M && !isVisited(bldg)) {
                        markVisited(bldg); openArrivalSheet(bldg, 0);
                    }
                });
            }, (err) => console.error(err), { enableHighAccuracy: true }
        );
    }

    function calculateDistance(l1, l2) {
        const R = 6371e3; const dLat = (l2[1] - l1[1]) * Math.PI / 180; const dLon = (l2[0] - l1[0]) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(l1[1] * Math.PI / 180) * Math.cos(l2[1] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function switchView(viewId, element) {
        if (element) { document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active')); element.classList.add('active'); }
        document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
        document.getElementById('view-' + viewId).classList.add('active');
        if (fabIsOpen) toggleFab();
        if (viewId === 'map' && map) setTimeout(() => map.resize(), 100);
    }

    function toggleFab() {
        fabIsOpen = !fabIsOpen;
        document.getElementById('f-fab-wrapper')?.classList.toggle('open', fabIsOpen);
        const scrim = document.getElementById('f-scrim');
        if (scrim) scrim.style.display = fabIsOpen ? 'block' : 'none';
        if (fabIsOpen && navigator.vibrate) navigator.vibrate(20);
    }

    function openAddFamily() { toggleFab(); showToast("פתיחת טופס משפחה..."); }
    function openAddTask() { toggleFab(); showToast("פתיחת טופס משימה..."); }

    function openArrivalSheet(bldg, aptIdx) {
        currentTarget = { bldg, aptIdx };
        const fam = db[bldg].apts[aptIdx];
        const sheet = document.getElementById('f-sheet');
        if (!sheet || !fam) return;

        const coords = db[bldg].info?.coords;
        if(coords && !isNaN(coords[0])) map.flyTo({ center: coords, zoom: 18, pitch: 60, duration: 2000 });
        
        const safeName = fam.name || 'ללא שם';
        const addressStr = bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : bldg;
        const aptStr = fam.num ? 'דירה ' + fam.num : '';
        const bldgCode = db[bldg].info?.code || 'אין';

        document.getElementById('f-sheet-content').innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <h3 style="margin: 0 0 5px 0; font-size: 22px;">משפחת ${escapeHTML(safeName)}</h3>
                    <div style="color: var(--text-muted); font-size: 14px;"><i class="fas fa-map-marker-alt"></i> ${addressStr} ${aptStr}</div>
                </div>
                <div style="background: var(--bg-body); padding: 5px 10px; border-radius: 8px; text-align: center; border: 1px solid var(--border-light);">
                    <div style="font-size: 11px; color: var(--text-muted);">אינטרקום</div>
                    <div style="font-weight: 800; font-size: 16px; color: var(--success);">${escapeHTML(bldgCode)}</div>
                </div>
            </div>
            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <button style="flex: 1; padding: 14px; background: var(--success); color: white; border: none; border-radius: 12px; font-weight: bold; font-size: 16px;" onclick="fieldApp.closeSheet()">
                    <i class="fas fa-check"></i> הגעתי / סיום
                </button>
                <button style="width:50px; background: var(--bg-body); color: var(--text-main); border: 1px solid var(--border-light); border-radius: 12px; cursor:pointer;" onclick="fieldApp.callFamily()">
                    <i class="fas fa-phone"></i>
                </button>
            </div>
        `;
        sheet.classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
    }

    function closeSheet() { 
        document.querySelectorAll('.f-sheet').forEach(s => s.classList.remove('open'));
        document.getElementById('f-scrim').style.display = 'none';
        if (fabIsOpen) { fabIsOpen = false; document.getElementById('f-fab-wrapper')?.classList.remove('open'); }
    }

    function showToast(msg) {
        const c = document.getElementById('f-toast-container'); if (!c) return;
        const t = document.createElement('div');
        t.style.cssText = 'background:var(--surface); color:var(--text-main); padding:14px 20px; border-radius:20px; box-shadow:var(--shadow); font-weight:bold; border:1px solid var(--border-light); pointer-events:none;';
        t.innerHTML = msg; c.appendChild(t);
        setTimeout(() => { t.style.transition='opacity 0.3s'; t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 3000);
    }

    function renderTasks() {
        const c = document.getElementById('f-tasks-list'); if (!c) return;
        
        let allTasks = [];
        (db.meta?.generalTasks || []).forEach((t, i) => { if(!t.done) allTasks.push({...t, isGeneral: true, idx: i}); });
        
        Object.keys(db).forEach(bldg => {
            if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            (db[bldg].apts || []).forEach((apt, aptIdx) => {
                (apt.tasks || []).forEach((t, tIdx) => {
                    if(!t.done) allTasks.push({...t, isGeneral: false, bldg, aptIdx, tIdx, famName: apt.name});
                });
            });
        });

        if(allTasks.length === 0) {
             c.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);"><i class="fas fa-glass-cheers" style="font-size:40px; color:var(--accent); opacity:0.5; margin-bottom:15px;"></i><h3>אין משימות פתוחות!</h3></div>`;
             return;
        }

        c.innerHTML = allTasks.map((t, i) => {
            const dataAttr = t.isGeneral ? `data-general="true" data-idx="${t.idx}"` : `data-general="false" data-bldg="${encodeURIComponent(t.bldg)}" data-apt="${t.aptIdx}" data-task="${t.tIdx}"`;
            const titlePrefix = t.isGeneral ? '' : `משפחת ${t.famName}: `;
            
            return `
            <div class="task-swipe-container" style="position:relative; margin-bottom:12px; overflow:hidden; border-radius:16px; box-shadow:var(--shadow);">
                <div class="task-bg-success" style="position:absolute; top:0; left:0; width:100%; height:100%; background:var(--success); color:white; display:flex; align-items:center; padding-left:20px; font-size:20px; font-weight:bold; z-index:1;">
                    <i class="fas fa-check"></i>
                </div>
                <div class="task-item-front" ${dataAttr} style="position:relative; background:var(--surface); border:1px solid var(--border-light); padding:16px; border-radius:16px; display:flex; justify-content:space-between; align-items:center; z-index:2; transition: transform 0.2s ease;">
                    <div><div style="font-weight:600; font-size:16px;">${escapeHTML(titlePrefix + t.text)}</div><div style="font-size:13px; color:var(--text-muted); margin-top:4px;"><i class="far fa-calendar"></i> ${t.date || 'ללא מועד'}</div></div>
                </div>
            </div>`;
        }).join('');
        initSwipeLogic();
    }

    function initSwipeLogic() {
        const items = document.querySelectorAll('.task-item-front');
        items.forEach(item => {
            let startX = 0; let currentX = 0; let isDragging = false;
            item.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; isDragging = true; item.style.transition = 'none'; }, {passive: true});
            item.addEventListener('touchmove', (e) => { if (!isDragging) return; currentX = e.touches[0].clientX; let diff = currentX - startX; if (diff < 0) item.style.transform = `translateX(${diff}px)`; }, {passive: true});
            item.addEventListener('touchend', (e) => {
                if (!isDragging) return; isDragging = false; item.style.transition = 'transform 0.3s ease';
                let diff = currentX - startX;
                if (diff < -80) completeTask(item); else item.style.transform = 'translateX(0)';
            });
        });
    }

    function completeTask(item) {
        item.style.transform = 'translateX(-100%)';
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
        
        const isGeneral = item.getAttribute('data-general') === 'true';
        let payload = null;

        if (isGeneral) {
            const idx = item.getAttribute('data-idx');
            db.meta.generalTasks[idx].done = true;
            payload = { type: 'general_task_complete', taskIndex: idx };
        } else {
            const bldg = decodeURIComponent(item.getAttribute('data-bldg'));
            const aptIdx = item.getAttribute('data-apt');
            const taskIdx = item.getAttribute('data-task');
            const taskObj = db[bldg].apts[aptIdx].tasks[taskIdx];
            taskObj.done = true;
            payload = { type: 'task_done', bldg: bldg, aptName: db[bldg].apts[aptIdx].name, aptNum: db[bldg].apts[aptIdx].num, payload: { taskText: taskObj.text } };
        }
        
        storageSet(DATA_KEY, db);
        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ ...payload, timestamp: new Date().toISOString() });
        storageSet(OUTBOX_KEY, outbox);

        showToast("✅ המשימה הושלמה!");
        setTimeout(() => { const container = item.closest('.task-swipe-container'); container.style.opacity = '0'; setTimeout(() => container.remove(), 300); }, 300);
    }

    function renderCommunity() {
        const c = document.getElementById('f-community-list'); if (!c) return;
        
        let allFams = [];
        Object.keys(db).forEach(bldg => {
            if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            (db[bldg].apts || []).forEach((apt, aptIdx) => {
                allFams.push({ bldg, aptIdx, apt, address: bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : bldg });
            });
        });

        c.innerHTML = allFams.slice(0, 50).map((f) => `
            <div style="background:var(--surface); border:1px solid var(--border-light); padding:16px; border-radius:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow);">
                <div><div style="font-weight:600; font-size:16px;">משפחת ${escapeHTML(f.apt.name || 'ללא שם')}</div><div style="font-size:13px; color:var(--text-muted); margin-top:4px;">${escapeHTML(f.address)}</div></div>
                <button style="background:var(--accent); border:none; width:40px; height:40px; border-radius:50%; color:white; cursor:pointer; box-shadow:0 4px 10px rgba(37,99,235,0.3);" onclick="fieldApp.openArrivalSheet('${encodeURIComponent(f.bldg)}', ${f.aptIdx})"><i class="fas fa-map-marker-alt"></i></button>
            </div>`).join('');
    }

    function jumpToCenter() {
        const c = db?.__SETTINGS__?.homeLocation?.coords ? db.__SETTINGS__.homeLocation.coords : [34.8878, 31.9928];
        map.flyTo({ center: c, zoom: 18, pitch: 60 });
    }
    
    function recenter() { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 17, pitch: 60 })); }
    
    function callFamily() { 
        if (!currentTarget) return;
        const fam = db[currentTarget.bldg].apts[currentTarget.aptIdx];
        const phones = [fam.fatherPhone, fam.motherPhone, ...(fam.childrenList||[]).map(c=>c.phone)].filter(Boolean);
        if (phones.length > 0) window.location.href = `tel:${phones[0]}`; else showToast("אין מספר רשום"); 
    }

    function openArrivalSheetEncoded(bEnc, idx) { openArrivalSheet(decodeURIComponent(bEnc), idx); }
    
    // פונקציית ההגנה שתוקנה לחלוטין:
    function escapeHTML(str) { 
        return String(str).replace(/[&<>"']/g, function(m) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m];
        }); 
    }

    return { init, login, switchView, toggleFab, openRouteMenu, buildRoute, openAddFamily, openAddTask, openArrivalSheet: openArrivalSheetEncoded, closeSheet, jumpToCenter, recenter, callFamily, toggleDarkMode, forceSync };
})();

window.addEventListener('DOMContentLoaded', () => fieldApp.init());
