'use strict';

const CLIENT_ID   = '348261974014-242r9b0dvctlka7rj3aetu81v96ere46.apps.googleusercontent.com';
const SCOPES      = 'email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
const GEOFENCE_M  = 30;   
const DATA_KEY    = 'field_data';
const VISITED_KEY = 'field_visited';
const OUTBOX_KEY  = 'field_outbox'; 
const SYNC_TIME_KEY = 'field_last_sync';
const NO_ADDRESS_KEY = "__NO_ADDRESS__";
const SAVED_ROUTES_KEY = 'field_saved_routes';

mapboxgl.accessToken = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';
mapboxgl.setRTLTextPlugin('https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js', null, true);

const fieldApp = (function () {
    // ==========================================
    // ריכוז משתנים
    // ==========================================
    let map = null, markers = [], db = null;
    let accessToken = null, isOfflineMode = false, currentTarget = null;
    let watchId = null, fabIsOpen = false, isDark = false, tokenClient = null;
    let isMissionActive = false, pressTimer = null, isDraggingMap = false;
    let recognition = null, isRecording = false;
    let pendingAutoTaskContext = null, editingFamilyContext = null; 
    let selectedCoords = null; 

    // משתני בניית מסלול
    let isRouteBuilderMode = false;      
    let selectedRouteBuildings = [];     
    let routeStepMarkers = [];           
    let activeBuildingFeatureId = null;  
    let pendingRouteWaypoints = [];      
    let cardPressTimer = null;           

    // משתני ניווט שטח (HUD)
    let missionWaypoints = [];
    let missionCurrentIdx = 0;
    let missionPaused = false;
    let taskLayerVisible = false;
    let taskMarkers = [];
    let currentDraftRoute = [];
    let activeRouteIndex = 0;

    // ==========================================
    // פונקציות בסיס ועזר
    // ==========================================
    const storageGet = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
    const storageSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));
    const getVisited = () => storageGet(VISITED_KEY) || {};
    const markVisited = (id) => { const v = getVisited(); v[id] = new Date().toISOString(); storageSet(VISITED_KEY, v); };
    const isVisited = (id) => !!getVisited()[id];

    function escapeHTML(str) { 
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, function(m) { 
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; 
        }); 
    }

    function calculateDistance(coord1, coord2) {
        const R = 6371e3;
        const r1 = coord1[1] * Math.PI/180;
        const r2 = coord2[1] * Math.PI/180;
        const dLat = (coord2[1]-coord1[1]) * Math.PI/180;
        const dLon = (coord2[0]-coord1[0]) * Math.PI/180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(r1) * Math.cos(r2) * Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    function showToast(msg) {
        const c = document.getElementById('f-toast-container');
        if (!c) return;
        const t = document.createElement('div');
        t.style.cssText = 'background:var(--surface); color:var(--text-main); padding:14px 20px; border-radius:20px; box-shadow:var(--shadow); font-weight:bold; border:1px solid var(--border-light); pointer-events:none;';
        t.innerHTML = msg;
        c.appendChild(t);
        setTimeout(() => { t.style.transition='opacity 0.3s'; t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 3000);
    }

    function setSyncStatus(state) {
        const widget = document.getElementById('sync-widget');
        if (!widget) return;
        const text = widget.querySelector('.sync-text');
        // הסר כל מצב קודם
        widget.className = 'sync-widget';
        if (state === 'syncing') {
            widget.classList.add('status-syncing', 'expanded');
            if (text) text.innerText = 'מסנכרן...';
            // סגירה אוטומטית אחרי 8 שניות אם לא עבר למצב אחר
        } else if (state === 'success') {
            const timeStr = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
            localStorage.setItem(SYNC_TIME_KEY, timeStr);
            widget.classList.add('status-online', 'expanded');
            if (text) text.innerText = `עודכן ב- ${timeStr}`;
            setTimeout(() => widget.classList.remove('expanded'), 3000);
        } else if (state === 'offline') {
            widget.classList.add('status-offline');
            if (text) text.innerText = 'אין רשת';
        } else if (state === 'error') {
            widget.classList.add('status-error');
            if (text) text.innerText = 'שגיאת סנכרון';
        }
    }

    function toggleSyncDetails() {
        const widget = document.getElementById('sync-widget');
        if (!widget) return;
        widget.classList.toggle('expanded');
        if (widget.classList.contains('expanded')) {
            setTimeout(() => widget.classList.remove('expanded'), 4000);
        }
    }

    // ==========================================
    // אתחול וחיבור לגוגל
    // ==========================================
    async function init() {
        // זיהוי ייחודי לכל מכשיר — לצורך מעקב מקור עדכונים
        if (!localStorage.getItem('field_device_id')) {
            localStorage.setItem('field_device_id', 'field_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        }
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

    function initSpeech() {
        window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (window.SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.lang = 'he-IL'; recognition.interimResults = true; recognition.continuous = true;
            recognition.onresult = (e) => { let t = ''; for (let i = e.resultIndex; i < e.results.length; ++i) t += e.results[i][0].transcript; document.getElementById('f-voice-result').value = t; };
            recognition.onerror = (e) => { stopVoiceRecording(); };
            recognition.onend = () => { if(isRecording) recognition.start(); };
        }
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
            // בדוק ומחק קבצי outbox שסומנו כ-processed על ידי המשרד
            await cleanProcessedOutboxFiles();

            const query = encodeURIComponent(`name='community_data_final.json' and trashed=false`);
            const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder,drive&orderBy=modifiedTime desc&fields=files(id,name)`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const searchData = await searchRes.json();
            if (!searchData.files || searchData.files.length === 0) { showToast("⚠️ לא נמצא קובץ נתונים"); setSyncStatus('error'); continueOffline(); return; }
            const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const textData = await dlRes.text();
            try { 
                db = JSON.parse(textData); if(!db.meta) db.meta = {}; storageSet(DATA_KEY, db); setSyncStatus('success'); 
                document.getElementById('f-fab-wrapper').style.display = 'flex';
                if(map) { renderMarkers(); renderTasks(); renderCommunity(); } 
                checkForOfficeRoute();
                // סריקת אנשי קשר אוטומטית (אחרי 3 שניות כדי שהאפליקציה תתייצב)
                setTimeout(() => scanContacts(false), 3000);
            } catch(e) { setSyncStatus('error'); continueOffline(); }
        } catch (e) { setSyncStatus('offline'); continueOffline(); }
    }

    // ── בדיקת קבצי outbox שסומנו כ-processed ומחיקתם ──
    async function cleanProcessedOutboxFiles() {
        if (!accessToken) return;
        const savedFileIds = storageGet('outbox_file_ids') || [];
        if (savedFileIds.length === 0) return;

        const toDelete = [];
        for (const entry of savedFileIds) {
            try {
                const res = await fetch(
                    `https://www.googleapis.com/drive/v3/files/${entry.fileId}?alt=media`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                if (!res.ok) { toDelete.push(entry.fileId); continue; } // כבר נמחק
                const content = await res.json();
                if (content._processed) {
                    // המשרד סימן כעובד — מחק
                    await fetch(`https://www.googleapis.com/drive/v3/files/${entry.fileId}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${accessToken}` }
                    });
                    toDelete.push(entry.fileId);
                    console.log(`[Outbox] קובץ ${entry.filename} עובד ונמחק`);
                }
            } catch(e) { console.warn('[Outbox] clean error:', e); }
        }

        if (toDelete.length > 0) {
            const remaining = savedFileIds.filter(e => !toDelete.includes(e.fileId));
            storageSet('outbox_file_ids', remaining);
        }
    }

    function continueOffline() {
        isOfflineMode = true; db = storageGet(DATA_KEY); setSyncStatus('offline');
        if (db) { document.getElementById('f-login').style.display = 'none'; document.getElementById('f-fab-wrapper').style.display = 'flex'; bootMap(); startLocationTracking(); checkForOfficeRoute(); }
        else { showToast("❌ חובה חיבור רשת לאיפוס ראשוני"); showAuthScreen(); }
    }

    function checkForOfficeRoute() {
        if (db && db.meta && db.meta.assignedRoute && db.meta.assignedRoute.length > 0) {
            const count = db.meta.assignedRoute.length;
            const officeBtn = document.getElementById('btn-office-route');
            const countSpan = document.getElementById('f-office-route-count');
            if (officeBtn && countSpan) { officeBtn.style.display = 'flex'; countSpan.innerText = count; }
        }
    }

    // ==========================================
    // OUTBOX — שליחת שינויים לדרייב
    // כל שינוי שנעשה בשטח נכנס ל-OUTBOX_KEY ב-localStorage
    // ובעת סנכרון נכתב לקובץ mobile_update_TIMESTAMP.json בדרייב
    // המערכת השולחנית קוראת ומוחקת קבצים אלה
    // ==========================================
    async function pushOutboxToDrive() {
        if (!accessToken) return;
        const outbox = storageGet(OUTBOX_KEY) || [];
        if (outbox.length === 0) return;

        setSyncStatus('syncing');
        const ts = Date.now();
        const filename = `mobile_update_${ts}.json`;

        // כתוב את כל הפריטים ב-outbox לקובץ אחד
        const payload = {
            createdAt: new Date().toISOString(),
            deviceId: localStorage.getItem('field_device_id') || 'unknown',
            events: outbox
        };

        try {
            // צור את הקובץ ב-Drive
            const meta = { name: filename, mimeType: 'application/json' };
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
            form.append('file', blob);

            const res = await fetch(
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
                {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    body: form
                }
            );

            if (res.ok) {
                const created = await res.json();
                // שמור את ה-fileId כדי שנוכל למחוק את הקובץ אחרי עיבוד
                const savedFileIds = storageGet('outbox_file_ids') || [];
                savedFileIds.push({ fileId: created.id, filename, ts });
                // שמור רק 20 אחרונים
                if (savedFileIds.length > 20) savedFileIds.splice(0, savedFileIds.length - 20);
                storageSet('outbox_file_ids', savedFileIds);
                // נקה את ה-outbox רק אחרי שהשמירה הצליחה
                storageSet(OUTBOX_KEY, []);
                console.log(`[Outbox] שולח ${outbox.length} אירועים לדרייב → ${filename}`);
            } else {
                console.warn('[Outbox] שגיאה בשליחה:', res.status);
            }
        } catch (e) {
            console.error('[Outbox] שגיאת רשת:', e);
            // ה-outbox נשאר ב-localStorage לניסיון הבא
        }
    }
    async function forceSync(event) {
        if (event) event.stopPropagation();
        if (!navigator.onLine) { showToast("אין חיבור רשת"); setSyncStatus('offline'); return; }
        if (!accessToken) { login(); return; }
        setSyncStatus('syncing');
        await pushOutboxToDrive();
        await loadDataFromDrive();
    }

    // ==========================================
    // מפה ולוגיקת קליקים
    // ==========================================
    function bootMap() {
        if(map) return;
        setTimeout(() => document.getElementById('f-splash').style.display = 'none', 500);
        let centerCoords = db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928];
        map = new mapboxgl.Map({ container: 'f-map', style: isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12', center: centerCoords, zoom: 15, pitch: 60, antialias: true });
        map.on('load', () => { 
            add3DLayer(); renderMarkers(); renderTasks(); renderCommunity(); initClickLogic();
            // מאזין ללחיצה ימנית/לחיצה ארוכה על בניין להוספה למסלול
            map.on('contextmenu', '3d-buildings', async (e) => {
                if (!e.features.length) return;
                const lngLat = e.lngLat;
                try {
                    const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lngLat.lng},${lngLat.lat}.json?types=address&language=he&access_token=${mapboxgl.accessToken}`);
                    const d = await r.json();
                    const addr = d.features?.[0] ? (d.features[0].place_name_he || d.features[0].place_name).split(',')[0].trim() : `מיקום`;
                    addStopToRoute(e.features[0].id, addr, addr, [lngLat.lng, lngLat.lat]);
                } catch(err) {
                    addStopToRoute(e.features[0].id, 'בניין', 'מיקום מהמפה', [lngLat.lng, lngLat.lat]);
                }
            });
        });
    }

    function add3DLayer() { 
        if (map.getLayer('3d-buildings')) return; 
        map.addLayer({ 
            'id': '3d-buildings', 'source': 'composite', 'source-layer': 'building', 'filter': ['==', 'extrude', 'true'], 'type': 'fill-extrusion', 'minzoom': 15, 
            'paint': { 
                'fill-extrusion-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], '#2563eb', 
                    ['boolean', ['feature-state', 'active'], false], '#f59e0b',   
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

                if (activeBuildingFeatureId) map.setFeatureState({source: 'composite', sourceLayer: 'building', id: activeBuildingFeatureId}, { active: false });
                activeBuildingFeatureId = feature.id;
                map.setFeatureState({source: 'composite', sourceLayer: 'building', id: feature.id}, { active: true });

                // חיפוש גמיש — קודם התאמה מדויקת, אח"כ לפי קואורדינטות
                let matchedKey = null;
                if (db[addr]) {
                    matchedKey = addr;
                } else {
                    // חיפוש לפי קרבה גיאוגרפית — רק עד 15 מטר ועם נתונים
                    let minDist = 0.00015; // ~15 מטר
                    Object.keys(db).forEach(key => {
                        if (key === '__BOARDS__' || key === '__SETTINGS__' || key === 'meta') return;
                        if (!db[key].apts?.length) return; // רק בניינים עם משפחות
                        const c = db[key].info?.coords;
                        if (!c) return;
                        const dist = Math.sqrt(Math.pow(c[0]-lngLat.lng,2) + Math.pow(c[1]-lngLat.lat,2));
                        if (dist < minDist) { minDist = dist; matchedKey = key; }
                    });
                }

                if (matchedKey) openBuildingCard(matchedKey, false);
                else openEmptyBuildingCard(addr, [lngLat.lng, lngLat.lat]);
            } catch(err) { console.error(err); }
        });
        
        map.on('mousedown', handlePointerDown);
        map.on('mousemove', () => isDraggingMap = true);
        map.on('mouseup', handlePointerUp);
        map.on('touchstart', handlePointerDown, {passive: true});
        map.on('touchmove', () => isDraggingMap = true, {passive: true});
        map.on('touchend', handlePointerUp, {passive: true});
    }

    function handlePointerDown(e) { isDraggingMap = false; pressTimer = setTimeout(() => { if(!isDraggingMap) { if(navigator.vibrate) navigator.vibrate([30,50,30]); openRouteMenu(); } }, 900); }
    function handlePointerUp(e) { clearTimeout(pressTimer); }

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
            el.addEventListener('click', (e) => { 
                e.stopPropagation(); 
                if (activeBuildingFeatureId) map.setFeatureState({source: 'composite', sourceLayer: 'building', id: activeBuildingFeatureId}, { active: false });
                openBuildingCard(bldg); 
            }); 
            markers.push(marker);
        });
    }

    // ==========================================
    // *** עדכון מרכזי: openBuildingCard עם תמונת Street View ***
    // ==========================================

    // ==========================================
    // מגירה ראשית מאוחדת
    // ==========================================
    function openSheet(htmlContent, heightMode = 'auto') {
        closeOverlays();
        const sheet = document.getElementById('f-sheet');
        const sheetContent = document.getElementById('f-sheet-content');
        
        // גבהים
        sheet.style.height = '';
        sheet.style.maxHeight = '';
        sheet.style.borderRadius = '24px 24px 0 0';

        if (heightMode === 'full') {
            sheet.style.height = '92vh';
        } else if (heightMode === 'half') {
            sheet.style.maxHeight = '60vh';
        } else {
            sheet.style.maxHeight = '85vh';
        }

        sheetContent.innerHTML = htmlContent;
        sheet.classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
        if (db) document.getElementById('f-fab-wrapper').style.display = 'flex';
    }

    function openBuildingCard(bldg, isFromRouteMode = false) {
        closeOverlays();
        const sheet = document.getElementById('f-sheet');
        const info = db[bldg].info || {};
        const coords = info.coords;
        const bldgCode = info.code || 'אין';
        const apts = db[bldg].apts || [];

        if (coords && !isNaN(coords[0])) map.flyTo({ center: coords, zoom: 18, pitch: 60, duration: 1500 });

        // Street View thumbnail — fallback לסמל favicon אם אין מפתח
        // להחלפה: שנה YOUR_GOOGLE_KEY למפתח אמיתי
        const GOOGLE_KEY = ''; // ← הכנס כאן מפתח Google API אם יש
        const streetViewUrl = (coords && GOOGLE_KEY)
            ? `https://maps.googleapis.com/maps/api/streetview?size=400x400&location=${coords[1]},${coords[0]}&fov=90&key=${GOOGLE_KEY}`
            : null;

        // ID ייחודי לקידוד בטוח ב-onclick
        const safeBldgEnc = encodeURIComponent(bldg);

        let html = `<button class="sheet-close-btn" onclick="fieldApp.closeOverlays()"><i class="fas fa-times"></i></button>`;

        html += `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-light); padding-bottom:15px; margin-bottom:15px; margin-top:5px;">
            <div style="flex:1; padding-left:10px;">
                <h3 style="margin:0 0 5px 0; font-size:20px;"><i class="fas fa-building" style="color:var(--accent);"></i> ${escapeHTML(bldg)}</h3>
                <div style="color:var(--text-muted); font-size:13px;">${apts.length} משפחות · קוד אינטרקום: <span style="color:var(--success); font-weight:800;">${escapeHTML(bldgCode)}</span></div>
            </div>
            ${streetViewUrl
                ? `<img src="${streetViewUrl}" class="bldg-profile-img" 
                    onerror="this.style.display='none'" 
                    onclick="fieldApp.openFullImage('${streetViewUrl.replace(/'/g, "&#39;")}')" 
                    alt="תמונת בניין">`
                : `<div style="width:60px;height:60px;border-radius:12px;background:var(--bg-body);border:2px solid var(--border-light);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:24px;flex-shrink:0;"><i class="fas fa-building"></i></div>`
            }
        </div>`;

        if (!isFromRouteMode) {
            html += `<div style="display:flex; gap:10px; margin-bottom:15px;">
                <button onclick="fieldApp.promptAddToRoute('${safeBldgEnc}')" style="flex:1; padding:12px; background:var(--accent); color:white; border:none; border-radius:12px; font-weight:bold; font-size:14px; cursor:pointer;"><i class="fas fa-route"></i> הוסף למסלול</button>
                <button onclick="fieldApp.openQuickFamilyForm('${escapeHTML(bldg)}')" style="flex:1; padding:12px; background:rgba(16,185,129,0.1); color:var(--success); border:1px solid var(--success); border-radius:12px; font-weight:bold; font-size:14px; cursor:pointer;"><i class="fas fa-user-plus"></i> הוסף משפחה</button>
            </div>`;
        }

        html += `<div style="max-height:30vh; overflow-y:auto;">`;
        apts.forEach((fam, idx) => {
            html += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-body); padding:12px; border-radius:12px; margin-bottom:10px; cursor:pointer;" 
                onclick="fieldApp.openFamilyCardMini('${safeBldgEnc}', ${idx})">
                <div>
                    <div style="font-weight:bold; font-size:15px;">משפחת ${escapeHTML(fam.name || 'ללא שם')}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${fam.num ? 'דירה ' + escapeHTML(String(fam.num)) : ''}</div>
                </div>
                <i class="fas fa-chevron-left" style="color:var(--text-muted);"></i>
            </div>`;
        });
        html += `</div>`;

        openSheet(html);
    }

    // ==========================================
    // *** חדש: הגדלת תמונה מלאה ***
    // ==========================================
    function openFullImage(url) {
        let el = document.getElementById('f-full-img');
        if (!el) {
            el = document.createElement('div');
            el.id = 'f-full-img';
            el.className = 'full-img-overlay';
            el.onclick = () => { el.style.display = 'none'; };
            document.body.appendChild(el);
        }
        el.innerHTML = `
            <img src="${escapeHTML(url)}" alt="תמונת בניין" onerror="this.alt='לא ניתן לטעון תמונה'">
            <div class="close-hint"><i class="fas fa-times-circle"></i> לחץ לסגירה</div>
        `;
        el.style.display = 'flex';
    }

    function openFullFamilyCard(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        if (!db[bldg] || !db[bldg].apts[aptIdx]) return;
        // סגור כל מגירה פתוחה קודם
        const fSheet = document.getElementById('f-sheet');
        if (fSheet) fSheet.classList.remove('open');
        document.getElementById('f-scrim').style.display = 'none';
        _ffcRender(bldgEnc, aptIdx, 'details');
        const sheet = document.getElementById('ffc-snap-sheet');
        sheet.className = 'bottom-sheet snap-sheet active state-half';
        _initFFCDrag(sheet);
    }

    function _ffcRender(bldgEnc, aptIdx, activeTab) {
        const bldg = decodeURIComponent(bldgEnc);
        const fam = db[bldg].apts[aptIdx];
        if (!fam) return;

        const interactions = fam.interactions || fam.history || [];
        const donations = fam.donations || [];
        const openTasks = (fam.tasks || []).filter(t => !t.done).length;
        const phone1 = fam.fatherPhone || fam.phone || '';
        const phone2 = fam.motherPhone || '';

        // --- טאב פרטים (עריכה) ---
        const detailsHtml = `
        <div style="display:flex;flex-direction:column;gap:12px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">שם האב</label>
                <input id="ffc-father" value="${escapeHTML(fam.father||fam.fatherName||'')}" class="ffc-input" placeholder="שם האב..."></div>
                <div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">שם האם</label>
                <input id="ffc-mother" value="${escapeHTML(fam.mother||fam.motherName||'')}" class="ffc-input" placeholder="שם האם..."></div>
                <div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">טלפון אב</label>
                <input id="ffc-father-phone" value="${escapeHTML(phone1)}" class="ffc-input" placeholder="05X-XXXXXXX" dir="ltr"></div>
                <div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">טלפון אם</label>
                <input id="ffc-mother-phone" value="${escapeHTML(phone2)}" class="ffc-input" placeholder="05X-XXXXXXX" dir="ltr"></div>
                <div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">מייל אב</label>
                <input id="ffc-father-email" value="${escapeHTML(fam.fatherEmail||'')}" class="ffc-input" placeholder="mail@..." dir="ltr"></div>
                <div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">מייל אם</label>
                <input id="ffc-mother-email" value="${escapeHTML(fam.motherEmail||'')}" class="ffc-input" placeholder="mail@..." dir="ltr"></div>
            </div>
            <div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">סגנון</label>
            <input id="ffc-style" value="${escapeHTML(fam.style||'')}" class="ffc-input" placeholder="חרדי / דתי / מסורתי..."></div>
            <div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">הערות</label>
            <textarea id="ffc-notes" class="ffc-input" rows="3" placeholder="הערות פנימיות...">${escapeHTML(fam.notes||'')}</textarea></div>
            <div>
                <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:6px;">תגיות</label>
                <div id="ffc-tags-display" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
                    ${(fam.tags||[]).map((t,i) => `<span style="background:var(--accent);color:white;padding:4px 10px;border-radius:15px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px;">${escapeHTML(t)}<i class="fas fa-times" style="cursor:pointer;font-size:10px;" onclick="fieldApp._ffcRemoveTag('${bldgEnc}',${aptIdx},${i})"></i></span>`).join('')}
                </div>
                <div style="display:flex;gap:8px;">
                    <input id="ffc-tag-input" class="ffc-input" placeholder="הוסף תגית..." style="flex:1;">
                    <button onclick="fieldApp._ffcAddTag('${bldgEnc}',${aptIdx})" style="padding:10px 16px;background:var(--accent);color:white;border:none;border-radius:10px;font-weight:bold;cursor:pointer;"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <div>
                <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:6px;"><i class="fas fa-child"></i> ילדים</label>
                <div id="ffc-children-list">
                    ${(fam.childrenList||[]).map((c,i) => `
                    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
                        <input value="${escapeHTML(c.name||'')}" class="ffc-input" style="flex:2;" placeholder="שם" oninput="fieldApp._ffcUpdateChild('${bldgEnc}',${aptIdx},${i},'name',this.value)">
                        <input type="date" value="${escapeHTML(c.dob||'')}" class="ffc-input" style="flex:2;" oninput="fieldApp._ffcUpdateChild('${bldgEnc}',${aptIdx},${i},'dob',this.value)">
                        <button onclick="fieldApp._ffcRemoveChild('${bldgEnc}',${aptIdx},${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;"><i class="fas fa-times"></i></button>
                    </div>`).join('')}
                </div>
                <button onclick="fieldApp._ffcAddChild('${bldgEnc}',${aptIdx})" style="width:100%;padding:9px;background:var(--bg-body);border:1px dashed var(--border-light);border-radius:10px;color:var(--text-muted);cursor:pointer;font-family:inherit;">
                    <i class="fas fa-plus"></i> הוסף ילד/ה
                </button>
            </div>
            <button onclick="fieldApp._ffcSaveDetails('${bldgEnc}',${aptIdx})" style="width:100%;padding:14px;background:var(--accent);color:white;border:none;border-radius:12px;font-weight:bold;font-size:16px;cursor:pointer;font-family:inherit;">
                <i class="fas fa-save"></i> שמור פרטים
            </button>
            <button onclick="fieldApp._ffcDelete('${bldgEnc}',${aptIdx})" style="width:100%;padding:12px;background:rgba(239,68,68,0.08);color:var(--danger);border:1px solid rgba(239,68,68,0.3);border-radius:12px;font-weight:bold;font-size:15px;cursor:pointer;font-family:inherit;">
                <i class="fas fa-trash"></i> מחק משפחה
            </button>
        </div>`;

        // --- טאב משימות ---
        const allTasks = fam.tasks || [];
        const tasksHtml = `
        <div style="display:flex;flex-direction:column;gap:8px;">
            ${allTasks.length === 0
                ? `<div style="text-align:center;padding:20px;color:var(--text-muted);"><i class="fas fa-check-circle" style="font-size:30px;opacity:0.3;display:block;margin-bottom:8px;"></i>אין משימות</div>`
                : allTasks.map((t,i) => `
                <div style="background:${t.done?'var(--bg-body)':'rgba(37,99,235,0.06)'};border:1px solid ${t.done?'var(--border-light)':'rgba(37,99,235,0.2)'};padding:10px 12px;border-radius:10px;display:flex;gap:10px;align-items:center;">
                    <input type="checkbox" ${t.done?'checked':''} onchange="fieldApp._ffcToggleTask('${bldgEnc}',${aptIdx},${i},this.checked)" style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0;">
                    <div style="flex:1;">
                        <div style="font-size:14px;font-weight:600;${t.done?'text-decoration:line-through;opacity:0.5;':''}">${escapeHTML(t.text)}</div>
                        ${t.date?`<div style="font-size:12px;color:var(--text-muted);">${escapeHTML(t.date)}</div>`:''}
                    </div>
                    <button onclick="fieldApp._ffcDeleteTask('${bldgEnc}',${aptIdx},${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fas fa-trash"></i></button>
                </div>`).join('')}
            <div style="border-top:1px solid var(--border-light);margin-top:8px;padding-top:12px;">
                <div style="display:flex;gap:8px;">
                    <input id="ffc-new-task" class="ffc-input" placeholder="משימה חדשה..." style="flex:1;">
                    <input type="date" id="ffc-new-task-date" class="ffc-input" style="width:130px;">
                    <button onclick="fieldApp._ffcAddTask('${bldgEnc}',${aptIdx})" style="padding:10px 16px;background:var(--accent);color:white;border:none;border-radius:10px;font-weight:bold;cursor:pointer;"><i class="fas fa-plus"></i></button>
                </div>
            </div>
        </div>`;

        // --- טאב קשר ---
        const logsHtml = `
        <div style="display:flex;flex-direction:column;gap:8px;">
            ${interactions.length === 0
                ? `<div style="text-align:center;padding:20px;color:var(--text-muted);"><i class="fas fa-comments" style="font-size:30px;opacity:0.3;display:block;margin-bottom:8px;"></i>אין היסטוריית קשר</div>`
                : [...interactions].reverse().map((l,i) => {
                    const realIdx = interactions.length - 1 - i;
                    const type = l.type||l.status||'כללי';
                    const text = l.text||l.notes||l.content||'';
                    const colorMap = {'ביקור':'var(--success)','שיחה':'var(--accent)','בוצע':'var(--success)','אין מענה':'var(--warning)','לא מעוניינים':'var(--danger)'};
                    const color = colorMap[type]||'var(--text-muted)';
                    return `<div style="background:var(--bg-body);border-right:4px solid ${color};border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:flex-start;">
                        <div style="flex:1;">
                            <div style="display:flex;gap:8px;margin-bottom:3px;">
                                <span style="font-weight:700;font-size:13px;color:${color};">${escapeHTML(type)}</span>
                                <span style="font-size:12px;color:var(--text-muted);">${escapeHTML(l.date||'')}</span>
                            </div>
                            ${text?`<div style="font-size:13px;">${escapeHTML(text)}</div>`:''}
                        </div>
                        <button onclick="fieldApp._ffcDeleteLog('${bldgEnc}',${aptIdx},${realIdx})" style="background:none;border:none;color:var(--danger);cursor:pointer;margin-right:5px;"><i class="fas fa-trash"></i></button>
                    </div>`;
                }).join('')}
            <div style="border-top:1px solid var(--border-light);margin-top:8px;padding-top:12px;display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;gap:8px;">
                    <select id="ffc-log-type" class="ffc-input" style="flex:1;">
                        <option>ביקור</option><option>שיחה</option><option>הודעה</option><option>אחר</option>
                    </select>
                    <input type="date" id="ffc-log-date" class="ffc-input" style="flex:1;" value="${new Date().toISOString().split('T')[0]}">
                </div>
                <textarea id="ffc-log-text" class="ffc-input" rows="2" placeholder="מה היה?..."></textarea>
                <button onclick="fieldApp._ffcAddLog('${bldgEnc}',${aptIdx})" style="width:100%;padding:12px;background:var(--accent);color:white;border:none;border-radius:10px;font-weight:bold;cursor:pointer;font-family:inherit;"><i class="fas fa-plus"></i> הוסף תיעוד</button>
            </div>
        </div>`;

        // --- טאב תרומות ---
        const donationsTotal = donations.reduce((s,d)=>s+Number(d.amount||0),0);
        const donationsHtml = `
        <div style="display:flex;flex-direction:column;gap:8px;">
            ${donations.length > 0 ? `<div style="text-align:center;background:rgba(16,185,129,0.1);color:var(--success);padding:12px;border-radius:10px;font-size:18px;font-weight:bold;margin-bottom:4px;">סה"כ: ₪${donationsTotal}</div>` : ''}
            ${donations.length === 0
                ? `<div style="text-align:center;padding:20px;color:var(--text-muted);"><i class="fas fa-hand-holding-heart" style="font-size:30px;opacity:0.3;display:block;margin-bottom:8px;"></i>אין תרומות</div>`
                : [...donations].reverse().map((d,i) => {
                    const realIdx = donations.length - 1 - i;
                    return `<div style="background:var(--bg-body);padding:10px 12px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-weight:700;font-size:15px;color:var(--success);">₪${escapeHTML(String(d.amount))}</div>
                            <div style="font-size:12px;color:var(--text-muted);">${escapeHTML(d.reason||'')} · ${escapeHTML(d.date||'')}</div>
                        </div>
                        <button onclick="fieldApp._ffcDeleteDonation('${bldgEnc}',${aptIdx},${realIdx})" style="background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fas fa-trash"></i></button>
                    </div>`;
                }).join('')}
            <div style="border-top:1px solid var(--border-light);margin-top:8px;padding-top:12px;display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;gap:8px;">
                    <input type="number" id="ffc-don-amount" class="ffc-input" placeholder="סכום ₪" style="flex:1;">
                    <input type="date" id="ffc-don-date" class="ffc-input" style="flex:1;" value="${new Date().toISOString().split('T')[0]}">
                </div>
                <input id="ffc-don-reason" class="ffc-input" placeholder="עבור מה?">
                <button onclick="fieldApp._ffcAddDonation('${bldgEnc}',${aptIdx})" style="width:100%;padding:12px;background:var(--success);color:white;border:none;border-radius:10px;font-weight:bold;cursor:pointer;font-family:inherit;"><i class="fas fa-plus"></i> הוסף תרומה</button>
            </div>
        </div>`;

        const tabs = [
            {id:'details', label:'פרטים', content: detailsHtml},
            {id:'tasks', label:`משימות (${openTasks})`, content: tasksHtml},
            {id:'logs', label:`קשר (${interactions.length})`, content: logsHtml},
            {id:'donations', label:`תרומות (${donations.length})`, content: donationsHtml},
        ];

        const html = `
        <style>.ffc-input{width:100%;padding:9px 11px;border:1px solid var(--border-light);border-radius:10px;background:var(--bg-body);color:var(--text-main);font-family:inherit;font-size:14px;box-sizing:border-box;}</style>
        <button class="sheet-close-btn" onclick="fieldApp.closeFFCSheet()"><i class="fas fa-times"></i></button>
        <div style="overflow-y:auto;max-height:calc(92vh - 50px);padding-bottom:20px;margin-top:15px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                <div>
                    <h2 style="margin:0 0 3px 0;font-size:20px;">משפחת ${escapeHTML(fam.name||'ללא שם')}</h2>
                    <div style="font-size:13px;color:var(--text-muted);">
                        <i class="fas fa-map-marker-alt"></i> ${escapeHTML(bldg===NO_ADDRESS_KEY?'ללא כתובת':bldg)}
                        ${fam.num?' · דירה '+escapeHTML(String(fam.num)):''}
                    </div>
                </div>
                <div style="display:flex;gap:8px;">
                    ${phone1?`<button onclick="fieldApp.callFamilyNumber('${phone1}')" style="width:38px;height:38px;border-radius:50%;background:var(--bg-body);border:1px solid var(--border-light);color:var(--success);font-size:15px;cursor:pointer;"><i class="fas fa-phone"></i></button>`:''}
                    ${phone1?`<button onclick="window.open('https://wa.me/${phone1.replace(/\D/g,'').replace(/^0/,'972')}','_blank')" style="width:38px;height:38px;border-radius:50%;background:#25D366;border:none;color:white;font-size:15px;cursor:pointer;"><i class="fab fa-whatsapp"></i></button>`:''}
                </div>
            </div>
            <div style="display:flex;border-bottom:1px solid var(--border-light);margin-bottom:15px;overflow-x:auto;gap:0;">
                ${tabs.map(t => `<div onclick="fieldApp._ffcTab('${t.id}')" id="ffc-tab-${t.id}" style="padding:9px 13px;border-bottom:3px solid ${t.id===activeTab?'var(--accent)':'transparent'};color:${t.id===activeTab?'var(--accent)':'var(--text-muted)'};font-weight:${t.id===activeTab?'bold':'normal'};cursor:pointer;white-space:nowrap;font-size:13px;">${t.label}</div>`).join('')}
            </div>
            ${tabs.map(t => `<div id="ffc-content-${t.id}" style="display:${t.id===activeTab?'block':'none'};">${t.content}</div>`).join('')}
        </div>`;

        const wrapper = document.getElementById('ffc-content-wrapper');
        if (wrapper) wrapper.innerHTML = html;
        else document.getElementById('f-sheet-content').innerHTML = html;
    }

    function _ffcSaveDetails(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        const fam = db[bldg].apts[aptIdx];
        fam.father = document.getElementById('ffc-father').value.trim();
        fam.fatherName = fam.father;
        fam.mother = document.getElementById('ffc-mother').value.trim();
        fam.motherName = fam.mother;
        fam.fatherPhone = document.getElementById('ffc-father-phone').value.trim();
        fam.motherPhone = document.getElementById('ffc-mother-phone').value.trim();
        fam.fatherEmail = document.getElementById('ffc-father-email').value.trim();
        fam.motherEmail = document.getElementById('ffc-mother-email').value.trim();
        fam.style = document.getElementById('ffc-style').value.trim();
        fam.notes = document.getElementById('ffc-notes').value.trim();
        fam.updatedAt = Date.now();
        storageSet(DATA_KEY, db);
        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: 'edit_family', bldg, aptName: fam.name, timestamp: new Date().toISOString(), payload: fam });
        storageSet(OUTBOX_KEY, outbox);
        pushOutboxToDrive().catch(e => console.warn('[Outbox] push error:', e));
        showToast('✅ הפרטים נשמרו!');
        renderCommunity();
        _ffcRender(bldgEnc, aptIdx, 'details');
    }

    function _ffcDelete(bldgEnc, aptIdx) {
        if (!confirm('למחוק את המשפחה לצמיתות?')) return;
        const bldg = decodeURIComponent(bldgEnc);
        db[bldg].apts.splice(aptIdx, 1);
        storageSet(DATA_KEY, db);
        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: 'delete_family', bldg, aptIdx, timestamp: new Date().toISOString() });
        storageSet(OUTBOX_KEY, outbox);
        pushOutboxToDrive().catch(e => console.warn('[Outbox] push error:', e));
        closeOverlays();
        document.getElementById('f-sheet').style.height = '';
        renderCommunity();
        renderMarkers();
        showToast('🗑️ המשפחה נמחקה');
    }

    function _ffcAddTag(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        const val = document.getElementById('ffc-tag-input').value.trim();
        if (!val) return;
        const fam = db[bldg].apts[aptIdx];
        if (!fam.tags) fam.tags = [];
        if (!fam.tags.includes(val)) fam.tags.push(val);
        storageSet(DATA_KEY, db);
        _ffcRender(bldgEnc, aptIdx, 'details');
    }

    function _ffcRemoveTag(bldgEnc, aptIdx, tagIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        db[bldg].apts[aptIdx].tags.splice(tagIdx, 1);
        storageSet(DATA_KEY, db);
        _ffcRender(bldgEnc, aptIdx, 'details');
    }

    function _ffcAddChild(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        const fam = db[bldg].apts[aptIdx];
        if (!fam.childrenList) fam.childrenList = [];
        fam.childrenList.push({ name: '', dob: '' });
        storageSet(DATA_KEY, db);
        _ffcRender(bldgEnc, aptIdx, 'details');
    }

    function _ffcRemoveChild(bldgEnc, aptIdx, childIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        db[bldg].apts[aptIdx].childrenList.splice(childIdx, 1);
        storageSet(DATA_KEY, db);
        _ffcRender(bldgEnc, aptIdx, 'details');
    }

    function _ffcUpdateChild(bldgEnc, aptIdx, childIdx, field, val) {
        const bldg = decodeURIComponent(bldgEnc);
        if (!db[bldg].apts[aptIdx].childrenList) db[bldg].apts[aptIdx].childrenList = [];
        db[bldg].apts[aptIdx].childrenList[childIdx][field] = val;
        storageSet(DATA_KEY, db);
    }

    function _ffcToggleTask(bldgEnc, aptIdx, taskIdx, done) {
        const bldg = decodeURIComponent(bldgEnc);
        db[bldg].apts[aptIdx].tasks[taskIdx].done = done;
        storageSet(DATA_KEY, db);
        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: done ? 'task_done' : 'task_undone', bldg, aptIdx, taskIdx, timestamp: new Date().toISOString() });
        storageSet(OUTBOX_KEY, outbox);
        _ffcRender(bldgEnc, aptIdx, 'tasks');
    }

    function _ffcAddTask(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        const text = document.getElementById('ffc-new-task').value.trim();
        if (!text) return;
        const date = document.getElementById('ffc-new-task-date').value;
        const fam = db[bldg].apts[aptIdx];
        if (!fam.tasks) fam.tasks = [];
        const dateFormatted = date ? new Date(date).toLocaleDateString('he-IL') : '';
        fam.tasks.push({ text, date: dateFormatted, done: false });
        storageSet(DATA_KEY, db);
        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: 'add_family_task', bldg, aptName: fam.name, timestamp: new Date().toISOString(), payload: { taskText: text, taskDate: dateFormatted } });
        storageSet(OUTBOX_KEY, outbox);
        pushOutboxToDrive().catch(e => console.warn('[Outbox] push error:', e));
        renderTasks();
        _ffcRender(bldgEnc, aptIdx, 'tasks');
    }

    function _ffcDeleteTask(bldgEnc, aptIdx, taskIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        db[bldg].apts[aptIdx].tasks.splice(taskIdx, 1);
        storageSet(DATA_KEY, db);
        renderTasks();
        _ffcRender(bldgEnc, aptIdx, 'tasks');
    }

    function _ffcAddLog(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        const type = document.getElementById('ffc-log-type').value;
        const date = document.getElementById('ffc-log-date').value;
        const text = document.getElementById('ffc-log-text').value.trim();
        if (!text) return;
        const fam = db[bldg].apts[aptIdx];
        if (!fam.interactions) fam.interactions = [];
        const dateStr = date ? new Date(date).toLocaleDateString('he-IL') : new Date().toLocaleDateString('he-IL');
        fam.interactions.push({ type, date: dateStr, text });
        storageSet(DATA_KEY, db);
        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: 'visit_log', bldg, aptName: fam.name, timestamp: new Date().toISOString(), payload: { note: text, result: type } });
        storageSet(OUTBOX_KEY, outbox);
        pushOutboxToDrive().catch(e => console.warn('[Outbox] push error:', e));
        _ffcRender(bldgEnc, aptIdx, 'logs');
    }

    function _ffcDeleteLog(bldgEnc, aptIdx, logIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        const fam = db[bldg].apts[aptIdx];
        const arr = fam.interactions || fam.history || [];
        arr.splice(logIdx, 1);
        storageSet(DATA_KEY, db);
        _ffcRender(bldgEnc, aptIdx, 'logs');
    }

    function _ffcAddDonation(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        const amount = document.getElementById('ffc-don-amount').value.trim();
        const date = document.getElementById('ffc-don-date').value;
        const reason = document.getElementById('ffc-don-reason').value.trim();
        if (!amount) return;
        const fam = db[bldg].apts[aptIdx];
        if (!fam.donations) fam.donations = [];
        const dateStr = date ? new Date(date).toLocaleDateString('he-IL') : new Date().toLocaleDateString('he-IL');
        fam.donations.push({ amount, date: dateStr, reason: reason || 'כללי' });
        storageSet(DATA_KEY, db);
        _ffcRender(bldgEnc, aptIdx, 'donations');
    }

    function _ffcDeleteDonation(bldgEnc, aptIdx, donIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        db[bldg].apts[aptIdx].donations.splice(donIdx, 1);
        storageSet(DATA_KEY, db);
        _ffcRender(bldgEnc, aptIdx, 'donations');
    }

    function _ffcTab(tab) {
        ['details','tasks','logs','donations'].forEach(t => {
            const btn = document.getElementById('ffc-tab-' + t);
            const content = document.getElementById('ffc-content-' + t);
            if (btn) { btn.style.borderBottomColor = t === tab ? 'var(--accent)' : 'transparent'; btn.style.color = t === tab ? 'var(--accent)' : 'var(--text-muted)'; btn.style.fontWeight = t === tab ? 'bold' : 'normal'; }
            if (content) content.style.display = t === tab ? 'block' : 'none';
        });
    }

    function openFamilyCard(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc); currentTarget = { bldg, aptIdx }; const fam = db[bldg].apts[aptIdx];
        if (!fam) return;
        const safeName = escapeHTML(fam.name || 'ללא שם');
        const parents = [fam.father || fam.fatherName, fam.mother || fam.motherName].filter(Boolean).join(' ו-');
        const parentsHTML = parents ? `<div style="font-size:14px; color:var(--text-muted); margin-bottom:5px;">${escapeHTML(parents)}</div>` : '';
        const phone = fam.fatherPhone || fam.motherPhone || fam.phone || '';
        const waLink = phone ? `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '972')}` : '#';
        const disableStyle = !phone ? 'opacity:0.3; pointer-events:none;' : '';
        const activeTask = (fam.tasks || []).find(t => !t.done);
        const taskHTML = activeTask ? `<div style="background:rgba(37, 99, 235, 0.1); border:1px solid rgba(37, 99, 235, 0.3); padding:10px; border-radius:8px; margin-bottom:15px;"><div style="font-size:12px; color:var(--accent); font-weight:bold; margin-bottom:4px;"><i class="fas fa-thumbtack"></i> משימה פתוחה:</div><div style="font-size:15px; color:var(--text-main);">${escapeHTML(activeTask.text)}</div></div>` : '';
        const coords = db[bldg].info?.coords;
        const safeBldgEnc = encodeURIComponent(bldg);

        const historyList = fam.history || []; let historyHTML = '';
        if (historyList.length > 0) {
            historyHTML = `<div style="margin-top: 20px; border-top: 1px solid var(--border-light); padding-top: 15px;"><div style="font-size:14px; font-weight:bold; color:var(--text-muted); margin-bottom:10px;"><i class="fas fa-history"></i> היסטוריית ביקורים (${historyList.length}):</div><div style="max-height: 130px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 5px;">`;
            [...historyList].reverse().forEach(visit => {
                let statusColor = 'var(--text-muted)'; if (visit.status === 'בוצע') statusColor = 'var(--success)'; if (visit.status === 'אין מענה') statusColor = 'var(--warning)'; if (visit.status === 'לא מעוניינים') statusColor = 'var(--danger)';
                historyHTML += `<div style="background: var(--bg-body); padding: 10px; border-radius: 8px; border-right: 4px solid ${statusColor};"><div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px;"><strong style="color: var(--text-main);">${escapeHTML(visit.date)}</strong><span style="color: ${statusColor}; font-weight: bold;">${escapeHTML(visit.status)}</span></div><div style="color: var(--text-muted); font-size: 13px;">${escapeHTML(visit.content || 'ללא הערה')}</div></div>`;
            });
            historyHTML += `</div></div>`;
        } else { historyHTML = `<div style="margin-top: 20px; border-top: 1px solid var(--border-light); padding-top: 15px; font-size:13px; color:var(--text-muted); text-align:center;">אין היסטוריית ביקורים קודמת.</div>`; }

        let html = `<button class="sheet-close-btn" onclick="fieldApp.closeOverlays()"><i class="fas fa-times"></i></button>`;
        html += `<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; padding-right:35px;"><div><h3 style="margin: 0 0 2px 0; font-size: 22px;">משפחת ${safeName}</h3>${parentsHTML}<div style="color: var(--text-muted); font-size: 14px;"><i class="fas fa-map-marker-alt"></i> ${escapeHTML(bldg)} ${fam.num ? 'דירה '+escapeHTML(String(fam.num)) : ''}</div></div><div style="display:flex; gap:8px;"><button onclick="fieldApp.openFamilyForm('${safeBldgEnc}', ${aptIdx})" style="background:none; border:none; color:var(--accent); font-size:20px; cursor:pointer;"><i class="fas fa-edit"></i></button><button style="width:40px; height:40px; border-radius:50%; background:var(--bg-body); border:1px solid var(--border-light); color:var(--text-main); font-size:16px; cursor:pointer; ${disableStyle}" onclick="fieldApp.callFamilyNumber('${phone}')"><i class="fas fa-phone"></i></button><button style="width:40px; height:40px; border-radius:50%; background:#25D366; border:none; color:white; font-size:16px; cursor:pointer; ${disableStyle}" onclick="window.open('${waLink}', '_blank')"><i class="fab fa-whatsapp"></i></button></div></div>${taskHTML}`;
        html += `<div style="font-size:14px; font-weight:bold; color:var(--text-muted); margin-bottom:10px;">דווח סטטוס ביקור:</div><div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;"><button style="padding: 12px; background: var(--success); color: white; border: none; border-radius: 12px; font-weight: bold; cursor:pointer;" onclick="fieldApp.openVoiceSummary('בוצע')"><i class="fas fa-check"></i> בוצע</button><button style="padding: 12px; background: var(--warning); color: white; border: none; border-radius: 12px; font-weight: bold; cursor:pointer;" onclick="fieldApp.openVoiceSummary('אין מענה')"><i class="fas fa-door-closed"></i> אין מענה</button><button style="padding: 12px; background: var(--text-muted); color: white; border: none; border-radius: 12px; font-weight: bold; cursor:pointer;" onclick="fieldApp.openVoiceSummary('לא רלוונטי')"><i class="fas fa-ban"></i> לא רלוונטי</button><button style="padding: 12px; background: var(--danger); color: white; border: none; border-radius: 12px; font-weight: bold; cursor:pointer;" onclick="fieldApp.openVoiceSummary('לא מעוניינים')"><i class="fas fa-times-circle"></i> לא מעוניינים</button></div>`;
        if (coords) html += ``; // ניווט הוסר — שייך למצב מבצע בלבד
        
        // *** כפתור כרטיס מלא ***
        html += `<button onclick="fieldApp.openFullFamilyCard('${safeBldgEnc}', ${aptIdx})" style="width:100%; margin-top:15px; padding:12px; background:rgba(37,99,235,0.08); color:var(--accent); border:1px solid rgba(37,99,235,0.4); border-radius:12px; font-weight:bold; cursor:pointer; font-family:inherit;"><i class="fas fa-id-card"></i> פתח כרטיס משפחה מלא</button>`;
        
        html += historyHTML;

        openSheet(html);
    }

    // ==========================================
    // עריכה ובניית מסלולים
    // ==========================================

    // *** עדכון: toggleRouteBuilderMode עם דיאלוג הוראות ***
    function toggleRouteBuilderMode() {
        isRouteBuilderMode = true;
        closeOverlays();
        updateAppUIState('ROUTE_BUILDER');

        const dialogHtml = `
        <div style="text-align:center; padding:10px;">
            <div style="font-size:48px; margin-bottom:15px;">📍</div>
            <h3 style="margin-bottom:10px; font-size:20px;">מצב בניית מסלול הופעל</h3>
            <p style="color:var(--text-muted); font-size:14px; margin-bottom:25px; line-height:1.6;">
                לחץ על בניינים במפה כדי להוסיף אותם למסלול.<br>
                ניתן גם לבחור משפחות מרשימת הקהילה.
            </p>
            <button onclick="fieldApp.closeOverlays(); fieldApp.updateRouteVisuals();" 
                style="width:100%; padding:14px; background:var(--accent); color:white; border:none; border-radius:12px; font-weight:bold; font-size:16px; cursor:pointer; font-family:inherit;">
                <i class="fas fa-map-marked-alt"></i> הבנתי, בוא נתחיל
            </button>
        </div>`;

        document.getElementById('f-sheet-content').innerHTML = dialogHtml;
        document.getElementById('f-sheet').classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
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
        const bldgCountEl = document.getElementById('f-bldg-count');
        if (bldgCountEl) bldgCountEl.innerText = selectedRouteBuildings.length;

        // עדכן route-builder-bar
        const rbBar = document.getElementById('route-builder-bar');
        const rbCount = document.getElementById('route-builder-count');
        if (rbCount) rbCount.innerText = `${selectedRouteBuildings.length} תחנות נבחרו`;

        if (selectedRouteBuildings.length > 0) { 
            if(bar) { bar.style.display = 'flex'; document.getElementById('f-route-counter').innerText = selectedRouteBuildings.length; }
            updateAppUIState('ROUTE_BUILDER');
        } else { 
            if(bar) bar.style.display = 'none';
            if(rbBar) rbBar.classList.remove('visible');
            isRouteBuilderMode = false;
            updateAppUIState('CRM');
        }
    }

    function toggleTargetForRoute(el, lng, lat) {
        if (!lng || !lat || isNaN(lng)) { showToast("למשפחה זו אין מיקום מוגדר במפה."); return; }
        const coords = [lng, lat];
        const coordsStr = `${lng},${lat}`;
        const existingIdx = selectedRouteBuildings.findIndex(c => `${c.coords[0]},${c.coords[1]}` === coordsStr);

        if (existingIdx >= 0) {
            const removed = selectedRouteBuildings.splice(existingIdx, 1)[0];
            if (removed.featureId) map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: removed.featureId }, { selected: false });
            el.style.border = "1px solid var(--border-light)";
            el.style.background = "var(--surface)";
        } else {
            selectedRouteBuildings.push({ address: 'יעד מהקהילה', coords, featureId: null });
            el.style.border = "2px solid var(--accent)";
            el.style.background = "rgba(59,130,246,0.05)";
            // flyTo ואז צביעה אחרי טעינה
            map.once('idle', () => {
                const idx = selectedRouteBuildings.findIndex(c => `${c.coords[0]},${c.coords[1]}` === coordsStr);
                if (idx > -1) {
                    const fid = colorBuildingByCoords(coords, true);
                    if (fid) selectedRouteBuildings[idx].featureId = fid;
                }
            });
            map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 17), pitch: 60, duration: 1200 });
        }
        isRouteBuilderMode = true;
        updateRouteVisuals();
    }

    function promptAddToRoute(bldgEnc) {
        const bldg = decodeURIComponent(bldgEnc);
        const coords = db[bldg]?.info?.coords;
        if (!coords) return showToast("אין מיקום למשפחה זו");
        isRouteBuilderMode = true;
        const existingIdx = selectedRouteBuildings.findIndex(b => b.address === bldg);
        if (existingIdx === -1) {
            const featureId = colorBuildingByCoords(coords, true);
            selectedRouteBuildings.push({ address: bldg, coords, featureId });
        }
        closeOverlays(); updateRouteVisuals(); showToast("הבניין נוסף למסלול! סרגל המסלול מוצג למטה.");
    }

    function colorBuildingByCoords(coords, selected) {
        if (!map || !coords) return null;
        try {
            const point = map.project(coords);
            const features = map.queryRenderedFeatures(
                [[point.x - 5, point.y - 5], [point.x + 5, point.y + 5]],
                { layers: ['3d-buildings'] }
            );
            if (features.length > 0) {
                map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: features[0].id }, { selected });
                return features[0].id;
            }
        } catch(e) {}
        return null;
    }

    function addSingleToRoute(bldgEnc) {
        const bldg = decodeURIComponent(bldgEnc);
        const coords = db[bldg]?.info?.coords;
        if (!coords || isNaN(coords[0])) return showToast("אין מיקום למשפחה זו");
        isRouteBuilderMode = true;
        const existingIdx = selectedRouteBuildings.findIndex(b => b.address === bldg);
        if (existingIdx === -1) {
            selectedRouteBuildings.push({ address: bldg, coords, featureId: null });
            const newIdx = selectedRouteBuildings.length - 1;
            // flyTo ואז צביעה אחרי שהמפה טעונה
            map.once('idle', () => {
                const fid = colorBuildingByCoords(coords, true);
                if (fid) selectedRouteBuildings[newIdx].featureId = fid;
            });
            map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 17), pitch: 60, duration: 1200 });
        }
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

    function startCustomRoute() {
        if (selectedRouteBuildings.length === 0) return;
        pendingRouteWaypoints = selectedRouteBuildings.map(b => b.coords);
        document.getElementById('f-route-action-bar').style.display = 'none';
        document.getElementById('f-route-dialog').style.display = 'flex';
        updateAppUIState('CRM');
    }

    function openRouteEditor() {
        document.getElementById('f-route-dialog').style.display = 'none';
        renderRouteEditorList();
        openSheet(document.getElementById('f-route-editor-sheet').innerHTML, 'full');
    }

    // ==========================================
    // עריכת מסלול מתקדמת: גרירה וסידור אוטומטי
    // ==========================================
    function renderRouteEditorList() {
        const container = document.getElementById('f-route-editor-list');
        if (selectedRouteBuildings.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">המסלול כרגע ריק.</div>';
            return;
        }
        let html = `<button onclick="fieldApp.autoSortRoute()" style="width:100%; margin-bottom:15px; padding:10px; background:rgba(16,185,129,0.1); color:var(--success); border:1px solid var(--success); border-radius:10px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; font-family:inherit;"><i class="fas fa-magic"></i> סדר מסלול אוטומטית לפי מפה</button>`;
        html += selectedRouteBuildings.map((bldg, idx) => `
            <div class="route-editor-item" data-idx="${idx}"
                 ontouchstart="fieldApp.handleRouteTouchStart(event, ${idx})"
                 ontouchmove="fieldApp.handleRouteTouchMove(event)"
                 ontouchend="fieldApp.handleRouteTouchEnd(event)"
                 draggable="true"
                 ondragstart="fieldApp.handleRouteDragStart(event, ${idx})"
                 ondragover="event.preventDefault()"
                 ondrop="fieldApp.handleRouteDrop(event, ${idx})">
                <div class="drag-handle"><i class="fas fa-grip-lines"></i></div>
                <div class="content">
                    <div style="font-weight:700; font-size:15px;"><span style="color:var(--warning); font-weight:900; margin-left:5px;">${idx+1}.</span> ${escapeHTML(bldg.address)}</div>
                </div>
                <div class="actions">
                    <button class="delete-btn" onclick="fieldApp.removeRouteItem(${idx})"><i class="fas fa-trash"></i></button>
                </div>
            </div>`).join('');
        container.innerHTML = html;
    }

    function autoSortRoute() {
        // עובד על המקור הרלוונטי — currentDraftRoute או selectedRouteBuildings
        const useDraft = currentDraftRoute.length >= 2;
        const useSelected = selectedRouteBuildings.length >= 2;
        if (!useDraft && !useSelected) return;
        showToast("מחשב את המסלול היעיל ביותר...");

        const sortNearest = (arr) => {
            let unvisited = [...arr];
            let current = unvisited.shift();
            let sorted = [current];
            while (unvisited.length > 0) {
                let nearestIdx = 0, minDist = Infinity;
                for (let i = 0; i < unvisited.length; i++) {
                    let d = calculateDistance(current.coords, unvisited[i].coords);
                    if (d < minDist) { minDist = d; nearestIdx = i; }
                }
                current = unvisited.splice(nearestIdx, 1)[0];
                sorted.push(current);
            }
            return sorted;
        };

        if (useDraft) { currentDraftRoute = sortNearest(currentDraftRoute); renderRouteSheet(); }
        if (useSelected) { selectedRouteBuildings = sortNearest(selectedRouteBuildings); renderRouteEditorList(); updateRouteVisuals(); }
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
        showToast("המסלול סודר בהצלחה! ✨");
    }

    let routeDragItem = null;
    let routeDragStartIdx = -1;

    function handleRouteTouchStart(e, idx) {
        routeDragStartIdx = idx;
        routeDragItem = e.currentTarget;
        routeDragItem.classList.add('dragging');
    }

    function handleRouteTouchMove(e) {
        if (!routeDragItem) return;
        e.preventDefault();
        const touch = e.touches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        const dropTarget = targetEl?.closest('.route-editor-item');
        document.querySelectorAll('.route-editor-item').forEach(item => item.style.border = '1px solid var(--border-light)');
        if (dropTarget && dropTarget !== routeDragItem) dropTarget.style.border = '2px dashed var(--accent)';
    }

    function handleRouteTouchEnd(e) {
        if (!routeDragItem) return;
        routeDragItem.classList.remove('dragging');
        document.querySelectorAll('.route-editor-item').forEach(item => item.style.border = '1px solid var(--border-light)');
        const touch = e.changedTouches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        const dropTarget = targetEl?.closest('.route-editor-item');
        if (dropTarget) {
            const targetIdx = parseInt(dropTarget.getAttribute('data-idx'));
            if (!isNaN(targetIdx) && targetIdx !== routeDragStartIdx) {
                const itemToMove = selectedRouteBuildings.splice(routeDragStartIdx, 1)[0];
                selectedRouteBuildings.splice(targetIdx, 0, itemToMove);
                renderRouteEditorList();
                updateRouteVisuals();
                if (navigator.vibrate) navigator.vibrate(20);
            }
        }
        routeDragItem = null;
        routeDragStartIdx = -1;
    }

    function handleRouteDragStart(e, idx) { e.dataTransfer.setData('text/plain', idx); }
    function handleRouteDrop(e, targetIdx) {
        e.preventDefault();
        const startIdx = parseInt(e.dataTransfer.getData('text/plain'));
        if (startIdx === targetIdx) return;
        const itemToMove = selectedRouteBuildings.splice(startIdx, 1)[0];
        selectedRouteBuildings.splice(targetIdx, 0, itemToMove);
        renderRouteEditorList();
        updateRouteVisuals();
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

        const nameInput = document.getElementById('f-route-name-input');
        let name = nameInput ? nameInput.value.trim() : '';
        if (!name) name = `מסלול מותאם - ${new Date().toLocaleDateString('he-IL')}`;

        saveRoute(pendingRouteWaypoints, name);
        showToast("המסלול נשמר בהצלחה!");

        const dialog = document.getElementById('f-route-dialog');
        if(dialog) dialog.style.display = 'flex';

        isRouteBuilderMode = false;
        selectedRouteBuildings.forEach(b => { if(b.featureId) map.setFeatureState({source: 'composite', sourceLayer: 'building', id: b.featureId}, { selected: false }); });
        selectedRouteBuildings = []; updateRouteVisuals();
        if(nameInput) nameInput.value = '';
    }

    async function buildRoute(sourceType) {
        closeOverlays(); showToast("🗺️ בונה מסלול חכם...");
        let waypoints = [];
        if (sourceType === 'tasks' || sourceType === 'community') {
            if (sourceType === 'tasks') {
                const todayStr = new Date().toLocaleDateString('he-IL');
                let scoredBuildings = [];
                Object.keys(db).forEach(bldg => {
                    if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return;
                    const coords = db[bldg].info?.coords; if(!coords || isNaN(coords[0])) return;
                    let score = 0;
                    (db[bldg].apts || []).forEach(apt => {
                        (apt.tasks || []).forEach(t => {
                            if (t.done) return;
                            score += 10;
                            if (t.date === todayStr) score += 50;
                            if (t.text && (t.text.includes('דחוף') || t.text.includes('חשוב'))) score += 30;
                        });
                    });
                    if (score > 0) scoredBuildings.push({ coords, score, address: bldg });
                });
                scoredBuildings.sort((a, b) => b.score - a.score);
                waypoints = scoredBuildings.slice(0, 10).map(b => b.coords);
                if (waypoints.length === 0) { showToast("אין בניינים עם משימות פתוחות."); return; }
            } else {
                let allCoords = [];
                Object.keys(db).forEach(bldg => { if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return; const coords = db[bldg].info?.coords; if(coords && !isNaN(coords[0]) && db[bldg].apts.length > 0) allCoords.push(coords); });
                waypoints = allCoords.slice(0, 10);
            }
        } else if (sourceType === 'office') {
            if (!db.meta || !db.meta.assignedRoute || db.meta.assignedRoute.length === 0) { showToast("אין מסלול פעיל מהמשרד."); return; }
            waypoints = db.meta.assignedRoute.map(item => item.coords);
            showToast("🗺️ טוען מסלול משרד...");
        }

        if (waypoints.length === 0) { showToast("לא נמצאו יעדים למסלול."); return; }
        showRouteDialog(waypoints);
    }

    // ==========================================
    // UI, חלונות וניווט
    // ==========================================
    function closeOverlays() {
        stopVoiceRecording();
        document.querySelectorAll('.f-sheet').forEach(s => s.classList.remove('open'));
        // סגור גם את ה-bottom sheet החדש
        const actionSheet = document.getElementById('action-sheet');
        const actionOverlay = document.getElementById('action-sheet-overlay');
        if (actionSheet) actionSheet.classList.remove('active');
        if (actionOverlay) actionOverlay.classList.remove('active');
        document.getElementById('f-scrim').style.display = 'none';
        if(db) document.getElementById('f-fab-wrapper').style.display = 'flex';
        if (activeBuildingFeatureId && map) { map.setFeatureState({source: 'composite', sourceLayer: 'building', id: activeBuildingFeatureId}, { active: false }); activeBuildingFeatureId = null; }
    }

    function toggleActionSheet() {
        const sheet = document.getElementById('action-sheet');
        const overlay = document.getElementById('action-sheet-overlay');
        const isOpen = sheet.classList.contains('active');
        if (isOpen) {
            sheet.classList.remove('active');
            overlay.classList.remove('active');
        } else {
            // סגור קודם שאר המגירות
            document.querySelectorAll('.f-sheet').forEach(s => s.classList.remove('open'));
            document.getElementById('f-scrim').style.display = 'none';
            sheet.classList.add('active');
            overlay.classList.add('active');
            if (navigator.vibrate) navigator.vibrate(20);
        }
    }

    // נשמר לתאימות אחורה
    function toggleFab() { toggleActionSheet(); }

    function switchView(viewId, element) {
        if (element) { document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active')); element.classList.add('active'); }
        document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
        document.getElementById('view-' + viewId).classList.add('active');
        closeOverlays();
        if (viewId === 'map' && map) setTimeout(() => map.resize(), 100);
        if (viewId === 'tasks' && db) { initTaskDateFilter(); renderTasks(); }
    }

    function openRouteMenu() {
        closeOverlays();
        switchView('map', document.querySelector('.nav-item'));
        const routeSheetEl = document.getElementById('f-route-sheet');
        openSheet(routeSheetEl.innerHTML, 'auto');
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
            const coords = db[f.bldg]?.info?.coords; const lng = coords?.[0]; const lat = coords?.[1];
            const parents = [f.apt.father || f.apt.fatherName, f.apt.mother || f.apt.motherName].filter(Boolean).join(' ו-');
            const tags = (f.apt.tags || []).map(t => `<span style="background:var(--accent);color:white;padding:2px 6px;border-radius:4px;font-size:11px;">${escapeHTML(t)}</span>`).join(' ');
            const safeBldgEnc = encodeURIComponent(f.bldg);

            return `
            <div class="community-list-item-wrapper">
            <div class="expandable-card" oncontextmenu="event.preventDefault();" ontouchstart="fieldApp.handleCardTouchStart(event, '${safeBldgEnc}', ${f.aptIdx})" ontouchend="fieldApp.handleCardTouchEnd()" onmousedown="fieldApp.handleCardTouchStart(event, '${safeBldgEnc}', ${f.aptIdx})" onmouseup="fieldApp.handleCardTouchEnd()" onmouseleave="fieldApp.handleCardTouchEnd()">
                <div class="expandable-card-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <div>
                        <div style="font-weight:700; font-size:16px;">משפחת ${escapeHTML(f.apt.name || 'ללא שם')}</div>
                        <div style="font-size:13px; color:var(--text-muted);">${escapeHTML(parents) || 'ללא שמות הורים'}</div>
                    </div>
                    <i class="fas fa-chevron-down" style="color:var(--text-muted);"></i>
                </div>
                <div class="expandable-card-body">
                    <div style="font-size:13px; color:var(--text-main); margin-bottom:10px;">
                        <div><i class="fas fa-map-marker-alt"></i> ${escapeHTML(f.address)} ${f.apt.num ? 'דירה '+escapeHTML(String(f.apt.num)) : ''}</div>
                        ${phone ? `<div style="margin-top:5px;"><i class="fas fa-phone"></i> <span dir="ltr">${phone}</span></div>` : ''}
                        ${tags ? `<div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap;">${tags}</div>` : ''}
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="card-action-btn" style="${disableStyle}" onclick="event.stopPropagation(); fieldApp.callFamilyNumber('${phone}')"><i class="fas fa-phone" style="color:var(--success);"></i>חייג</button>
                        <button class="card-action-btn" style="${disableStyle}" onclick="event.stopPropagation(); window.open('${waLink}', '_blank')"><i class="fab fa-whatsapp" style="color:#25D366;"></i>הודעה</button>
                        <button class="card-action-btn" onclick="event.stopPropagation(); fieldApp.toggleTargetForRoute(this, ${lng || 0}, ${lat || 0})"><i class="fas fa-map-pin" style="color:var(--warning);"></i>בחר יעדים</button>
                        <button class="card-action-btn" onclick="event.stopPropagation(); fieldApp.openFullFamilyCard('${safeBldgEnc}', ${f.aptIdx});"><i class="fas fa-id-card" style="color:var(--accent);"></i>כרטיס</button>
                        ${!phone ? `<button class="card-action-btn" onclick="event.stopPropagation(); fieldApp.searchContactForFamily('${safeBldgEnc}', ${f.aptIdx})" title="חפש באנשי קשר" style="color:var(--success);"><i class="fas fa-address-book"></i>ייבא</button>` : ''}
                    </div>
                </div>
            </div>
            </div>`;
        }).join('');
    }

    function handleCardTouchStart(e, bldgEnc, aptIdx) {
        cardPressTimer = setTimeout(() => { if (navigator.vibrate) navigator.vibrate(50); openCardActionMenu(bldgEnc, aptIdx); }, 900);
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
        document.getElementById('f-sheet-content').innerHTML = html;
        document.getElementById('f-sheet').classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
    }

    // ==========================================
    // טפסים (משפחות ומשימות)
    // ==========================================
    function openFamilyForm(bldg = null, aptIdx = null) {
        closeOverlays(); document.getElementById('f-fab-wrapper').style.display = 'none';
        // איפוס גובה חלונית אם נפתחה מ-openFullFamilyCard
        document.getElementById('f-sheet').style.height = '';
        const sheet = document.getElementById('f-add-family-sheet'); const titleIcon = document.getElementById('f-add-fam-title'); const saveBtn = document.getElementById('f-add-fam-savebtn');
        if (bldg !== null && aptIdx !== null) {
            const bldgDecoded = typeof bldg === 'string' && bldg.includes('%') ? decodeURIComponent(bldg) : bldg;
            editingFamilyContext = { bldg: bldgDecoded, aptIdx }; const fam = db[bldgDecoded].apts[aptIdx];
            document.getElementById('f-add-fam-name').value = fam.name || '';
            document.getElementById('f-add-fam-father').value = fam.father || fam.fatherName || '';
            document.getElementById('f-add-fam-mother').value = fam.mother || fam.motherName || '';
            document.getElementById('f-add-fam-address').value = bldgDecoded === NO_ADDRESS_KEY ? '' : bldgDecoded;
            document.getElementById('f-add-fam-apt').value = fam.num || '';
            document.getElementById('f-add-fam-phone').value = fam.phone || fam.fatherPhone || fam.motherPhone || '';
            document.getElementById('f-add-fam-homephone').value = fam.homePhone || '';
            document.getElementById('f-add-fam-intercom').value = db[bldgDecoded].info?.code || '';
            const floorEl = document.getElementById('f-add-fam-floor');
            if (floorEl) floorEl.value = fam.floor || '';
            titleIcon.innerHTML = '<i class="fas fa-user-edit" style="color:var(--accent);"></i> עריכת פרטי משפחה';
            saveBtn.innerHTML = '<i class="fas fa-save"></i> עדכן נתונים';
        } else {
            editingFamilyContext = null;
            ['name', 'father', 'mother', 'address', 'apt', 'phone', 'homephone', 'intercom'].forEach(id => { document.getElementById('f-add-fam-' + id).value = ''; });
            titleIcon.innerHTML = '<i class="fas fa-user-plus" style="color:var(--accent);"></i> הוספת משפחה חדשה';
            saveBtn.innerHTML = '<i class="fas fa-save"></i> הוסף למערכת';
        }
        openSheet(sheet.innerHTML, 'auto');
    }

    async function searchAddressInput(query) {
        const suggBox = document.getElementById('address-suggestions');
        if (query.length < 3) { suggBox.style.display = 'none'; selectedCoords = null; return; }
        try {
            const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&language=he&country=il&types=address`);
            const data = await res.json();
            if (data.features && data.features.length > 0) {
                suggBox.innerHTML = data.features.map(f => `<div style="padding:10px; border-bottom:1px solid var(--border-light); cursor:pointer;" onclick="fieldApp.selectAddressOption('${f.place_name.replace(/'/g,'')}', ${f.center[0]}, ${f.center[1]})">${f.place_name_he || f.place_name}</div>`).join('');
                suggBox.style.display = 'block';
            } else { suggBox.style.display = 'none'; }
        } catch(e) { suggBox.style.display = 'none'; }
    }

    function selectAddressOption(name, lng, lat) {
        document.getElementById('f-add-fam-address').value = name.split(',').slice(0,2).join(',');
        selectedCoords = [lng, lat]; document.getElementById('address-suggestions').style.display = 'none';
    }

    async function saveFamilyForm() {
        const name = document.getElementById('f-add-fam-name').value.trim();
        const fatherName = document.getElementById('f-add-fam-father').value.trim();
        const motherName = document.getElementById('f-add-fam-mother').value.trim();
        let address = document.getElementById('f-add-fam-address').value.trim();

        if(!name || (!fatherName && !motherName)) { showToast("⚠️ חובה להזין שם משפחה ולפחות שם של הורה אחד."); return; }

        const phone = document.getElementById('f-add-fam-phone').value.trim();
        const aptNum = document.getElementById('f-add-fam-apt').value.trim();
        const homePhone = document.getElementById('f-add-fam-homephone').value.trim();
        const intercom = document.getElementById('f-add-fam-intercom').value.trim();
        const floor = (document.getElementById('f-add-fam-floor')?.value || '').trim();

        let finalCoords = selectedCoords;
        if (!address) { address = NO_ADDRESS_KEY; finalCoords = []; }

        showToast("שומר נתונים...");
        if (address !== NO_ADDRESS_KEY && !finalCoords) {
            try {
                const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${mapboxgl.accessToken}&language=he&country=il&types=address`);
                const data = await res.json();
                if (data.features && data.features.length > 0) {
                    address = (data.features[0].place_name_he || data.features[0].place_name).split(',').slice(0,2).join(',');
                    finalCoords = data.features[0].center;
                }
            } catch(e) { console.log("Geocoding failed"); }
        }

        const familyData = { name, father: fatherName, mother: motherName, fatherName, motherName, phone, homePhone, num: aptNum, floor };
        const outbox = storageGet(OUTBOX_KEY) || [];

        if (editingFamilyContext) {
            const oldBldg = editingFamilyContext.bldg; const aptIdx = editingFamilyContext.aptIdx;
            Object.assign(db[oldBldg].apts[aptIdx], familyData);
            if (oldBldg !== address) {
                const famToMove = db[oldBldg].apts.splice(aptIdx, 1)[0];
                if(!db[address]) db[address] = { info: { coords: finalCoords || [], code: intercom }, apts: [] };
                db[address].apts.push(famToMove);
            } else { if(intercom) db[oldBldg].info.code = intercom; }
            outbox.push({ type: 'edit_family', timestamp: new Date().toISOString(), oldBldg, address, payload: familyData, intercom });
            showToast("✅ פרטי המשפחה עודכנו בהצלחה!");
        } else {
            familyData.status = "חדש"; familyData.tasks = []; familyData.history = [];
            if(!db[address]) db[address] = { info: { coords: finalCoords || [], code: intercom }, apts: [] };
            db[address].apts.push(familyData);
            outbox.push({ type: 'add_full_family', timestamp: new Date().toISOString(), bldg: address, payload: familyData, intercom });
            showToast("✅ משפחה חדשה נשמרה!");
        }

        storageSet(DATA_KEY, db); storageSet(OUTBOX_KEY, outbox);
        // שלח לדרייב מיד — לא לחכות לסנכרון הבא
        pushOutboxToDrive().catch(e => console.warn('pushOutbox after saveFamilyForm:', e));
        closeOverlays(); renderCommunity(); renderMarkers();
    }

    function openAddTask() {
        closeOverlays(); document.getElementById('f-fab-wrapper').style.display = 'none';
        document.getElementById('f-add-task-text').value = '';
        const select = document.getElementById('f-add-task-family-select');
        let optionsHtml = '<option value="">-- משימה כללית (ללא שיוך) --</option>';
        Object.keys(db).forEach(bldg => { if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return; (db[bldg].apts || []).forEach((apt, aptIdx) => { optionsHtml += `<option value="${encodeURIComponent(bldg)}|${aptIdx}">משפחת ${escapeHTML(apt.name)} (${escapeHTML(bldg)})</option>`; }); });
        select.innerHTML = optionsHtml;
        const taskSheetEl = document.getElementById('f-add-task-sheet');
        openSheet(taskSheetEl.innerHTML, 'auto');
        taskSheetEl.classList.remove('open');
    }

    function saveNewTask() {
        const text = document.getElementById('f-add-task-text').value.trim(); const selectedValue = document.getElementById('f-add-task-family-select').value;
        if(!text) { showToast("נא להזין תוכן משימה"); return; }
        const todayStr = new Date().toLocaleDateString('he-IL'); const newTask = { text: text, date: todayStr, done: false }; const outbox = storageGet(OUTBOX_KEY) || [];

        if (selectedValue === "") {
            if(!db.meta) db.meta = {}; if(!db.meta.generalTasks) db.meta.generalTasks = [];
            db.meta.generalTasks.push(newTask); outbox.push({ type: 'add_general_task', timestamp: new Date().toISOString(), payload: { text, date: todayStr } });
        } else {
            const parts = selectedValue.split('|'); const bldg = decodeURIComponent(parts[0]); const aptIdx = parseInt(parts[1]); const famName = db[bldg].apts[aptIdx].name;
            if (!db[bldg].apts[aptIdx].tasks) db[bldg].apts[aptIdx].tasks = [];
            db[bldg].apts[aptIdx].tasks.push(newTask); outbox.push({ type: 'add_family_task', bldg, aptName: famName, timestamp: new Date().toISOString(), payload: { taskText: text, taskDate: todayStr } });
        }
        storageSet(DATA_KEY, db); storageSet(OUTBOX_KEY, outbox); closeOverlays(); renderTasks(); switchView('tasks', document.querySelectorAll('.nav-item')[1]); showToast("✅ משימה חדשה תועדה!");
    }

    function saveQuickTask() {
        const text = document.getElementById('f-quick-task-input').value.trim(); if(!text) return;
        const todayStr = new Date().toLocaleDateString('he-IL'); const newTask = { text: text, date: todayStr, done: false };
        if(!db.meta) db.meta = {}; if(!db.meta.generalTasks) db.meta.generalTasks = [];
        db.meta.generalTasks.push(newTask);
        const outbox = storageGet(OUTBOX_KEY) || []; outbox.push({ type: 'add_general_task', timestamp: new Date().toISOString(), payload: { text, date: todayStr } });
        storageSet(DATA_KEY, db); storageSet(OUTBOX_KEY, outbox);
        document.getElementById('f-quick-task-input').value = ''; renderTasks(); showToast("✅ משימה נוספה!");
    }

    // ==========================================
    // משתני מסך משימות מתקדם
    // ==========================================
    let showingAllTasks = false;
    let isCompletedExpanded = false;
    let currentEditTaskRef = null;
    let currentEditTags = [];
    let tagDropdownItems = [];
    let tagDropdownFocus = -1;

    function initTaskDateFilter() {
        const d = document.getElementById('f-task-date-filter');
        if (d && !d.value) d.value = new Date().toISOString().split('T')[0];
        // וודא שחיפוש מופעל
        const searchInput = document.getElementById('f-task-search');
        if (searchInput && !searchInput._fieldSearchBound) {
            searchInput._fieldSearchBound = true;
            searchInput.addEventListener('input', () => renderTasks());
        }
    }

    function renderTasks() {
        const activeList = document.getElementById('f-tasks-list');
        const completedList = document.getElementById('f-completed-tasks-list');
        if (!activeList) return;
        const searchQ = (document.getElementById('f-task-search')?.value || '').toLowerCase();

        // איסוף כל המשימות
        let allTasks = [];
        (db.meta?.generalTasks || []).forEach((t, i) => {
            allTasks.push({ ...t, isGeneral: true, idx: i, famName: 'משימה כללית' });
        });
        Object.keys(db).forEach(bldg => {
            if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            (db[bldg].apts || []).forEach((apt, aptIdx) => {
                (apt.tasks || []).forEach((t, tIdx) => {
                    allTasks.push({ ...t, isGeneral: false, bldg, aptIdx, tIdx, famName: apt.name || bldg, address: bldg });
                });
            });
        });

        // סינון לפי מצב
        const todayISO = new Date().toISOString().split('T')[0];
        const filterDate = document.getElementById('f-task-date-filter')?.value || todayISO;
        const filtered = allTasks.filter(t => {
            const matchSearch = !searchQ ||
                (t.text || '').toLowerCase().includes(searchQ) ||
                (t.famName || '').toLowerCase().includes(searchQ) ||
                (t.address || '').toLowerCase().includes(searchQ) ||
                (t.tags || []).some(tag => tag.toLowerCase().includes(searchQ));
            if (!matchSearch) return false;
            if (taskFilterMode === 'all') return true;
            // נרמול תאריך המשימה ל-ISO (תומך ב-d/m/yyyy, d.m.yyyy, yyyy-mm-dd)
            let tISO = null;
            if (t.date) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
                    tISO = t.date; // כבר ISO
                } else {
                    const sep = t.date.includes('.') ? '.' : '/';
                    const parts = t.date.split(sep);
                    if (parts.length === 3) {
                        tISO = `${parts[2].padStart(4,'20')}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
                    }
                }
            }
            const compareDate = taskFilterMode === 'date' ? filterDate : todayISO;
            return tISO === compareDate || (!tISO && compareDate === todayISO);
        });

        const active = filtered.filter(t => !t.done);
        const completed = filtered.filter(t => t.done);

        // ציור
        activeList.innerHTML = active.length
            ? active.map(t => buildTaskCard(t)).join('')
            : `<div style="text-align:center; padding:30px; color:var(--text-muted);"><i class="fas fa-check-circle" style="font-size:36px; opacity:0.3; display:block; margin-bottom:10px;"></i>אין משימות פתוחות לחתך זה</div>`;

        completedList.innerHTML = completed.length
            ? completed.map(t => buildTaskCard(t)).join('')
            : `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:14px;">אין משימות שבוצעו לחתך זה</div>`;

        document.getElementById('f-completed-count').innerText = `(${completed.length})`;

        attachTaskSwipe();
    }

    function buildTaskCard(t) {
        const doneClass = t.done ? 'is-done' : '';
        const tagsHtml = (t.tags || []).length
            ? `<div class="task-tags">${t.tags.map(tag => `<span class="task-tag">${escapeHTML(tag)}</span>`).join('')}</div>`
            : '';
        const idxData = t.isGeneral
            ? `data-general="true" data-idx="${t.idx}"`
            : `data-general="false" data-bldg="${encodeURIComponent(t.bldg)}" data-apt="${t.aptIdx}" data-task="${t.tIdx}"`;

        // סמן קטן בפינה ימנית עליונה בלבד (לא כיסוי מלא)
        const cornerDot = t.done
            ? `<div style="position:absolute;top:0;right:0;width:6px;height:100%;background:var(--success);border-radius:0 14px 14px 0;"></div>`
            : `<div style="position:absolute;top:0;right:0;width:6px;height:100%;background:var(--accent);border-radius:0 14px 14px 0;"></div>`;

        return `
        <div style="position:relative; overflow:hidden; border-radius:14px; margin-bottom:10px; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
            ${cornerDot}
            <div class="task-card-full ${doneClass}" ${idxData}
                 style="border-right:none; margin-bottom:0; box-shadow:none;"
                 onclick="fieldApp.openTaskEdit(this)">
                <div style="font-size:15px; font-weight:700; color:var(--text-main); margin-bottom:5px; ${t.done ? 'text-decoration:line-through; opacity:0.55;' : ''}">
                    ${escapeHTML(t.text) || '(ללא תיאור)'}
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-muted);">
                    <span><i class="far fa-user" style="margin-left:3px;"></i>${escapeHTML(t.famName)}</span>
                    <span><i class="far fa-calendar-alt" style="margin-left:3px;"></i>${t.date || 'ללא תאריך'}</span>
                </div>
                ${tagsHtml}
            </div>
        </div>`;
    }

    function attachTaskSwipe() {
        document.querySelectorAll('.task-card-full').forEach(item => {
            let startX = 0, curX = 0, dragging = false;
            item.addEventListener('touchstart', e => {
                startX = e.touches[0].clientX; curX = startX; dragging = true;
                item.style.transition = 'none';
            }, { passive: true });
            item.addEventListener('touchmove', e => {
                if (!dragging) return;
                curX = e.touches[0].clientX;
                const diff = curX - startX;
                const isDone = item.classList.contains('is-done');
                // RTL: ימינה = ביצוע למשימה פתוחה, שמאלה = ביטול למשימה שבוצעה
                if (!isDone && diff > 0) item.style.transform = `translateX(${diff}px)`;
                if (isDone && diff < 0) item.style.transform = `translateX(${diff}px)`;
            }, { passive: true });
            item.addEventListener('touchend', () => {
                if (!dragging) return; dragging = false;
                item.style.transition = 'transform 0.3s ease';
                item.style.transform = 'translateX(0)';
                const diff = curX - startX;
                const isDone = item.classList.contains('is-done');
                if (!isDone && diff > 80) toggleTaskDone(item);
                else if (isDone && diff < -80) toggleTaskDone(item);
            });
        });
    }

    function toggleTaskDone(item) {
        const isGeneral = item.getAttribute('data-general') === 'true';
        let taskRef;
        if (isGeneral) {
            taskRef = db.meta.generalTasks[item.getAttribute('data-idx')];
        } else {
            const bldg = decodeURIComponent(item.getAttribute('data-bldg'));
            taskRef = db[bldg].apts[item.getAttribute('data-apt')].tasks[item.getAttribute('data-task')];
        }
        taskRef.done = !taskRef.done;
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
        storageSet(DATA_KEY, db);
        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: taskRef.done ? 'task_done' : 'task_undone', timestamp: new Date().toISOString() });
        storageSet(OUTBOX_KEY, outbox);
        showToast(taskRef.done ? '✅ המשימה הושלמה!' : '↩️ המשימה הוחזרה לפעילה');
        renderTasks();
    }

    let taskFilterMode = 'today'; // 'today' | 'date' | 'all'

    function setTaskFilter(mode) {
        taskFilterMode = mode;
        // עדכן מראה כפתורים
        ['today','date','all'].forEach(m => {
            const btn = document.getElementById('f-filter-' + m);
            if (!btn) return;
            const active = m === mode;
            btn.style.background = active ? 'var(--accent)' : 'var(--bg-body)';
            btn.style.color = active ? 'white' : 'var(--text-main)';
            btn.style.borderColor = active ? 'var(--accent)' : 'var(--border-light)';
        });
        const dateRow = document.getElementById('f-date-row');
        if (dateRow) dateRow.style.display = mode === 'date' ? 'block' : 'none';
        // אם עוברים למצב תאריך — פתח את הpicker אוטומטית
        if (mode === 'date') {
            const dp = document.getElementById('f-task-date-filter');
            if (dp) { if (!dp.value) dp.value = new Date().toISOString().split('T')[0]; setTimeout(() => dp.showPicker?.(), 50); }
        }
        renderTasks();
    }

    function toggleViewAllTasks() { setTaskFilter(taskFilterMode === 'all' ? 'today' : 'all'); }


    function deleteCurrentTask() {
        if (!currentEditTaskRef) return;
        if (!confirm('למחוק את המשימה?')) return;
        // מצא והסר
        if (currentEditTaskRef._isGeneral !== undefined ? currentEditTaskRef._isGeneral : false) {
            // נמצא לפי reference
        }
        // חפש בכל מקום ומחק
        let deleted = false;
        const gi = (db.meta?.generalTasks || []).indexOf(currentEditTaskRef);
        if (gi > -1) { db.meta.generalTasks.splice(gi, 1); deleted = true; }
        if (!deleted) {
            Object.keys(db).forEach(bldg => {
                if (deleted || bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
                (db[bldg].apts || []).forEach(apt => {
                    const ti = (apt.tasks || []).indexOf(currentEditTaskRef);
                    if (ti > -1) { apt.tasks.splice(ti, 1); deleted = true; }
                });
            });
        }
        if (deleted) {
            storageSet(DATA_KEY, db);
            const outbox = storageGet(OUTBOX_KEY) || [];
            outbox.push({ type: 'delete_task', timestamp: new Date().toISOString() });
            storageSet(OUTBOX_KEY, outbox);
            closeOverlays();
            showToast('🗑️ המשימה נמחקה');
            renderTasks();
        }
    }

    let voiceSearchActive = false;
    let voiceSearchRecognition = null;

    function toggleVoiceSearch() {
        const btn = document.getElementById('f-voice-search-btn');
        const input = document.getElementById('f-task-search');
        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            showToast('הקלטה קולית אינה נתמכת בדפדפן זה');
            return;
        }
        if (voiceSearchActive) {
            voiceSearchRecognition?.stop();
            voiceSearchActive = false;
            if (btn) { btn.style.background = 'var(--bg-body)'; btn.style.color = 'var(--text-muted)'; btn.querySelector('i').className = 'fas fa-microphone'; }
            return;
        }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        voiceSearchRecognition = new SR();
        voiceSearchRecognition.lang = 'he-IL';
        voiceSearchRecognition.interimResults = true;
        voiceSearchRecognition.onstart = () => {
            voiceSearchActive = true;
            if (btn) { btn.style.background = 'var(--danger)'; btn.style.color = 'white'; btn.querySelector('i').className = 'fas fa-stop'; }
            showToast('🎤 מקשיב...');
        };
        voiceSearchRecognition.onresult = (e) => {
            let transcript = '';
            for (let i = e.resultIndex; i < e.results.length; i++) transcript += e.results[i][0].transcript;
            if (input) { input.value = transcript; renderTasks(); }
        };
        voiceSearchRecognition.onend = () => {
            voiceSearchActive = false;
            if (btn) { btn.style.background = 'var(--bg-body)'; btn.style.color = 'var(--text-muted)'; btn.querySelector('i').className = 'fas fa-microphone'; }
        };
        voiceSearchRecognition.onerror = () => { voiceSearchActive = false; };
        voiceSearchRecognition.start();
    }

    function toggleCompletedTasks() {
        isCompletedExpanded = !isCompletedExpanded;
        document.getElementById('f-completed-tasks-list').style.display = isCompletedExpanded ? 'block' : 'none';
        document.getElementById('f-completed-icon').className = isCompletedExpanded ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
    }

    function openTaskEdit(el) {
        const isGeneral = el.getAttribute('data-general') === 'true';
        let taskFamilyLabel = 'משימה כללית';
        if (isGeneral) {
            currentEditTaskRef = db.meta.generalTasks[el.getAttribute('data-idx')];
        } else {
            const bldg = decodeURIComponent(el.getAttribute('data-bldg'));
            const aptIdx = parseInt(el.getAttribute('data-apt'));
            currentEditTaskRef = db[bldg].apts[aptIdx].tasks[el.getAttribute('data-task')];
            const famName = db[bldg].apts[aptIdx].name || '';
            taskFamilyLabel = `משפחת ${famName} · ${bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : bldg}`;
        }
        // הצג שיוך המשימה
        const famLabelEl = document.getElementById('f-task-edit-family-label');
        if (famLabelEl) famLabelEl.innerText = taskFamilyLabel;

        document.getElementById('f-task-edit-text').value = currentEditTaskRef.text || '';
        let dateVal = currentEditTaskRef.date || '';
        if (dateVal && dateVal.includes('.')) {
            const parts = dateVal.split('.');
            if (parts.length === 3) dateVal = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
        }
        document.getElementById('f-task-edit-date').value = dateVal;
        currentEditTags = [...(currentEditTaskRef.tags || [])];
        buildTagChipsBar();
        renderEditTags();
        closeTagDropdown();
        const inp = document.getElementById('f-tag-at-input');
        if (inp) inp.value = '';
        openSheet(document.getElementById('f-task-edit-sheet').innerHTML, 'auto');
        document.getElementById('f-fab-wrapper').style.display = 'none';
    }


    function buildTagChipsBar() {
        const bar = document.getElementById('f-tag-chips-bar');
        if (!bar) return;
        const suggestions = getTagSuggestions('').slice(0, 8);
        bar.innerHTML = suggestions.map(s => {
            const active = currentEditTags.includes(s);
            return `<button type="button" onclick="fieldApp.toggleChipTag('${s.replace(/'/g,"\\'")}')"
                style="padding:6px 13px; border-radius:20px; border:1.5px solid ${active ? 'var(--accent)' : 'var(--border-light)'};
                       background:${active ? 'var(--accent)' : 'var(--bg-body)'};
                       color:${active ? 'white' : 'var(--text-main)'};
                       font-family:inherit; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; transition:all 0.15s;">
                ${active ? '<i class="fas fa-check" style="margin-left:5px;font-size:10px;"></i>' : ''}${escapeHTML(s)}
            </button>`;
        }).join('');
    }

    function toggleChipTag(tag) {
        if (currentEditTags.includes(tag)) currentEditTags = currentEditTags.filter(t => t !== tag);
        else currentEditTags.push(tag);
        buildTagChipsBar();
        renderEditTags();
    }

    function getTagSuggestions(query) {
        const q = query.toLowerCase();
        const set = new Set();
        Object.keys(db).forEach(bldg => {
            if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            // שם הבניין/רחוב
            if (!q || bldg.toLowerCase().includes(q)) set.add(bldg);
            (db[bldg].apts || []).forEach(apt => {
                // שם משפחה
                if (apt.name && (!q || apt.name.toLowerCase().includes(q))) set.add(apt.name);
                // שמות הורים בנפרד
                if (apt.fatherName && (!q || apt.fatherName.toLowerCase().includes(q))) set.add(apt.fatherName);
                if (apt.motherName && (!q || apt.motherName.toLowerCase().includes(q))) set.add(apt.motherName);
                // תיוגים קיימים מהמשפחה
                (apt.tags || []).forEach(tag => { if (!q || tag.toLowerCase().includes(q)) set.add(tag); });
                // תיוגים ממשימות קיימות
                (apt.tasks || []).forEach(t => (t.tags || []).forEach(tag => { if (!q || tag.toLowerCase().includes(q)) set.add(tag); }));
            });
        });
        (db.meta?.generalTasks || []).forEach(t => (t.tags || []).forEach(tag => { if (!q || tag.toLowerCase().includes(q)) set.add(tag); }));
        return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'he'));
    }

    function onTagAtInput(val) {
        const q = val.trim();
        const dropdown = document.getElementById('f-tag-at-dropdown');
        if (!dropdown) return;
        if (!q) { closeTagDropdown(); return; }
        const results = getTagSuggestions(q);
        const hasFree = !results.map(r => r.toLowerCase()).includes(q.toLowerCase());
        tagDropdownItems = [
            ...(hasFree ? [{ label: `➕ הוסף "${q}"`, val: q }] : []),
            ...results.slice(0, 7).map(r => ({ label: r, val: r }))
        ];
        tagDropdownFocus = -1;
        if (!tagDropdownItems.length) { closeTagDropdown(); return; }
        dropdown.style.display = 'block';
        dropdown.innerHTML = tagDropdownItems.map((item, i) =>
            `<div class="tag-dd-item" data-i="${i}"
                style="padding:11px 15px; cursor:pointer; font-size:14px;
                       color:${item.label.startsWith('➕') ? 'var(--accent)' : 'var(--text-main)'};
                       font-weight:${item.label.startsWith('➕') ? '700' : '500'};
                       border-bottom:1px solid var(--border-light);"
                onmousedown="event.preventDefault(); fieldApp.selectDropdownTag(${i})"
                ontouchstart="event.preventDefault(); fieldApp.selectDropdownTag(${i})">
                ${item.label.startsWith('➕') ? '' : '<i class="fas fa-at" style="margin-left:7px;font-size:10px;color:var(--text-muted);"></i>'}${escapeHTML(item.label)}
            </div>`
        ).join('');
    }

    function onTagAtKey(e) {
        const dropdown = document.getElementById('f-tag-at-dropdown');
        if (!dropdown || dropdown.style.display === 'none') return;
        if (e.key === 'ArrowDown') { e.preventDefault(); tagDropdownFocus = Math.min(tagDropdownFocus + 1, tagDropdownItems.length - 1); highlightTagDropdown(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); tagDropdownFocus = Math.max(tagDropdownFocus - 1, 0); highlightTagDropdown(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (tagDropdownFocus >= 0) selectDropdownTag(tagDropdownFocus); }
        else if (e.key === 'Escape') closeTagDropdown();
    }

    function highlightTagDropdown() {
        document.querySelectorAll('.tag-dd-item').forEach((el, i) => {
            el.style.background = i === tagDropdownFocus ? 'rgba(37,99,235,0.1)' : '';
        });
    }

    function selectDropdownTag(i) {
        const tag = tagDropdownItems[i]?.val;
        if (!tag) return;
        if (!currentEditTags.includes(tag)) currentEditTags.push(tag);
        buildTagChipsBar();
        renderEditTags();
        const inp = document.getElementById('f-tag-at-input');
        if (inp) inp.value = '';
        closeTagDropdown();
    }

    function closeTagDropdown() {
        const d = document.getElementById('f-tag-at-dropdown');
        if (d) { d.style.display = 'none'; d.innerHTML = ''; }
        tagDropdownItems = [];
        tagDropdownFocus = -1;
    }

    function renderEditTags() {
        const container = document.getElementById('f-task-edit-tags-display');
        if (!container) return;
        container.innerHTML = currentEditTags.map((tag, i) =>
            `<span style="background:rgba(37,99,235,0.13); color:var(--accent); padding:5px 12px; border-radius:20px; font-size:13px; font-weight:700; display:inline-flex; align-items:center; gap:6px;">
                <i class="fas fa-at" style="font-size:10px; opacity:0.6;"></i>${escapeHTML(tag)}
                <i class="fas fa-times" style="cursor:pointer; font-size:10px; opacity:0.5;" onclick="fieldApp.removeEditTag(${i})"></i>
            </span>`
        ).join('');
    }

    function addEditTag() {
        const input = document.getElementById('f-tag-at-input');
        if (!input) return;
        const val = input.value.trim();
        if (val && !currentEditTags.includes(val)) { currentEditTags.push(val); buildTagChipsBar(); renderEditTags(); }
        input.value = '';
        closeTagDropdown();
    }

    function removeEditTag(idx) {
        currentEditTags.splice(idx, 1);
        buildTagChipsBar();
        renderEditTags();
    }

    function saveEditedTask() {
        if (!currentEditTaskRef) return;
        currentEditTaskRef.text = document.getElementById('f-task-edit-text').value.trim();
        const rawDate = document.getElementById('f-task-edit-date').value;
        if (rawDate) {
            const d = new Date(rawDate);
            currentEditTaskRef.date = d.toLocaleDateString('he-IL');
        } else {
            currentEditTaskRef.date = '';
        }
        currentEditTaskRef.tags = [...currentEditTags];
        storageSet(DATA_KEY, db);
        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: 'edit_task', timestamp: new Date().toISOString() });
        storageSet(OUTBOX_KEY, outbox);
        closeOverlays();
        showToast('✅ המשימה עודכנה!');
        renderTasks();
    }

    // ==========================================
    // קול וסיכום ביקורים
    // ==========================================
    function openVoiceSummary(status) {
        closeOverlays();
        if(currentTarget) currentTarget.status = status;
        document.getElementById('f-voice-status-badge').innerText = status;
        openSheet(document.getElementById('f-voice-sheet').innerHTML, 'auto');
        document.getElementById('f-voice-result').value = '';
        if(recognition) toggleVoiceRecording(); else showToast("הקלטה קולית אינה נתמכת, ניתן להקליד.");
    }

    function toggleVoiceRecording() {
        const btn = document.getElementById('f-mic-btn');
        if (isRecording) stopVoiceRecording();
        else if(recognition) { try { recognition.start(); } catch(e) {} isRecording = true; btn.style.background = 'var(--danger)'; btn.style.boxShadow = '0 0 15px rgba(239,68,68,0.8)'; }
    }

    function stopVoiceRecording() {
        if(recognition && isRecording) { recognition.stop(); isRecording = false; const btn = document.getElementById('f-mic-btn'); if(btn) { btn.style.background = 'var(--text-muted)'; btn.style.boxShadow = 'none'; } }
    }

    function saveVisitLog() {
        stopVoiceRecording();
        const text = document.getElementById('f-voice-result').value.trim();
        if(!currentTarget) return;

        const bldg = currentTarget.bldg; const aptIdx = currentTarget.aptIdx; const status = currentTarget.status || 'כללי'; const famName = db[bldg].apts[aptIdx].name;

        // שמירת היסטוריה
        if (!db[bldg].apts[aptIdx].history) db[bldg].apts[aptIdx].history = [];
        db[bldg].apts[aptIdx].history.push({
            date: new Date().toLocaleDateString('he-IL'),
            status,
            content: text
        });
        storageSet(DATA_KEY, db);

        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: 'visit_log', bldg, aptName: famName, status, timestamp: new Date().toISOString(), content: text });
        storageSet(OUTBOX_KEY, outbox);

        const taskKeywords = ['צריך', 'לזכור', 'לבדוק', 'להביא', 'לחזור', 'למסור', 'לברר', 'חשוב', 'דחוף', 'לוודא', 'לקחת', 'לדבר', 'להתקשר', 'לשלוח', 'לתת'];
        const sentences = text.split(/[.,;\n]/); let extractedTask = '';
        sentences.forEach(s => { s = s.trim(); if (taskKeywords.some(kw => s.startsWith(kw) || s.includes(' ' + kw + ' ')) && s.length > 5) extractedTask += s + ' '; });
        extractedTask = extractedTask.trim();

        if (extractedTask) {
            pendingAutoTaskContext = { bldg, aptIdx, famName };
            document.getElementById('f-auto-task-text').value = extractedTask;
            const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
            document.getElementById('f-auto-task-date').value = tomorrow.toISOString().split('T')[0];
            closeOverlays();
            document.getElementById('f-task-confirm-sheet').classList.add('open'); document.getElementById('f-scrim').style.display = 'block';
        } else {
            closeOverlays(); showToast(`✅ הסטטוס '${status}' והסיכום נשמרו!`);
        }
    }

    function confirmAutoTask() {
        if(!pendingAutoTaskContext) return;
        const taskText = document.getElementById('f-auto-task-text').value.trim();
        const taskDate = document.getElementById('f-auto-task-date').value;
        const { bldg, aptIdx, famName } = pendingAutoTaskContext;

        if(!taskText) { showToast("המשימה ריקה"); return; }
        const dateObj = new Date(taskDate); const formattedDate = `${dateObj.getDate()}/${dateObj.getMonth()+1}/${dateObj.getFullYear()}`;

        const newTask = { text: taskText, date: formattedDate, done: false };
        if (!db[bldg].apts[aptIdx].tasks) db[bldg].apts[aptIdx].tasks = [];
        db[bldg].apts[aptIdx].tasks.push(newTask);
        storageSet(DATA_KEY, db);

        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: 'add_family_task', bldg, aptName: famName, timestamp: new Date().toISOString(), payload: { taskText, taskDate: formattedDate } });
        storageSet(OUTBOX_KEY, outbox);

        pendingAutoTaskContext = null; closeOverlays(); showToast("✅ הביקור והמשימה תועדו ביומן!"); renderTasks();
    }

    // ==========================================
    // ניווט, כלים, ומצב המבצע (HUD)
    // ==========================================
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
            map.flyTo({ center: startCoords, zoom: 19.5, pitch: 75, bearing: 0, duration: 3000, essential: true });
            showToast("🚗 מסלול נוצר, מתחילים ניווט תלת-ממדי!");
        } catch (e) { showToast("שגיאה ביצירת מסלול."); }
    }

    function callFamilyNumber(p) { if(p) window.location.href = `tel:${p}`; else showToast("אין מספר"); }
    function jumpToCenter() { const c = db?.__SETTINGS__?.homeLocation?.coords ? db.__SETTINGS__.homeLocation.coords : [34.8878, 31.9928]; map.flyTo({ center: c, zoom: 18, pitch: 60 }); }
    function recenter() { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 17, pitch: 60 })); }

    function toggleMapStyle() {
        if (!map) return;
        const current = map.getStyle().name || '';
        const isSatellite = current.toLowerCase().includes('satellite');
        map.setStyle(isSatellite ? (isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12') : 'mapbox://styles/mapbox/satellite-streets-v12');
        map.once('style.load', () => { add3DLayer(); renderMarkers(); });
        showToast(isSatellite ? '🗺️ מפת רחובות' : '🛰️ מפת לוויין');
    }

    function toggleDarkMode() { isDark = !isDark; document.body.classList.toggle('dark-mode', isDark); localStorage.setItem('field_theme', isDark ? 'dark' : 'light'); document.getElementById('f-theme-btn').innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>'; if (map) { map.setStyle(isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12'); map.once('style.load', () => { add3DLayer(); renderMarkers(); }); } }
    function openExternalNav(lng, lat, app) { if(!lng || !lat) { showToast("אין מיקום מדויק"); return; } if (app === 'waze') window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank'); if (app === 'google') window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank'); }

    function startLocationTracking() {
        if (!navigator.geolocation) return;
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (!db || !isMissionActive) return;
                const user = [pos.coords.longitude, pos.coords.latitude];
                if (!isDraggingMap && map) { map.easeTo({ center: user, pitch: 75, zoom: 19.5, bearing: pos.coords.heading !== null && !isNaN(pos.coords.heading) ? pos.coords.heading : map.getBearing(), duration: 1000 }); }
                Object.keys(db).forEach(bldg => {
                    if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return;
                    if(!db[bldg].apts || db[bldg].apts.length === 0) return;
                    const coords = db[bldg].info?.coords; if(!coords || isNaN(coords[0])) return;
                    if (calculateDistance(user, coords) < GEOFENCE_M && !isVisited(bldg)) { markVisited(bldg); openBuildingCard(bldg); }
                });
            },
            (err) => console.error(err),
            { enableHighAccuracy: true }
        );
    }


    function skipMissionTarget() {
        if (!isMissionActive) return;
        showToast('⏭ דולג לתחנה הבאה');
        if (navigator.vibrate) navigator.vibrate([20, 30]);
        missionCurrentIdx++;
        if (missionCurrentIdx >= missionWaypoints.length) {
            showMissionSummary();
        } else {
            updateMissionHUD();
        }
    }

    function _missionWaze() {
        const wp = missionWaypoints[missionCurrentIdx];
        if (!wp) return;
        window.open(`https://waze.com/ul?ll=${wp[1]},${wp[0]}&navigate=yes`, '_blank');
    }

    function startMissionMode(waypoints) {
        missionWaypoints = waypoints || []; missionCurrentIdx = 0; missionPaused = false; isMissionActive = true;
        document.getElementById('f-mission-hud').style.display = 'flex';
        updateAppUIState('MISSION_ACTIVE');
        updateMissionHUD(); showToast("🚀 מצב מבצע פעיל! נווט ליעד הראשון."); if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    }

    function updateMissionHUD() {
        if (!isMissionActive || missionWaypoints.length === 0) return;
        const total = missionWaypoints.length; const current = missionCurrentIdx + 1;
        document.getElementById('f-mission-progress-text').innerText = `יעד ${current} מתוך ${total}`;
        document.getElementById('f-mission-progress-bar').style.width = `${(current / total) * 100}%`;
        const targetCoords = missionWaypoints[missionCurrentIdx]; let targetBldg = null, minDist = Infinity;
        Object.keys(db).forEach(bldg => {
            if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            const c = db[bldg].info?.coords; if(!c) return;
            const d = calculateDistance(targetCoords, c); if (d < minDist) { minDist = d; targetBldg = bldg; }
        });

        if (targetBldg) {
            const bldgData = db[targetBldg];
            document.getElementById('f-mission-target-name').innerText = targetBldg;
            document.getElementById('f-mission-target-code').innerText = bldgData.info?.code || '—';
            const apts = bldgData.apts || [];
            document.getElementById('f-mission-fam-count').innerText = `${apts.length} משפחות`;

            let famsHtml = apts.map((fam, idx) => `<div style="background:var(--bg-body); padding:10px 12px; border-radius:10px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="fieldApp.openFamilyCard('${encodeURIComponent(targetBldg)}', ${idx})"><div><div style="font-weight:600; font-size:14px;">משפחת ${escapeHTML(fam.name||'')}</div>${fam.num ? `<div style="font-size:12px; color:var(--text-muted);">דירה ${fam.num}</div>` : ''}</div><i class="fas fa-chevron-left" style="color:var(--text-muted); font-size:12px;"></i></div>`).join('');
            document.getElementById('f-mission-families-list').innerHTML = famsHtml || '<div style="color:var(--text-muted); font-size:13px; text-align:center; padding:10px;">אין משפחות</div>';

            let tasksHtml = '';
            apts.forEach((fam, aptIdx) => {
                (fam.tasks || []).filter(t => !t.done).forEach((t, tIdx) => { tasksHtml += `<div style="background:rgba(37,99,235,0.08); border:1px solid rgba(37,99,235,0.2); padding:10px 12px; border-radius:10px; display:flex; gap:10px; align-items:center;"><input type="checkbox" onchange="fieldApp.completeMissionTask('${encodeURIComponent(targetBldg)}', ${aptIdx}, ${tIdx}, this)" style="width:18px; height:18px; accent-color:var(--accent); flex-shrink:0;"><div><div style="font-size:14px; font-weight:600;">${escapeHTML(t.text)}</div><div style="font-size:12px; color:var(--text-muted);">משפחת ${escapeHTML(fam.name||'')} · ${t.date||''}</div></div></div>`; });
            });
            document.getElementById('f-mission-tasks-list').innerHTML = tasksHtml || '<div style="color:var(--text-muted); font-size:13px; text-align:center; padding:10px;">אין משימות פתוחות</div>';
            currentTarget = { bldg: targetBldg, aptIdx: 0 };
        }
    }

    function completeMissionTask(bldgEnc, aptIdx, taskIdx, checkbox) {
        const bldg = decodeURIComponent(bldgEnc); db[bldg].apts[aptIdx].tasks[taskIdx].done = true; storageSet(DATA_KEY, db);
        const outbox = storageGet(OUTBOX_KEY) || []; outbox.push({ type: 'task_done', bldg, aptIdx, taskIdx, timestamp: new Date().toISOString() }); storageSet(OUTBOX_KEY, outbox);
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]); setTimeout(() => checkbox.closest('div[style]').style.opacity = '0.4', 100); showToast("✅ משימה הושלמה!");
    }

    function switchMissionTab(tab) {
        const famTab = document.getElementById('f-mission-tab-fam'); const taskTab = document.getElementById('f-mission-tab-tasks');
        const famContent = document.getElementById('f-mission-families-list'); const taskContent = document.getElementById('f-mission-tasks-list');
        if (tab === 'fam') {
            famTab.style.background = 'var(--accent)'; famTab.style.color = 'white'; taskTab.style.background = 'var(--bg-body)'; taskTab.style.color = 'var(--text-muted)';
            famContent.style.display = 'flex'; famContent.style.flexDirection = 'column'; famContent.style.gap = '8px'; taskContent.style.display = 'none';
        } else {
            taskTab.style.background = 'var(--accent)'; taskTab.style.color = 'white'; famTab.style.background = 'var(--bg-body)'; famTab.style.color = 'var(--text-muted)';
            taskContent.style.display = 'flex'; taskContent.style.flexDirection = 'column'; taskContent.style.gap = '8px'; famContent.style.display = 'none';
        }
    }

    function nextMissionTarget() { if (missionCurrentIdx < missionWaypoints.length - 1) { missionCurrentIdx++; updateMissionHUD(); const coords = missionWaypoints[missionCurrentIdx]; if (map) map.flyTo({ center: coords, zoom: 18, pitch: 75, duration: 1500 }); if (navigator.vibrate) navigator.vibrate([30, 20, 30]); } else { showMissionSummary(); } }
    function prevMissionTarget() { if (missionCurrentIdx > 0) { missionCurrentIdx--; updateMissionHUD(); const coords = missionWaypoints[missionCurrentIdx]; if (map) map.flyTo({ center: coords, zoom: 18, pitch: 75, duration: 1500 }); } }
    function pauseMission() { missionPaused = !missionPaused; const btn = document.getElementById('f-mission-pause-btn'); if (missionPaused) { btn.innerHTML = '<i class="fas fa-play"></i>'; btn.style.background = 'var(--success)'; showToast("⏸ מבצע מושהה."); } else { btn.innerHTML = '<i class="fas fa-pause"></i>'; btn.style.background = 'var(--warning)'; showToast("▶️ ממשיך במבצע!"); } }
    function refreshMissionRoute() { showToast("🔄 מחשב מסלול מחדש..."); if (navigator.vibrate) navigator.vibrate(30); const remaining = missionWaypoints.slice(missionCurrentIdx); if (navigator.geolocation) { navigator.geolocation.getCurrentPosition( pos => drawMultiStopRoute([pos.coords.longitude, pos.coords.latitude], remaining), () => drawMultiStopRoute(db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928], remaining) ); } }
    function finishMission() { showMissionSummary(); }


    function openCurrentMissionCard() {
        // מוצא את הבניין הנוכחי ופותח כרטיס ביקור
        const coords = missionWaypoints[missionCurrentIdx];
        if (!coords) return;
        let closestBldg = null; let minDist = 0.001;
        Object.keys(db).forEach(key => {
            if (key === '__BOARDS__' || key === '__SETTINGS__' || key === 'meta') return;
            const c = db[key].info?.coords; if (!c) return;
            const d = Math.sqrt(Math.pow(c[0]-coords[0],2)+Math.pow(c[1]-coords[1],2));
            if (d < minDist) { minDist = d; closestBldg = key; }
        });
        if (closestBldg) openBuildingCard(closestBldg, false);
        else showToast('לא נמצא בניין במיקום זה');
    }

    function showMissionSummary() {
        isMissionActive = false;
        if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }

        // סיכום לפי המסלול הספציפי בלבד
        const stopsCount = missionWaypoints.length;
        let tasksCompletedInMission = 0;

        // ספור משימות שהושלמו בבניינים שהיו במסלול
        missionWaypoints.forEach(coords => {
            let closestBldg = null; let minDist = 0.001;
            Object.keys(db).forEach(key => {
                if (key === '__BOARDS__' || key === '__SETTINGS__' || key === 'meta') return;
                const c = db[key].info?.coords; if (!c) return;
                const d = Math.sqrt(Math.pow(c[0]-coords[0],2)+Math.pow(c[1]-coords[1],2));
                if (d < minDist) { minDist = d; closestBldg = key; }
            });
            if (closestBldg) {
                (db[closestBldg].apts || []).forEach(apt => {
                    (apt.tasks || []).forEach(t => { if (t.done && t._doneInSession) tasksCompletedInMission++; });
                });
            }
        });

        document.getElementById('f-mission-hud').style.display = 'none';
        document.getElementById('f-mission-summary').style.display = 'flex';
        document.getElementById('f-summary-families').innerText = stopsCount;
        document.getElementById('f-summary-tasks').innerText = tasksCompletedInMission;
        document.getElementById('f-summary-stops').innerText = missionCurrentIdx + 1;
        if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    }

    function closeMissionSummary() {
        document.getElementById('f-mission-summary').style.display = 'none';
        updateAppUIState('CRM');
        _speedDialOpen = false;
        const dial = document.getElementById('speed-dial');
        const overlay = document.getElementById('speed-dial-overlay');
        const fabBtn = document.getElementById('super-fab-btn');
        if (dial) dial.classList.remove('open');
        if (overlay) overlay.style.display = 'none';
        if (fabBtn) fabBtn.classList.remove('dial-open');
        missionWaypoints = []; missionCurrentIdx = 0; isMissionActive = false;
        if (map && map.getLayer('route')) map.removeLayer('route');
        if (map && map.getSource('route')) map.removeSource('route');
        renderTasks();
    }

    function markAllDoneInBuilding() {
        if (!currentTarget) return; const bldg = currentTarget.bldg; const apts = db[bldg].apts || []; let count = 0; const outbox = storageGet(OUTBOX_KEY) || [];
        apts.forEach((fam, aptIdx) => { (fam.tasks || []).forEach((t, tIdx) => { if (!t.done) { t.done = true; count++; outbox.push({ type: 'task_done', bldg, aptIdx, tIdx, timestamp: new Date().toISOString() }); } }); });
        storageSet(DATA_KEY, db); storageSet(OUTBOX_KEY, outbox); if (navigator.vibrate) navigator.vibrate([30, 20, 30, 20, 60]); showToast(`✅ ${count} משימות סומנו כבוצעו!`); updateMissionHUD();
    }

    function toggleTaskLayer() {
        taskLayerVisible = !taskLayerVisible; const btn = document.getElementById('f-task-layer-btn');
        if (taskLayerVisible) { renderTaskMarkers(); btn.style.background = 'var(--accent)'; btn.style.color = 'white'; }
        else { taskMarkers.forEach(m => m.remove()); taskMarkers = []; btn.style.background = 'var(--surface)'; btn.style.color = 'var(--text-main)'; }
    }

    function renderTaskMarkers() {
        taskMarkers.forEach(m => m.remove()); taskMarkers = [];
        Object.keys(db).forEach(bldg => {
            if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDRESS_KEY) return;
            const coords = db[bldg].info?.coords; if(!coords || isNaN(coords[0])) return;
            let openTasks = 0; (db[bldg].apts || []).forEach(apt => { (apt.tasks || []).forEach(t => { if(!t.done) openTasks++; }); }); if (openTasks === 0) return;
            const el = document.createElement('div');
            el.style.cssText = `width: 32px; height: 32px; background: var(--warning); border: 2px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 13px; box-shadow: 0 2px 8px rgba(245,158,11,0.6); cursor: pointer; position: relative;`;
            el.innerHTML = `<i class="fas fa-exclamation" style="font-size:14px;"></i>`;
            const badge = document.createElement('div');
            badge.style.cssText = `position:absolute; top:-6px; right:-6px; background:var(--danger); color:white; border-radius:50%; width:16px; height:16px; font-size:10px; font-weight:bold; display:flex; align-items:center; justify-content:center; border:1px solid white;`;
            badge.innerText = openTasks; el.appendChild(badge);
            const marker = new mapboxgl.Marker(el).setLngLat(coords).addTo(map);
            el.addEventListener('click', (e) => { e.stopPropagation(); openBuildingCard(bldg); });
            taskMarkers.push(marker);
        });
    }

    function saveRoute(waypoints, name) {
        const saved = storageGet(SAVED_ROUTES_KEY) || [];
        const route = { id: Date.now(), name: name || `מסלול ${new Date().toLocaleDateString('he-IL')}`, waypoints, status: 'שמור', created: new Date().toISOString() };
        saved.push(route); storageSet(SAVED_ROUTES_KEY, saved); return route;
    }
    function loadSavedRoutes() { return storageGet(SAVED_ROUTES_KEY) || []; }
    function deleteSavedRoute(id) { let saved = storageGet(SAVED_ROUTES_KEY) || []; saved = saved.filter(r => r.id !== id); storageSet(SAVED_ROUTES_KEY, saved); renderSavedRoutesSheet(); }

    function renderSavedRoutesSheet() {
        const container = document.getElementById('f-saved-routes-list'); if (!container) return; const routes = loadSavedRoutes();
        if (routes.length === 0) { container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px; font-size:14px;">אין מסלולים שמורים</div>'; return; }
        container.innerHTML = routes.reverse().map(r => `<div style="background:var(--bg-body); border:1px solid var(--border-light); border-radius:12px; padding:14px; display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"><div><div style="font-weight:700; font-size:15px;">${escapeHTML(r.name)}</div><div style="font-size:12px; color:var(--text-muted); margin-top:3px;"><i class="fas fa-map-pin"></i> ${r.waypoints.length} יעדים · ${new Date(r.created).toLocaleDateString('he-IL')}</div><div style="font-size:12px; margin-top:3px;"><span style="background:rgba(37,99,235,0.1); color:var(--accent); padding:2px 8px; border-radius:8px; font-weight:600;">${r.status}</span></div></div><div style="display:flex; gap:8px;"><button onclick="fieldApp.closeOverlays(); fieldApp.buildRouteFromSaved(${r.id})" style="background:var(--accent); color:white; border:none; padding:8px 14px; border-radius:10px; font-weight:bold; cursor:pointer; font-size:13px;"><i class="fas fa-play"></i> פתח</button><button onclick="fieldApp.deleteSavedRoute(${r.id})" style="background:var(--danger); color:white; border:none; padding:8px 10px; border-radius:10px; cursor:pointer; font-size:13px;"><i class="fas fa-trash"></i></button></div></div>`).join('');
    }

    function buildRouteFromSaved(id) {
        const routes = loadSavedRoutes(); const route = routes.find(r => r.id === id); if (!route) return;
        route.status = 'בתהליך'; const saved = routes.map(r => r.id === id ? route : r); storageSet(SAVED_ROUTES_KEY, saved); isMissionActive = true;
        if (navigator.geolocation) { navigator.geolocation.getCurrentPosition( pos => { drawMultiStopRoute([pos.coords.longitude, pos.coords.latitude], route.waypoints); startMissionMode(route.waypoints); }, () => { drawMultiStopRoute(db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928], route.waypoints); startMissionMode(route.waypoints); } ); }
    }

    function openSavedRoutesSheet() { closeOverlays(); renderSavedRoutesSheet(); openSheet(document.getElementById('f-saved-routes-sheet').innerHTML, 'auto'); }
    function showRouteDialog(waypoints) { pendingRouteWaypoints = waypoints; document.getElementById('f-route-dialog').style.display = 'flex'; }

    function routeDialogGoNow() {
        document.getElementById('f-route-dialog').style.display = 'none'; if (pendingRouteWaypoints.length === 0) return; closeOverlays(); isMissionActive = true;
        if (navigator.geolocation) { navigator.geolocation.getCurrentPosition( pos => { drawMultiStopRoute([pos.coords.longitude, pos.coords.latitude], pendingRouteWaypoints); startMissionMode(pendingRouteWaypoints); }, () => { drawMultiStopRoute(db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928], pendingRouteWaypoints); startMissionMode(pendingRouteWaypoints); } ); }
    }

    function routeDialogSaveLater() {
        document.getElementById('f-route-dialog').style.display = 'none';
        const name = `מסלול ${new Date().toLocaleDateString('he-IL')} ${new Date().toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'})}`;
        saveRoute(pendingRouteWaypoints, name); showToast("💾 המסלול נשמר! תוכל להפעיל אותו מאוחר יותר."); pendingRouteWaypoints = [];
    }

    function openArrivalSheetEncoded(bEnc, idx) { openFamilyCard(bEnc, idx); }


    // ==========================================
    // מגירת מסלול פעיל + ניווט (Route Sheet)
    // ==========================================
    function toggleRouteSheet() {
        const sheet = document.getElementById('route-sheet');
        if (sheet) { sheet.classList.toggle('expanded'); updateMapPadding(); }
    }

    function addStopToRoute(id, name, address, coords) {
        const exists = currentDraftRoute.findIndex(s => s.id === id);
        if (exists > -1) { removeStopFromRoute(id); return; }
        currentDraftRoute.push({ id, name, address, coords, done: false });
        renderRouteSheet();
        // צבע בניין במפה
        if (coords) colorBuildingByCoords(coords, true);
        // הצג מגירה
        const sheet = document.getElementById('route-sheet');
        if (sheet) sheet.classList.add('expanded');
    }

    function removeStopFromRoute(id) {
        const stop = currentDraftRoute.find(s => s.id === id);
        if (stop && stop.coords) colorBuildingByCoords(stop.coords, false);
        currentDraftRoute = currentDraftRoute.filter(s => s.id !== id);
        renderRouteSheet();
    }

    function renderRouteSheet() {
        const list = document.getElementById('route-stops-list');
        const countEl = document.getElementById('route-count');
        const startBtn = document.getElementById('btn-start-route');
        const etaEl = document.getElementById('route-eta');
        if (!list) return;

        if (countEl) countEl.innerText = currentDraftRoute.length;
        if (startBtn) startBtn.disabled = currentDraftRoute.length === 0;
        if (etaEl) etaEl.innerText = currentDraftRoute.length === 0
            ? 'בחר נקודות במפה'
            : `${currentDraftRoute.length} תחנות נבחרו`;

        if (currentDraftRoute.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-muted); font-size:13px;">לחץ על בניין במפה להוספה</div>';
            return;
        }

        let html = `<button onclick="fieldApp.autoSortRoute()" style="width:100%; margin-bottom:10px; padding:9px; background:rgba(16,185,129,0.1); color:var(--success); border:1px solid var(--success); border-radius:10px; font-weight:bold; cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px;"><i class="fas fa-magic"></i> סדר אוטומטי</button>`;

        html += currentDraftRoute.map((stop, idx) => `
            <div class="route-editor-item" data-idx="${idx}"
                 draggable="true"
                 ondragstart="fieldApp.handleRouteDragStart(event, ${idx})"
                 ondragover="event.preventDefault()"
                 ondrop="fieldApp.handleRouteDrop(event, ${idx})"
                 ontouchstart="fieldApp.handleRouteTouchStart(event, ${idx})"
                 ontouchmove="fieldApp.handleRouteTouchMove(event)"
                 ontouchend="fieldApp.handleRouteTouchEnd(event)"
                 style="${stop.done ? 'opacity:0.45;' : ''}">
                <div class="drag-handle"><i class="fas fa-grip-lines"></i></div>
                <div class="content">
                    <div style="font-weight:700; font-size:14px;">
                        <span style="color:var(--warning); font-weight:900; margin-left:4px;">${idx+1}.</span>
                        ${escapeHTML(stop.name || stop.address)}
                    </div>
                    ${stop.address && stop.address !== stop.name ? `<div style="font-size:12px; color:var(--text-muted);">${escapeHTML(stop.address)}</div>` : ''}
                </div>
                <button onclick="fieldApp.removeStopFromRoute('${stop.id}')" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:6px;"><i class="fas fa-times"></i></button>
            </div>`).join('');

        list.innerHTML = html;
    }

    function startActiveRoute() {
        if (currentDraftRoute.length === 0) return;
        activeRouteIndex = 0;
        document.getElementById('route-sheet').classList.remove('expanded');
        document.getElementById('active-nav-overlay').style.display = 'flex';
        updateAppUIState('MISSION_ACTIVE');
        renderActiveStop();
        const waypoints = currentDraftRoute.map(s => s.coords);
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => drawMultiStopRoute([pos.coords.longitude, pos.coords.latitude], waypoints),
                () => drawMultiStopRoute(db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928], waypoints)
            );
        }
        showToast('🚀 מסלול התחיל!');
        if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    }

    function stopActiveRoute() {
        document.getElementById('active-nav-overlay').style.display = 'none';
        updateAppUIState('CRM');
        showToast('⏸ המסלול הושהה');
    }

    function renderActiveStop() {
        const stop = currentDraftRoute[activeRouteIndex];
        if (!stop) { stopActiveRoute(); showMissionSummary(); return; }
        document.getElementById('active-stop-counter').innerText = `תחנה ${activeRouteIndex + 1} מתוך ${currentDraftRoute.length}`;
        document.getElementById('active-stop-name').innerText = stop.name || stop.address;
        document.getElementById('active-stop-address').innerText = stop.address || '';
        if (stop.coords && map) map.flyTo({ center: stop.coords, zoom: 18, pitch: 60, duration: 1200 });
    }

    function markStopDone() {
        if (currentDraftRoute[activeRouteIndex]) {
            currentDraftRoute[activeRouteIndex].done = true;
            renderRouteSheet();
        }
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
        activeRouteIndex++;
        if (activeRouteIndex >= currentDraftRoute.length) {
            document.getElementById('active-nav-overlay').style.display = 'none';
            currentDraftRoute = [];
            renderRouteSheet();
            showMissionSummary();
        } else {
            renderActiveStop();
        }
    }

    function openWaze() {
        const stop = currentDraftRoute[activeRouteIndex];
        if (!stop || !stop.coords) return;
        window.open(`https://waze.com/ul?ll=${stop.coords[1]},${stop.coords[0]}&navigate=yes`, '_blank');
    }


    // ==========================================
    // מיקרו-טופס הוספת משפחה מהירה
    // ==========================================
    function openQuickFamilyForm(prefilledAddress = '') {
        // אפס שדות
        document.getElementById('q-family-name').value = '';
        document.getElementById('q-first-name').value = '';
        document.getElementById('q-family-phone').value = '';
        document.getElementById('q-family-address').value = prefilledAddress;
        // פתח מגירה
        openSheet(document.getElementById('quick-family-sheet').innerHTML, 'auto');
        document.getElementById('action-sheet-overlay').classList.remove('active');
        // פוקוס לשדה הראשון הריק
        setTimeout(() => {
            const focus = prefilledAddress
                ? document.getElementById('q-family-name')
                : document.getElementById('q-family-address');
            focus.focus();
        }, 350);
    }

    function closeQuickFamilyForm() { closeOverlays(); }

    function expandToFullFamilyForm() {
        closeQuickFamilyForm();
        openFamilyForm();
    }

    function saveQuickFamily() {
        const familyName = document.getElementById('q-family-name').value.trim();
        const firstName  = document.getElementById('q-first-name').value.trim();
        const address    = document.getElementById('q-family-address').value.trim();
        const phone      = document.getElementById('q-family-phone').value.trim();

        if (!familyName && !firstName && !phone) {
            showToast("⚠️ יש למלא לפחות שם משפחה או טלפון");
            return;
        }

        const bldgKey = address || NO_ADDRESS_KEY;
        if (!db[bldgKey]) {
            db[bldgKey] = { info: { coords: null, code: '', rep: '', notes: '' }, apts: [] };
        }

        const newFamily = {
            name: familyName,
            father: firstName,
            fatherName: firstName,
            mother: '',
            motherName: '',
            fatherPhone: phone,
            motherPhone: '',
            phone,
            num: '',
            style: '',
            notes: '',
            tags: [],
            boards: {},
            childrenList: [],
            interactions: [],
            donations: [],
            tasks: [],
            customData: {},
            status: 'חדש',
            updatedAt: Date.now()
        };

        db[bldgKey].apts.push(newFamily);

        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({
            type: 'add_full_family',
            bldg: bldgKey,
            timestamp: new Date().toISOString(),
            payload: newFamily
        });
        storageSet(DATA_KEY, db);
        storageSet(OUTBOX_KEY, outbox);

        // שלח לדרייב מיד — לא לחכות לסנכרון הבא
        pushOutboxToDrive().catch(e => console.warn('pushOutbox after saveQuickFamily:', e));

        closeQuickFamilyForm();
        renderCommunity();
        renderMarkers();
        showToast(`✅ משפחת ${familyName || firstName} נשמרה!`);
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
    }


    // ==========================================
    // מיקרו-טופס הוספת משימה מהירה
    // ==========================================
    let _taskVoiceRec = null;

    function openQuickTaskForm() {
        closeOverlays();

        const todayVal = new Date().toISOString().split('T')[0];

        const html = `
            <button class="sheet-close-btn" onclick="fieldApp.closeOverlays()"><i class="fas fa-times"></i></button>
            <div class="quick-form-header" style="padding-right:36px; margin-bottom:14px;">
                <h3 style="margin:0; font-size:19px;"><i class="fas fa-tasks" style="color:var(--warning); margin-left:8px;"></i>משימה חדשה</h3>
            </div>
            <div class="quick-form-body">
                <div class="smart-chips-container" id="q-task-smart-chips"></div>
                <div class="f-input-wrapper" style="margin-bottom:10px;">
                    <input type="text" id="q-task-title" class="f-input" placeholder="מה צריך לעשות?" style="padding-right:14px;">
                </div>
                <div class="f-input-wrapper" style="margin-bottom:14px;">
                    <i class="fas fa-calendar-alt"></i>
                    <input type="date" id="q-task-date" class="f-input" value="${todayVal}">
                </div>
                <button class="btn-save-quick" onclick="fieldApp.saveQuickTask()">
                    שמור משימה <i class="fas fa-check"></i>
                </button>
            </div>
        `;

        openSheet(html, 'auto');
        setTimeout(() => {
            renderSmartChips();
            document.getElementById('q-task-title')?.focus();
        }, 300);
    }

    function closeQuickTaskForm() {
        if (_taskVoiceRec) { try { _taskVoiceRec.stop(); } catch(e) {} _taskVoiceRec = null; }
        const mic = document.getElementById('btn-task-mic');
        if (mic) mic.classList.remove('listening');
        closeOverlays();
    }

    function expandToFullTaskForm() {
        closeQuickTaskForm();
        openAddTask();
    }

    function renderSmartChips() {
        const container = document.getElementById('q-task-smart-chips');
        if (!container) return;

        // ספור מחרוזות נפוצות ממשימות קיימות
        const freq = {};
        const addWord = (text) => {
            if (!text) return;
            // חלץ מילים בנות 3+ תווים
            text.split(/[\s,./]+/).forEach(w => {
                w = w.trim();
                if (w.length >= 3) freq[w] = (freq[w] || 0) + 1;
            });
        };

        // סרוק כל המשימות במסד
        (db?.meta?.generalTasks || []).forEach(t => addWord(t.text));
        Object.keys(db || {}).forEach(bldg => {
            if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            (db[bldg]?.apts || []).forEach(apt => {
                (apt.tasks || []).forEach(t => addWord(t.text));
            });
        });

        // המר לרשימה ממוינת
        let chips = Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([text]) => text);

        // ברירת מחדל אם ריק
        if (chips.length === 0) {
            chips = ['מבצע תפילין', 'בדיקת מזוזה', 'חלוקה'];
        }

        container.innerHTML = chips.map(chip => `
            <button class="smart-chip" onclick="fieldApp._selectChip(this, '${escapeHTML(chip)}')">${escapeHTML(chip)}</button>
        `).join('');
    }

    function _selectChip(el, text) {
        // הורד סלקציה מכולם
        document.querySelectorAll('.smart-chip').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
        const input = document.getElementById('q-task-title');
        if (input) {
            input.value = text;
            input.focus();
        }
    }

    function startTaskVoiceDictation() {
        const mic = document.getElementById('btn-task-mic');
        const input = document.getElementById('q-task-title');
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SR) { showToast('הקלטה קולית אינה נתמכת בדפדפן זה'); return; }

        // אם כבר מקליט — עצור
        if (_taskVoiceRec) {
            try { _taskVoiceRec.stop(); } catch(e) {}
            _taskVoiceRec = null;
            if (mic) mic.classList.remove('listening');
            return;
        }

        _taskVoiceRec = new SR();
        _taskVoiceRec.lang = 'he-IL';
        _taskVoiceRec.interimResults = true;
        _taskVoiceRec.continuous = false;

        _taskVoiceRec.onstart = () => { if (mic) mic.classList.add('listening'); };
        _taskVoiceRec.onresult = (e) => {
            let transcript = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                transcript += e.results[i][0].transcript;
            }
            if (input) input.value = transcript;
        };
        _taskVoiceRec.onerror = () => {
            _taskVoiceRec = null;
            if (mic) mic.classList.remove('listening');
        };
        _taskVoiceRec.onend = () => {
            _taskVoiceRec = null;
            if (mic) mic.classList.remove('listening');
        };

        try { _taskVoiceRec.start(); } catch(e) { showToast('לא ניתן להפעיל הקלטה'); }
    }

    function saveQuickTask() {
        const title = document.getElementById('q-task-title').value.trim();
        const date  = document.getElementById('q-task-date').value;

        if (!title) { showToast('⚠️ יש להזין תיאור למשימה'); return; }

        const dateFormatted = date
            ? new Date(date).toLocaleDateString('he-IL')
            : new Date().toLocaleDateString('he-IL');

        const newTask = { text: title, date: dateFormatted, done: false };

        // שמור כמשימה כללית במסד
        if (!db.meta) db.meta = {};
        if (!db.meta.generalTasks) db.meta.generalTasks = [];
        db.meta.generalTasks.push(newTask);

        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: 'add_general_task', timestamp: new Date().toISOString(), payload: { text: title, date: dateFormatted } });
        storageSet(DATA_KEY, db);
        storageSet(OUTBOX_KEY, outbox);

        closeQuickTaskForm();
        renderTasks();
        showToast(`✅ משימה נשמרה: ${title}`);
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
    }


    // ==========================================
    // FFC Snap Sheet — Drag Logic
    // ==========================================
    let _ffcDragInitialized = false;

    function _initFFCDrag(sheet) {
        if (_ffcDragInitialized) return;
        _ffcDragInitialized = true;
        const handle = document.getElementById('ffc-drag-handle');
        if (!handle) return;

        let startY = 0, startH = 0, dragging = false;
        const snapPoints = [
            { cls: 'state-mini', vh: 35 },
            { cls: 'state-half', vh: 65 },
            { cls: 'state-full', vh: 95 }
        ];

        handle.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            startH = sheet.getBoundingClientRect().height;
            dragging = true;
            sheet.style.transition = 'none';
        }, { passive: true });

        handle.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const dy = startY - e.touches[0].clientY;
            const newH = Math.max(80, Math.min(window.innerHeight * 0.97, startH + dy));
            sheet.style.height = newH + 'px';
        }, { passive: true });

        handle.addEventListener('touchend', (e) => {
            if (!dragging) return;
            dragging = false;
            sheet.style.transition = '';
            sheet.style.height = '';

            const currentH = sheet.getBoundingClientRect().height;
            const vh = (currentH / window.innerHeight) * 100;

            // סגירה אם גוררים מאוד למטה
            if (vh < 18) {
                sheet.classList.remove('active');
                _ffcDragInitialized = false;
                return;
            }
            // מצא snap point קרוב
            let closest = snapPoints[0];
            let minDist = Infinity;
            snapPoints.forEach(p => {
                const dist = Math.abs(p.vh - vh);
                if (dist < minDist) { minDist = dist; closest = p; }
            });
            sheet.className = 'bottom-sheet snap-sheet active ' + closest.cls;
        });
    }

    function closeFFCSheet() {
        const sheet = document.getElementById('ffc-snap-sheet');
        if (sheet) { sheet.classList.remove('active'); _ffcDragInitialized = false; }
    }

    // ==========================================
    // Community List — Swipe Gestures
    // ==========================================
    let _commSwipeEl = null, _commSwipeStartX = 0, _commSwipeCurX = 0;

    function handleCommTouchStart(e) {
        _commSwipeEl = e.currentTarget;
        _commSwipeStartX = e.touches[0].clientX;
        _commSwipeCurX = _commSwipeStartX;
        _commSwipeEl.style.transition = 'none';
    }

    function handleCommTouchMove(e) {
        if (!_commSwipeEl) return;
        _commSwipeCurX = e.touches[0].clientX;
        const dx = _commSwipeCurX - _commSwipeStartX;
        // רק אם ברור שזו תנועה אופקית
        if (Math.abs(dx) > 8) {
            e.preventDefault();
            _commSwipeEl.style.transform = `translateX(${dx}px)`;
        }
    }

    function handleCommTouchEnd(e, phone, address) {
        if (!_commSwipeEl) return;
        const dx = _commSwipeCurX - _commSwipeStartX;
        _commSwipeEl.style.transition = 'transform 0.25s ease-out';
        _commSwipeEl.style.transform = 'translateX(0)';

        if (dx > 80 && phone) {
            // החלקה ימינה — התקשר
            setTimeout(() => { window.location.href = 'tel:' + phone.replace(/\D/g, ''); }, 200);
        } else if (dx < -80 && address) {
            // החלקה שמאלה — Waze
            const coords = (() => {
                const key = address;
                return db[key]?.info?.coords;
            })();
            if (coords) {
                setTimeout(() => window.open(`https://waze.com/ul?ll=${coords[1]},${coords[0]}&navigate=yes`, '_blank'), 200);
            } else {
                setTimeout(() => window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`, '_blank'), 200);
            }
        }
        _commSwipeEl = null;
    }


    // ==========================================
    // משימה 5: מכונת מצבים מרכזית לUI
    // ==========================================
    function updateAppUIState(state) {
        const navBar    = document.getElementById('f-bottom-nav-bar');
        const fabWrap   = document.getElementById('f-fab-wrapper');
        const fabBtn    = document.getElementById('super-fab-btn');
        const fabIcon   = document.getElementById('fab-icon');
        const syncW     = document.getElementById('sync-widget');
        const routeBar  = document.getElementById('route-builder-bar');

        // ניקוי classes קודמות
        if (fabBtn) { fabBtn.classList.remove('state-crm', 'state-route'); }

        switch (state) {
            case 'CRM':
                document.body.classList.remove('mission-active');
                if (navBar)  { navBar.style.display = 'flex'; navBar.style.transform = 'translateY(0)'; }
                if (fabWrap) { fabWrap.style.display = 'flex'; }
                if (syncW)   syncW.style.display    = 'flex';
                if (routeBar) routeBar.classList.remove('visible');
                if (fabBtn)  { fabBtn.classList.add('state-crm'); fabBtn.onclick = () => fieldApp.toggleActionSheet(); }
                if (fabIcon) fabIcon.innerHTML = '<i class="fas fa-plus"></i>';
                updateMapPadding();
                break;

            case 'ROUTE_BUILDER':
                if (navBar)  navBar.style.display  = 'flex';
                if (fabWrap) fabWrap.style.display  = 'flex';
                if (syncW)   syncW.style.display    = 'flex';
                if (routeBar) routeBar.classList.add('visible');
                if (fabBtn)  {
                    fabBtn.classList.add('state-route');
                    fabBtn.onclick = () => fieldApp.startCustomRoute();
                }
                if (fabIcon) fabIcon.innerHTML = '<i class="fas fa-check"></i>';
                updateMapPadding();
                break;

            case 'MISSION_ACTIVE':
                if (navBar)  { navBar.style.display = 'none'; navBar.style.transform = 'translateY(100%)'; }
                if (fabWrap) { fabWrap.style.display = 'none'; }
                if (syncW)   syncW.style.display    = 'none';
                if (routeBar) routeBar.classList.remove('visible');
                document.body.classList.add('mission-active');
                if (map) map.setPadding({ bottom: 0, top: 0 });
                break;
        }
    }

    // משימה 6: עדכון padding דינמי של המפה
    function updateMapPadding() {
        if (!map) return;
        const routeSheet = document.getElementById('route-sheet');
        const navH = 70; // bottom-nav-h
        let bottomPad = navH + 20;
        if (routeSheet && routeSheet.classList.contains('expanded')) {
            bottomPad = routeSheet.getBoundingClientRect().height + 20;
        }
        map.setPadding({ bottom: bottomPad, top: 0, left: 0, right: 0 });
    }


    // ==========================================
    // Speed Dial FAB
    // ==========================================
    let _speedDialOpen = false;

    function toggleSpeedDial() {
        _speedDialOpen = !_speedDialOpen;
        const dial = document.getElementById('speed-dial');
        const overlay = document.getElementById('speed-dial-overlay');
        const fabBtn = document.getElementById('super-fab-btn');
        if (dial) dial.classList.toggle('open', _speedDialOpen);
        if (overlay) overlay.style.display = _speedDialOpen ? 'block' : 'none';
        if (fabBtn) fabBtn.classList.toggle('dial-open', _speedDialOpen);
    }

    // ==========================================
    // Mission Planner — מתכנן מבצעים
    // ==========================================
    let mpSelectedStops = []; // { id, name, address, coords, type, taskText }

    function openMissionPlanner() {
        mpSelectedStops = [];
        const sheet = document.getElementById('mission-planner-sheet');
        openSheet(sheet.innerHTML, 'auto');
        mpSwitchTab('map');
        _mpUpdateBadge();
    }

    function mpSwitchTab(tab) {
        ['map','tasks','community','saved'].forEach(t => {
            const tabEl = document.getElementById('mp-tab-' + t);
            const contentEl = document.getElementById('mp-content-' + t);
            if (tabEl) tabEl.className = 'mp-tab' + (t === tab ? ' mp-tab-active' : '');
            if (contentEl) contentEl.style.display = t === tab ? 'block' : 'none';
        });
        if (tab === 'tasks') _mpRenderTasks();
        if (tab === 'community') _mpRenderCommunity();
        if (tab === 'saved') _mpRenderSaved();
    }

    function _mpRenderTasks() {
        const list = document.getElementById('mp-tasks-list');
        if (!list) return;
        let tasks = [];
        Object.keys(db).forEach(bldg => {
            if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            (db[bldg].apts || []).forEach(apt => {
                (apt.tasks || []).filter(t => !t.done).forEach(task => {
                    tasks.push({ id: bldg + '_' + task.text, name: bldg, address: bldg, taskText: task.text, coords: db[bldg].info?.coords, type: 'task' });
                });
            });
        });
        (db?.meta?.generalTasks || []).filter(t => !t.done).forEach(task => {
            tasks.push({ id: 'gen_' + task.text, name: task.text, address: '', taskText: task.text, coords: null, type: 'general' });
        });

        if (tasks.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">אין משימות פתוחות</div>';
            return;
        }
        list.innerHTML = tasks.map(t => {
            const sel = mpSelectedStops.find(s => s.id === t.id);
            return `<div class="mp-select-item ${sel ? 'selected' : ''}" onclick="fieldApp._mpToggleStop(${JSON.stringify(t).replace(/"/g,"'")})">
                <div class="mp-check">${sel ? '<i class="fas fa-check" style="font-size:12px;"></i>' : ''}</div>
                <div style="flex:1;">
                    <div style="font-weight:700; font-size:14px;">${escapeHTML(t.taskText)}</div>
                    ${t.address ? `<div style="font-size:12px; color:var(--text-muted);">${escapeHTML(t.address)}</div>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    function _mpRenderCommunity() {
        const list = document.getElementById('mp-community-list');
        if (!list) return;
        let fams = [];
        Object.keys(db).forEach(bldg => {
            if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            (db[bldg].apts || []).forEach((apt, idx) => {
                fams.push({ id: bldg + '_apt_' + idx, name: 'משפחת ' + (apt.name || 'ללא שם'), address: bldg, coords: db[bldg].info?.coords, type: 'family' });
            });
        });
        if (fams.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">אין משפחות</div>';
            return;
        }
        list.innerHTML = fams.map(f => {
            const sel = mpSelectedStops.find(s => s.id === f.id);
            return `<div class="mp-select-item ${sel ? 'selected' : ''}" onclick="fieldApp._mpToggleStop(${JSON.stringify(f).replace(/"/g,"'")})">
                <div class="mp-check">${sel ? '<i class="fas fa-check" style="font-size:12px;"></i>' : ''}</div>
                <div style="flex:1;">
                    <div style="font-weight:700; font-size:14px;">${escapeHTML(f.name)}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${escapeHTML(f.address)}</div>
                </div>
            </div>`;
        }).join('');
    }

    function _mpRenderSaved() {
        const list = document.getElementById('mp-saved-list');
        if (!list) return;
        const saved = storageGet('saved_routes') ? JSON.parse(storageGet('saved_routes')) : [];
        const history = storageGet('route_history') ? JSON.parse(storageGet('route_history')) : [];

        let html = '';
        if (saved.length === 0 && history.length === 0) {
            html = '<div style="text-align:center; padding:20px; color:var(--text-muted);">אין מסלולים שמורים</div>';
        }
        saved.forEach(r => {
            html += `<div class="mp-select-item" onclick="fieldApp._mpLoadSaved('${r.id}')">
                <div style="font-size:22px;">📌</div>
                <div style="flex:1;">
                    <div style="font-weight:700; font-size:14px;">${escapeHTML(r.name)}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${r.stops?.length || 0} תחנות</div>
                </div>
                <button onclick="event.stopPropagation(); fieldApp._mpLoadSaved('${r.id}')" style="padding:8px 14px; background:var(--accent); color:white; border:none; border-radius:10px; font-weight:700; cursor:pointer; font-size:13px;">הפעל</button>
            </div>`;
        });
        history.slice(-5).reverse().forEach(r => {
            html += `<div class="mp-select-item" style="opacity:0.7;" onclick="fieldApp._mpLoadSaved('${r.id}')">
                <div style="font-size:22px;">🕐</div>
                <div style="flex:1;">
                    <div style="font-weight:700; font-size:14px;">${escapeHTML(r.name || 'מסלול ' + new Date(r.date).toLocaleDateString('he-IL'))}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${r.stops?.length || 0} תחנות · היסטוריה</div>
                </div>
            </div>`;
        });
        list.innerHTML = html;
    }

    function _mpToggleStop(stop) {
        const idx = mpSelectedStops.findIndex(s => s.id === stop.id);
        if (idx > -1) mpSelectedStops.splice(idx, 1);
        else mpSelectedStops.push(stop);
        _mpUpdateBadge();
        // רנדר מחדש את הלשונית הפעילה
        const activeTab = document.querySelector('.mp-tab-active');
        if (activeTab) {
            const t = activeTab.id.replace('mp-tab-','');
            if (t === 'tasks') _mpRenderTasks();
            if (t === 'community') _mpRenderCommunity();
        }
    }

    function _mpUpdateBadge() {
        const badge = document.getElementById('mp-stop-count-badge');
        const countEl = document.getElementById('mp-stop-count');
        const createBtn = document.getElementById('mp-create-btn');
        const createCount = document.getElementById('mp-create-count');
        const n = mpSelectedStops.length;
        if (badge) badge.style.display = n > 0 ? 'block' : 'none';
        if (countEl) countEl.innerText = n;
        if (createBtn) createBtn.style.display = n > 0 ? 'block' : 'none';
        if (createCount) createCount.innerText = n;
    }

    function _mpLoadSaved(id) {
        const saved = storageGet('saved_routes') ? JSON.parse(storageGet('saved_routes')) : [];
        const route = saved.find(r => r.id === id);
        if (!route || !route.stops) return;
        mpSelectedStops = route.stops;
        _openRouteEditor(route.name);
    }

    function activateMapPickMode() {
        switchView('map', document.querySelector('.nav-item'));
        showToast('לחץ לחיצה ארוכה על בניין להוספה למסלול', 3000);
        isRouteBuilderMode = true;
        updateAppUIState('ROUTE_BUILDER');
    }

    function createRouteFromPlanner() {
        if (mpSelectedStops.length === 0) { showToast('בחר לפחות תחנה אחת'); return; }
        _openRouteEditor('מסלול חדש');
    }

    function _openRouteEditor(name) {
        closeOverlays();
        const sheet = document.getElementById('route-edit-sheet');
        sheet.style.display = 'block';
        document.getElementById('re-route-name').value = name || '';
        _reRenderStops();
        openSheet(sheet.innerHTML, 'full');
        sheet.style.display = 'none';
    }

    function _reRenderStops() {
        const list = document.getElementById('re-stops-list');
        if (!list) return;
        list.innerHTML = mpSelectedStops.map((s, idx) => `
            <div class="route-editor-item" draggable="true"
                ondragstart="fieldApp.handleRouteDragStart(event, ${idx})"
                ondragover="event.preventDefault()"
                ondrop="fieldApp.handleRouteDrop(event, ${idx})">
                <div class="drag-handle"><i class="fas fa-grip-lines"></i></div>
                <div class="content" style="flex:1;">
                    <div style="font-weight:700; font-size:14px;">
                        <span style="color:var(--warning); margin-left:4px;">${idx+1}.</span>
                        ${escapeHTML(s.name)}
                    </div>
                    ${s.taskText ? `<div style="font-size:12px; color:var(--text-muted);">${escapeHTML(s.taskText)}</div>` : ''}
                </div>
                <button onclick="fieldApp._reRemoveStop(${idx})" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:6px;"><i class="fas fa-times"></i></button>
            </div>
        `).join('');
    }

    function _reRemoveStop(idx) {
        mpSelectedStops.splice(idx, 1);
        _reRenderStops();
    }

    function startRouteFromEditor() {
        const name = document.getElementById('re-route-name')?.value || 'מסלול חדש';
        if (mpSelectedStops.length === 0) { showToast('אין תחנות במסלול'); return; }

        // שמור היסטוריה
        const history = storageGet('route_history') ? JSON.parse(storageGet('route_history')) : [];
        history.push({ id: Date.now().toString(), name, date: Date.now(), stops: mpSelectedStops });
        storageSet('route_history', JSON.stringify(history.slice(-20)));

        const waypoints = mpSelectedStops.filter(s => s.coords).map(s => s.coords);
        if (waypoints.length === 0) { showToast('אין תחנות עם מיקום'); return; }

        closeOverlays();
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => { drawMultiStopRoute([pos.coords.longitude, pos.coords.latitude], waypoints); startMissionMode(waypoints); },
                () => { drawMultiStopRoute(db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928], waypoints); startMissionMode(waypoints); }
            );
        } else {
            drawMultiStopRoute(db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928], waypoints);
            startMissionMode(waypoints);
        }
    }


    // כרטיס בניין ריק — בניין שלא קיים במאגר
    function openEmptyBuildingCard(addr, coords) {
        if (!db[addr]) {
            db[addr] = { info: { coords: coords || null, code: '', rep: '', notes: '' }, apts: [] };
        }
        openBuildingCard(addr, false);
    }

    // כרטיס משפחה מינימלי (מתוך כרטיס בניין)
    function openFamilyCardMini(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        const fam = db[bldg]?.apts[aptIdx];
        if (!fam) return;

        const phone = fam.phone || fam.fatherPhone || fam.motherPhone || '';
        const waLink = phone ? `https://wa.me/${phone.replace(/\D/g,'').replace(/^0/,'972')}` : '#';
        const disableStyle = !phone ? 'opacity:0.4; pointer-events:none;' : '';

        let html = `<button class="sheet-close-btn" onclick="fieldApp.openBuildingCard('${bldg}')"><i class="fas fa-arrow-right"></i></button>`;
        html += `<div style="padding-right:36px; margin-bottom:16px;">
            <div style="font-weight:800; font-size:22px;">משפחת ${escapeHTML(fam.name || 'ללא שם')}</div>
            ${fam.num ? `<div style="color:var(--text-muted); font-size:13px;">דירה ${escapeHTML(String(fam.num))}</div>` : ''}
        </div>`;

        // פרטי קשר מהירים
        html += `<div style="display:flex; gap:10px; margin-bottom:16px;">
            <button style="flex:1; padding:13px; background:rgba(16,185,129,0.1); color:var(--success); border:1px solid var(--success); border-radius:12px; font-weight:700; cursor:pointer; font-family:inherit; ${disableStyle}"
                onclick="fieldApp.callFamilyNumber('${phone}')"><i class="fas fa-phone"></i> חייג</button>
            <button style="flex:1; padding:13px; background:rgba(37,196,103,0.1); color:#25D366; border:1px solid #25D366; border-radius:12px; font-weight:700; cursor:pointer; font-family:inherit; ${disableStyle}"
                onclick="window.open('${waLink}','_blank')"><i class="fab fa-whatsapp"></i> וואטסאפ</button>
            <button style="flex:1; padding:13px; background:rgba(37,99,235,0.1); color:var(--accent); border:1px solid var(--accent); border-radius:12px; font-weight:700; cursor:pointer; font-family:inherit;"
                onclick="fieldApp.openFullFamilyCard('${bldgEnc}', ${aptIdx})"><i class="fas fa-id-card"></i> כרטיס מלא</button>
        </div>`;

        // משימות פתוחות
        const tasks = (fam.tasks || []).filter(t => !t.done);
        if (tasks.length > 0) {
            html += `<div style="font-weight:700; font-size:14px; margin-bottom:8px; color:var(--text-muted);">משימות פתוחות</div>`;
            html += tasks.map((t, i) => `
                <div style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--bg-body); border-radius:10px; margin-bottom:6px;">
                    <button onclick="fieldApp._quickDoneTask('${bldgEnc}',${aptIdx},${i})" style="width:24px;height:24px;border-radius:50%;border:2px solid var(--border-light);background:white;cursor:pointer;flex-shrink:0;"></button>
                    <span style="font-size:14px;">${escapeHTML(t.text)}</span>
                </div>`).join('');
        }

        openSheet(html, 'auto');
    }

    function _quickDoneTask(bldgEnc, aptIdx, taskIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        if (db[bldg]?.apts[aptIdx]?.tasks[taskIdx]) {
            db[bldg].apts[aptIdx].tasks[taskIdx].done = true;
            storageSet(DATA_KEY, db);
            showToast('✅ משימה הושלמה');
            openFamilyCardMini(bldgEnc, aptIdx);
            if (navigator.vibrate) navigator.vibrate(30);
        }
    }


    // ==========================================
    // חיפוש גלובלי
    // ==========================================
    let _searchTimeout = null;

    function globalSearch(query) {
        const clearBtn = document.getElementById('global-search-clear');
        const results = document.getElementById('global-search-results');
        if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

        clearTimeout(_searchTimeout);
        if (!query || query.length < 2) {
            if (results) results.style.display = 'none';
            return;
        }

        // הצג "מחפש..." מיידית
        if (results) {
            results.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:13px;"><i class="fas fa-spinner fa-spin" style="margin-left:8px;"></i>מחפש...</div>';
            results.style.display = 'block';
        }

        _searchTimeout = setTimeout(() => _runGlobalSearch(query), 350);
    }

    function globalSearchFocus() {
        const input = document.getElementById('global-search-input');
        const results = document.getElementById('global-search-results');
        if (input?.value?.length >= 2 && results) results.style.display = 'block';
    }

    function globalSearchClear() {
        const input = document.getElementById('global-search-input');
        const results = document.getElementById('global-search-results');
        const clearBtn = document.getElementById('global-search-clear');
        if (input) input.value = '';
        if (results) results.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        input?.blur();
    }

    async function _runGlobalSearch(query) {
        if (!db) return;
        const q = query.trim().toLowerCase();
        const hits = [];

        // סריקת כל הבניינים והמשפחות
        Object.keys(db).forEach(bldg => {
            if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;

            // התאמת כתובת בניין
            if (bldg.toLowerCase().includes(q)) {
                hits.push({
                    type: 'building', icon: 'fas fa-building', iconBg: 'rgba(37,99,235,0.1)', iconColor: 'var(--accent)',
                    title: bldg, sub: `${(db[bldg].apts||[]).length} משפחות`,
                    typeLabel: 'בניין',
                    action: () => openBuildingCard(bldg, false)
                });
            }

            // משפחות
            (db[bldg].apts || []).forEach((apt, aptIdx) => {
                const name = (apt.name || '').toLowerCase();
                const father = (apt.father || apt.fatherName || '').toLowerCase();
                const mother = (apt.mother || apt.motherName || '').toLowerCase();
                const phone = (apt.phone || apt.fatherPhone || '').toLowerCase();

                if (name.includes(q) || father.includes(q) || mother.includes(q) || phone.includes(q)) {
                    hits.push({
                        type: 'family', icon: 'fas fa-users', iconBg: 'rgba(16,185,129,0.1)', iconColor: 'var(--success)',
                        title: 'משפחת ' + (apt.name || 'ללא שם'),
                        sub: bldg + (apt.num ? ' דירה ' + apt.num : ''),
                        typeLabel: 'משפחה',
                        action: () => {
                            openBuildingCard(bldg, false);
                            setTimeout(() => openFamilyCardMini(encodeURIComponent(bldg), aptIdx), 400);
                        }
                    });
                }

                // משימות
                (apt.tasks || []).filter(t => !t.done).forEach(task => {
                    if ((task.text||'').toLowerCase().includes(q)) {
                        hits.push({
                            type: 'task', icon: 'fas fa-check-circle', iconBg: 'rgba(245,158,11,0.1)', iconColor: 'var(--warning)',
                            title: task.text, sub: 'משפחת ' + (apt.name||'') + ' · ' + bldg,
                            typeLabel: 'משימה',
                            action: () => {
                                switchView('tasks', document.querySelectorAll('.nav-item')[1]);
                                const taskInput = document.getElementById('f-task-search');
                                if (taskInput) { taskInput.value = task.text; renderTasks(); }
                                globalSearchClear();
                            }
                        });
                    }
                });
            });
        });

        // משימות כלליות
        (db?.meta?.generalTasks || []).filter(t => !t.done).forEach(task => {
            if ((task.text||'').toLowerCase().includes(q)) {
                hits.push({
                    type: 'task', icon: 'fas fa-tasks', iconBg: 'rgba(245,158,11,0.1)', iconColor: 'var(--warning)',
                    title: task.text, sub: 'משימה כללית',
                    typeLabel: 'משימה',
                    action: () => {
                        switchView('tasks', document.querySelectorAll('.nav-item')[1]);
                        globalSearchClear();
                    }
                });
            }
        });

        // חיפוש כתובות מאומתות מ-Mapbox (אם יש פחות מ-5 תוצאות מקומיות)
        if (q.length >= 3) {
            try {
                const token = mapboxgl.accessToken;
                const center = map ? map.getCenter() : { lng: 35.2, lat: 31.8 };
                const res = await fetch(
                    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?` +
                    `access_token=${token}&language=he&country=il&types=address,place&proximity=${center.lng},${center.lat}&limit=4`
                );
                const data = await res.json();
                (data.features || []).forEach(f => {
                    const addr = (f.place_name_he || f.place_name).split(',').slice(0,2).join(',').trim();
                    const coords = f.center; // [lng, lat]
                    // אל תוסיף כפילויות עם תוצאות מקומיות
                    const alreadyExists = hits.some(h => h.title === addr || h.title.includes(addr.split(' ')[0]));
                    hits.push({
                        type: 'address',
                        icon: 'fas fa-map-marker-alt',
                        iconBg: 'rgba(239,68,68,0.1)',
                        iconColor: 'var(--danger)',
                        title: addr,
                        sub: (f.place_name_he || f.place_name).split(',').slice(2).join(',').trim() || 'כתובת',
                        typeLabel: 'כתובת',
                        coords,
                        action: () => {
                            if (map) {
                                map.flyTo({ center: coords, zoom: 18, pitch: 60, duration: 1200 });
                                switchView('map', document.querySelector('.nav-item'));
                                // פתח כרטיס בניין (ריק אם לא קיים)
                                setTimeout(() => {
                                    // חפש אם יש בניין קרוב במסד
                                    let matchedKey = null;
                                    let minDist = 0.0005;
                                    Object.keys(db).forEach(key => {
                                        if (key === '__BOARDS__' || key === '__SETTINGS__' || key === 'meta') return;
                                        const c = db[key].info?.coords;
                                        if (!c) return;
                                        const dist = Math.sqrt(Math.pow(c[0]-coords[0],2) + Math.pow(c[1]-coords[1],2));
                                        if (dist < minDist) { minDist = dist; matchedKey = key; }
                                    });
                                    if (matchedKey) openBuildingCard(matchedKey, false);
                                    else openEmptyBuildingCard(addr, coords);
                                }, 1300);
                            }
                        }
                    });
                });
            } catch(e) { console.log('Geocoding search failed', e); }
        }

        _renderSearchResults(hits.slice(0, 12));
    }

    function _renderSearchResults(hits) {
        const results = document.getElementById('global-search-results');
        if (!results) return;

        if (hits.length === 0) {
            results.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:14px;">לא נמצאו תוצאות</div>';
            results.style.display = 'block';
            return;
        }

        results.innerHTML = hits.map((h, i) => `
            <div class="search-result-item" onclick="fieldApp._searchHitAction(${i})">
                <div class="search-result-icon" style="background:${h.iconBg}; color:${h.iconColor};">
                    <i class="${h.icon}"></i>
                </div>
                <div style="flex:1; min-width:0;">
                    <div class="search-result-title">${escapeHTML(h.title)}</div>
                    <div class="search-result-sub">${escapeHTML(h.sub)}</div>
                </div>
                <div class="search-result-type">${h.typeLabel}</div>
            </div>
        `).join('');
        results.style.display = 'block';

        // שמור actions
        window._searchHits = hits;
    }

    function _searchHitAction(idx) {
        const hit = window._searchHits?.[idx];
        if (!hit) return;
        globalSearchClear();
        setTimeout(() => hit.action(), 100);
    }

    // סגור תוצאות בלחיצה על המסך
    document.addEventListener('click', (e) => {
        const bar = document.getElementById('global-search-bar');
        if (bar && !bar.contains(e.target)) {
            const results = document.getElementById('global-search-results');
            if (results) results.style.display = 'none';
        }
    });


    // ==========================================
    // סנכרון אנשי קשר (Android Contact Picker API)
    // ==========================================
    let _contactMatches = []; // התאמות שנמצאו

    async function scanContacts(isManual = false) {
        if (!('contacts' in navigator && 'ContactsManager' in window)) {
            if (isManual) showToast('אנשי קשר אינם נתמכים בדפדפן זה');
            return;
        }
        const dismissed = storageGet('contacts_scan_dismissed');
        if (dismissed && !isManual) {
            const daysSince = (Date.now() - parseInt(dismissed)) / (1000*60*60*24);
            if (daysSince < 7) return;
        }
        try {
            const props = ['name', 'tel', 'email'];
            const opts = { multiple: true };
            showToast('📱 בחר אנשי קשר לסריקה...');
            const contacts = await navigator.contacts.select(props, opts);
            if (!contacts || contacts.length === 0) return;
            _processContactMatches(contacts);
        } catch(e) {
            if (e.name !== 'AbortError') showToast('שגיאה בגישה לאנשי קשר');
        }
    }

    // חיפוש איש קשר לפי שם משפחה ספציפי
    async function searchContactForFamily(bldgEnc, aptIdx) {
        if (!('contacts' in navigator && 'ContactsManager' in window)) {
            showToast('אנשי קשר אינם נתמכים בדפדפן זה');
            return;
        }
        const bldg = decodeURIComponent(bldgEnc);
        const apt = db[bldg]?.apts[aptIdx];
        if (!apt) return;

        try {
            const props = ['name', 'tel', 'email'];
            const opts = { multiple: false };
            showToast(`📱 חפש איש קשר עבור משפחת ${apt.name || ''}...`);
            const contacts = await navigator.contacts.select(props, opts);
            if (!contacts || contacts.length === 0) return;
            // עבד כאחד
            _processContactMatches(contacts);
        } catch(e) {
            if (e.name !== 'AbortError') showToast('שגיאה');
        }
    }

    function _processContactMatches(contacts) {
        _contactMatches = [];
        const ignored = storageGet('contacts_ignored') || [];

        contacts.forEach(contact => {
            const contactFullName = (contact.name?.[0] || '').trim();
            // דלג על אנשי קשר שסומנו "לעולם לא"
            if (ignored.includes(contactFullName)) return;
            const contactNameLower = contactFullName.toLowerCase();
            if (!contactNameLower) return;

            const contactPhone = contact.tel?.[0] || '';
            const contactEmail = contact.email?.[0] || '';

            Object.keys(db).forEach(bldg => {
                if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
                (db[bldg].apts || []).forEach((apt, aptIdx) => {
                    const famName    = (apt.name || '').toLowerCase();
                    const fatherName = (apt.father || apt.fatherName || '').toLowerCase();
                    const motherName = (apt.mother || apt.motherName || '').toLowerCase();
                    const children   = (apt.childrenList || []).map(c => (c.name||'').toLowerCase()).filter(Boolean);

                    // התאמה ראשונית לפי שם משפחה
                    const familyMatch = famName && (
                        contactNameLower.includes(famName) || famName.includes(contactNameLower.split(' ').pop())
                    );
                    // התאמה לפי שם פרטי
                    const fatherMatch = fatherName && contactNameLower.includes(fatherName);
                    const motherMatch = motherName && contactNameLower.includes(motherName);
                    const childMatch  = children.find(c => c && contactNameLower.includes(c));

                    if (!familyMatch && !fatherMatch && !motherMatch && !childMatch) return;

                    const updates = [];

                    if (contactPhone) {
                        const existingFatherPhone = apt.fatherPhone || '';
                        const existingMotherPhone = apt.motherPhone || '';
                        const existingPhone       = apt.phone || '';

                        // קבע שיוך טלפון
                        let attribution = null; // 'father' | 'mother' | 'child:X' | 'ask'

                        if (fatherMatch) {
                            attribution = 'father';
                        } else if (motherMatch) {
                            attribution = 'mother';
                        } else if (childMatch) {
                            attribution = 'child:' + childMatch;
                        } else if (familyMatch) {
                            // שם משפחה בלבד — נסה להסיק מהמייל
                            if (contactEmail && apt.fatherEmail && contactEmail === apt.fatherEmail) {
                                attribution = 'father';
                            } else if (contactEmail && apt.motherEmail && contactEmail === apt.motherEmail) {
                                attribution = 'mother';
                            } else {
                                attribution = 'ask'; // צריך לשאול
                            }
                        }

                        // בדוק אם הטלפון חדש
                        const isNewForFather = attribution === 'father' && contactPhone !== existingFatherPhone;
                        const isNewForMother = attribution === 'mother' && contactPhone !== existingMotherPhone;
                        const isNew          = !existingFatherPhone && !existingMotherPhone && !existingPhone;

                        if (attribution === 'ask' || isNewForFather || isNewForMother || isNew) {
                            updates.push({
                                field: 'phone',
                                label: 'טלפון',
                                value: contactPhone,
                                icon: 'fas fa-phone',
                                color: 'var(--success)',
                                attribution,
                                apt,
                                // לתצוגה
                                attributionLabel: attribution === 'father' ? `לאב · ${apt.father || apt.fatherName || ''}` :
                                                  attribution === 'mother' ? `לאם · ${apt.mother || apt.motherName || ''}` :
                                                  attribution?.startsWith('child:') ? `לילד · ${childMatch}` :
                                                  'לא ברור — יש לשייך'
                            });
                        }
                    }

                    if (contactEmail && !apt.email && !apt.fatherEmail && !apt.motherEmail) {
                        let attribution = 'ask';
                        if (fatherMatch) attribution = 'father';
                        else if (motherMatch) attribution = 'mother';

                        updates.push({
                            field: 'email',
                            label: 'מייל',
                            value: contactEmail,
                            icon: 'fas fa-envelope',
                            color: 'var(--accent)',
                            attribution,
                            attributionLabel: attribution === 'father' ? `לאב · ${apt.father || apt.fatherName || ''}` :
                                              attribution === 'mother' ? `לאם · ${apt.mother || apt.motherName || ''}` :
                                              'לא ברור — יש לשייך'
                        });
                    }

                    if (updates.length > 0) {
                        _contactMatches.push({
                            bldg, aptIdx, apt,
                            contactName: contactFullName,
                            updates
                        });
                    }
                });
            });
        });

        if (_contactMatches.length === 0) {
            showToast('✅ לא נמצאו נתונים חדשים לעדכון');
            return;
        }

        _showContactsModal();
    }

    function _showContactsModal() {
        const modal = document.getElementById('contacts-sync-modal');
        const list = document.getElementById('contacts-matches-list');
        const count = document.getElementById('contacts-match-count');
        if (!modal || !list) return;

        count.innerText = `נמצאו ${_contactMatches.length} משפחות עם מידע חדש`;

        list.innerHTML = _contactMatches.map((m, mIdx) => `
            <div style="background:var(--bg-body); border-radius:16px; padding:14px; border:1px solid var(--border-light);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                    <div style="font-weight:800; font-size:15px;">
                        <i class="fas fa-users" style="color:var(--accent); margin-left:6px;"></i>
                        משפחת ${escapeHTML(m.apt.name || 'ללא שם')}
                        <span style="font-size:12px; color:var(--text-muted); font-weight:400;"> · ${escapeHTML(m.bldg)}</span>
                    </div>
                    <button onclick="fieldApp.neverSuggestContact('${escapeHTML(m.contactName)}')"
                        title="לעולם לא להציע"
                        style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:12px; padding:4px 8px; border-radius:8px; white-space:nowrap; flex-shrink:0;">
                        <i class="fas fa-ban"></i> לעולם לא
                    </button>
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
                    מאיש הקשר: ${escapeHTML(m.contactName)}
                </div>
                ${m.updates.map((u, uIdx) => `
                    <div style="background:var(--surface); border-radius:12px; margin-bottom:8px; border:1px solid var(--border-light); overflow:hidden;">
                        <div style="display:flex; align-items:center; gap:10px; padding:10px 12px;">
                            <i class="${u.icon}" style="color:${u.color}; width:16px;"></i>
                            <div style="flex:1;">
                                <div style="font-size:11px; color:var(--text-muted);">${u.label}</div>
                                <div style="font-weight:700; font-size:14px;" dir="ltr">${escapeHTML(u.value)}</div>
                            </div>
                            ${u.attribution !== 'ask' ? `
                                <button onclick="fieldApp._approveContactUpdate(${mIdx}, ${uIdx}, this)"
                                    style="padding:6px 14px; background:rgba(16,185,129,0.1); color:var(--success); border:1px solid var(--success); border-radius:8px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit;">
                                    שמור
                                </button>
                            ` : ''}
                        </div>
                        <!-- שיוך -->
                        <div style="padding:6px 12px 10px; border-top:1px solid var(--border-light);">
                            ${u.attribution !== 'ask' ? `
                                <div style="font-size:12px; color:var(--text-muted);">
                                    <i class="fas fa-tag" style="margin-left:4px;"></i>
                                    ${escapeHTML(u.attributionLabel)}
                                </div>
                            ` : `
                                <div style="font-size:12px; color:var(--warning); margin-bottom:8px; font-weight:600;">
                                    <i class="fas fa-question-circle" style="margin-left:4px;"></i>
                                    למי לשייך את הטלפון?
                                </div>
                                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                    ${m.apt.father || m.apt.fatherName ? `
                                        <button onclick="fieldApp._assignAndApprove(${mIdx}, ${uIdx}, 'father', this)"
                                            style="padding:6px 12px; background:rgba(37,99,235,0.1); color:var(--accent); border:1px solid var(--accent); border-radius:8px; font-weight:700; cursor:pointer; font-size:12px; font-family:inherit;">
                                            👨 ${escapeHTML(m.apt.father || m.apt.fatherName)}
                                        </button>
                                    ` : ''}
                                    ${m.apt.mother || m.apt.motherName ? `
                                        <button onclick="fieldApp._assignAndApprove(${mIdx}, ${uIdx}, 'mother', this)"
                                            style="padding:6px 12px; background:rgba(245,158,11,0.1); color:var(--warning); border:1px solid var(--warning); border-radius:8px; font-weight:700; cursor:pointer; font-size:12px; font-family:inherit;">
                                            👩 ${escapeHTML(m.apt.mother || m.apt.motherName)}
                                        </button>
                                    ` : ''}
                                    ${(m.apt.childrenList||[]).slice(0,3).map(child => `
                                        <button onclick="fieldApp._assignAndApprove(${mIdx}, ${uIdx}, 'child:${escapeHTML(child.name||'')}', this)"
                                            style="padding:6px 12px; background:rgba(16,185,129,0.1); color:var(--success); border:1px solid var(--success); border-radius:8px; font-weight:700; cursor:pointer; font-size:12px; font-family:inherit;">
                                            👦 ${escapeHTML(child.name||'')}
                                        </button>
                                    `).join('')}
                                    <button onclick="fieldApp._assignAndApprove(${mIdx}, ${uIdx}, 'general', this)"
                                        style="padding:6px 12px; background:var(--bg-body); color:var(--text-muted); border:1px solid var(--border-light); border-radius:8px; font-weight:700; cursor:pointer; font-size:12px; font-family:inherit;">
                                        כללי
                                    </button>
                                </div>
                            `}
                        </div>
                    </div>
                `).join('')}
            </div>
        `).join('');

        modal.style.display = 'flex';
        if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    }

    function _approveContactUpdate(matchIdx, updateIdx, btn) {
        const match = _contactMatches[matchIdx];
        if (!match) return;
        const update = match.updates[updateIdx];
        if (!update) return;
        _saveContactField(match, update, update.attribution || 'general');
        // עדכון ויזואלי
        if (btn) {
            btn.innerHTML = '<i class="fas fa-check"></i> נשמר';
            btn.style.background = 'var(--success)';
            btn.style.color = 'white';
            btn.style.borderColor = 'var(--success)';
            btn.disabled = true;
        }
        if (navigator.vibrate) navigator.vibrate(20);
    }

    function _assignAndApprove(matchIdx, updateIdx, attribution, btn) {
        const match = _contactMatches[matchIdx];
        if (!match) return;
        const update = match.updates[updateIdx];
        if (!update) return;
        update.attribution = attribution;
        _saveContactField(match, update, attribution);
        // עדכן ויזואלי — הסתר כפתורי בחירה והצג "נשמר"
        const container = btn?.closest('[style*="border-top"]');
        if (container) {
            container.innerHTML = `<div style="padding:8px 12px; font-size:12px; color:var(--success); font-weight:700;">
                <i class="fas fa-check"></i> נשמר עבור ${attribution === 'father' ? 'האב' : attribution === 'mother' ? 'האם' : attribution.startsWith('child:') ? 'הילד' : 'כללי'}
            </div>`;
        }
        if (navigator.vibrate) navigator.vibrate(20);
    }

    function _saveContactField(match, update, attribution) {
        const apt = db[match.bldg].apts[match.aptIdx];
        if (!apt) return;

        if (update.field === 'phone' || update.field === 'phone2') {
            if (attribution === 'father')        apt.fatherPhone = update.value;
            else if (attribution === 'mother')   apt.motherPhone = update.value;
            else if (attribution?.startsWith('child:')) {
                const childName = attribution.replace('child:', '');
                const child = (apt.childrenList || []).find(c => c.name === childName);
                if (child) child.phone = update.value;
            } else {
                apt.phone = update.value; // כללי — לשדה הראשי
            }
        }

        if (update.field === 'email') {
            if (attribution === 'father')       apt.fatherEmail = update.value;
            else if (attribution === 'mother')  apt.motherEmail = update.value;
            else                                apt.email = update.value;
        }

        storageSet(DATA_KEY, db);
        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({
            type: 'contact_update',
            bldg: match.bldg,
            aptIdx: match.aptIdx,
            field: update.field,
            value: update.value,
            attribution,
            timestamp: new Date().toISOString()
        });
        storageSet(OUTBOX_KEY, outbox);
    }

    function approveAllContacts() {
        _contactMatches.forEach((match, mIdx) => {
            match.updates.forEach((update, uIdx) => {
                const btn = document.querySelector(`[onclick*="_approveContactUpdate(${mIdx}, ${uIdx}"]`);
                if (!btn?.disabled) _approveContactUpdate(mIdx, uIdx, btn || document.createElement('button'));
            });
        });
        setTimeout(() => closeContactsSync(), 500);
        showToast('✅ כל הנתונים עודכנו!');
    }

    function closeContactsSync() {
        const modal = document.getElementById('contacts-sync-modal');
        if (modal) modal.style.display = 'none';
        storageSet('contacts_scan_dismissed', Date.now().toString());
    }

    function neverSuggestContact(contactName) {
        const ignored = storageGet('contacts_ignored') || [];
        if (!ignored.includes(contactName)) ignored.push(contactName);
        storageSet('contacts_ignored', ignored);
        // הסר מהרשימה הנוכחית ורנדר מחדש
        _contactMatches = _contactMatches.filter(m => m.contactName !== contactName);
        if (_contactMatches.length === 0) {
            closeContactsSync();
            showToast('✅ הסתיר את איש הקשר');
        } else {
            _showContactsModal();
        }
    }

    // ==========================================
    // חשיפת הפונקציות החוצה
    // ==========================================
    return { 
        init, login, switchView, toggleFab, toggleActionSheet, toggleSyncDetails, closeOverlays, openRouteMenu, buildRoute, openFamilyForm, saveFamilyForm,
        updateAppUIState, updateMapPadding,
        toggleSpeedDial, openMissionPlanner, mpSwitchTab, _mpToggleStop, _mpLoadSaved, activateMapPickMode, createRouteFromPlanner, _reRemoveStop, startRouteFromEditor,
        globalSearch, globalSearchFocus, globalSearchClear, _searchHitAction,
        scanContacts, closeContactsSync, approveAllContacts, _approveContactUpdate, _assignAndApprove, neverSuggestContact, searchContactForFamily,
        openAddTask, saveNewTask, openBuildingCard, openFamilyCard, openArrivalSheet: openArrivalSheetEncoded,
        openVoiceSummary, toggleVoiceRecording, saveVisitLog, confirmAutoTask, jumpToCenter, recenter,
        callFamilyNumber, toggleDarkMode, toggleMapStyle, forceSync, openExternalNav, searchAddressInput, selectAddressOption,
        toggleTargetForRoute, startCustomRoute, saveQuickTask, showToast,
        finishMission, pauseMission, refreshMissionRoute, markAllDoneInBuilding, openCurrentMissionCard, saveRoute, loadSavedRoutes,
        deleteSavedRoute, toggleTaskLayer, completeMissionTask, switchMissionTab, nextMissionTarget, prevMissionTarget, _missionWaze,
        closeMissionSummary, buildRouteFromSaved, openSavedRoutesSheet, routeDialogGoNow, routeDialogSaveLater,
        toggleRouteBuilderMode, promptAddToRoute, openRouteEditor, moveRouteItem, removeRouteItem, saveAndStartEditedRoute,
        handleCardTouchStart, handleCardTouchEnd, addSingleToRoute, removeSingleFromRoute,
        autoSortRoute, handleRouteTouchStart, handleRouteTouchMove, handleRouteTouchEnd, handleRouteDragStart, handleRouteDrop, colorBuildingByCoords,
        toggleRouteSheet, addStopToRoute, removeStopFromRoute, renderRouteSheet, startActiveRoute, stopActiveRoute, renderActiveStop, openWaze, markStopDone,
        openQuickFamilyForm, closeQuickFamilyForm, expandToFullFamilyForm, saveQuickFamily,
        openQuickTaskForm, closeQuickTaskForm, expandToFullTaskForm, renderSmartChips, _selectChip, startTaskVoiceDictation, saveQuickTask,
        // *** פונקציות חדשות חשופות ***
        openFullImage, openFullFamilyCard, _ffcTab, _ffcRender, closeFFCSheet,
        handleCommTouchStart, handleCommTouchMove, handleCommTouchEnd,
        openEmptyBuildingCard, openFamilyCardMini, _quickDoneTask, skipMissionTarget,
        _ffcSaveDetails, _ffcDelete, _ffcAddTag, _ffcRemoveTag,
        _ffcAddChild, _ffcRemoveChild, _ffcUpdateChild,
        _ffcToggleTask, _ffcAddTask, _ffcDeleteTask,
        _ffcAddLog, _ffcDeleteLog,
        _ffcAddDonation, _ffcDeleteDonation,
        // *** מסך משימות מתקדם ***
        toggleViewAllTasks, toggleCompletedTasks, setTaskFilter, openTaskEdit, saveEditedTask,
        deleteCurrentTask, addEditTag, removeEditTag, toggleChipTag, onTagAtInput, onTagAtKey, selectDropdownTag,
        toggleVoiceSearch
    };
})();

window.addEventListener('DOMContentLoaded', () => fieldApp.init());
