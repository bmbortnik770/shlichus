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
        const el = document.getElementById('f-sync-status'); if(!el) return;
        const span = el.querySelector('span'); const icon = el.querySelector('i');
        el.className = 'f-sync-indicator'; 
        if (state === 'syncing') { el.classList.add('syncing'); icon.className = 'fas fa-sync-alt'; span.innerText = 'מסנכרן...'; } 
        else if (state === 'success') { el.classList.add('success'); icon.className = 'fas fa-check-circle'; const timeStr = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); span.innerText = `מעודכן ל- ${timeStr}`; localStorage.setItem(SYNC_TIME_KEY, timeStr); } 
        else if (state === 'offline' || state === 'error') { el.classList.add('offline'); icon.className = state === 'offline' ? 'fas fa-wifi-slash' : 'fas fa-exclamation-triangle'; span.innerText = 'לא מסונכרן'; }
    }

    // ==========================================
    // אתחול וחיבור לגוגל
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
            const query = encodeURIComponent(`name='community_data_final.json' and trashed=false`);
            const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder,drive&orderBy=modifiedTime desc&fields=files(id,name)`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const searchData = await searchRes.json();
            if (!searchData.files || searchData.files.length === 0) { showToast("⚠️ לא נמצא קובץ נתונים"); setSyncStatus('error'); continueOffline(); return; }
            const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const textData = await dlRes.text();
            try { 
                db = JSON.parse(textData); if(!db.meta) db.meta = {}; storageSet(DATA_KEY, db); setSyncStatus('success'); 
                document.getElementById('f-fab-wrapper').style.display = 'block';
                if(map) { renderMarkers(); renderTasks(); renderCommunity(); } 
                checkForOfficeRoute();
            } catch(e) { setSyncStatus('error'); continueOffline(); }
        } catch (e) { setSyncStatus('offline'); continueOffline(); }
    }

    function continueOffline() {
        isOfflineMode = true; db = storageGet(DATA_KEY); setSyncStatus('offline');
        if (db) { document.getElementById('f-login').style.display = 'none'; document.getElementById('f-fab-wrapper').style.display = 'block'; bootMap(); startLocationTracking(); checkForOfficeRoute(); }
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

    async function pushOutboxToDrive() { return true; }
    async function forceSync() { if (!navigator.onLine) { showToast("אין חיבור רשת"); return; } if (!accessToken) { login(); return; } await pushOutboxToDrive(); await loadDataFromDrive(); }

    // ==========================================
    // מפה ולוגיקת קליקים
    // ==========================================
    function bootMap() {
        if(map) return;
        setTimeout(() => document.getElementById('f-splash').style.display = 'none', 500);
        let centerCoords = db?.__SETTINGS__?.homeLocation?.coords || [34.8878, 31.9928];
        map = new mapboxgl.Map({ container: 'f-map', style: isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12', center: centerCoords, zoom: 15, pitch: 60, antialias: true });
        map.on('load', () => { add3DLayer(); renderMarkers(); renderTasks(); renderCommunity(); initClickLogic(); });
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
                
                if (db[addr]) openBuildingCard(addr, false);
                else showToast("בניין זה לא קיים במאגר. פתח תפריט והוסף משפחה.");
            } catch(err) { console.error(err); }
        });
        
        map.on('mousedown', handlePointerDown);
        map.on('mousemove', () => isDraggingMap = true);
        map.on('mouseup', handlePointerUp);
        map.on('touchstart', handlePointerDown, {passive: true});
        map.on('touchmove', () => isDraggingMap = true, {passive: true});
        map.on('touchend', handlePointerUp, {passive: true});
    }

    function handlePointerDown(e) { isDraggingMap = false; pressTimer = setTimeout(() => { if(!isDraggingMap) { if(navigator.vibrate) navigator.vibrate([30,50,30]); openRouteMenu(); } }, 500); }
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
            html += `<button onclick="fieldApp.promptAddToRoute('${safeBldgEnc}')" style="width:100%; margin-bottom:15px; padding:12px; background:var(--accent); color:white; border:none; border-radius:12px; font-weight:bold; font-size:15px; cursor:pointer;"><i class="fas fa-plus"></i> הוסף למסלול מהיר</button>`;
        }

        html += `<div style="max-height:30vh; overflow-y:auto;">`;
        apts.forEach((fam, idx) => {
            html += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-body); padding:12px; border-radius:12px; margin-bottom:10px; cursor:pointer;" 
                onclick="fieldApp.openFamilyCard('${safeBldgEnc}', ${idx})">
                <div>
                    <div style="font-weight:bold; font-size:15px;">משפחת ${escapeHTML(fam.name || 'ללא שם')}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${fam.num ? 'דירה ' + escapeHTML(String(fam.num)) : ''}</div>
                </div>
                <i class="fas fa-chevron-left" style="color:var(--text-muted);"></i>
            </div>`;
        });
        html += `</div>`;

        document.getElementById('f-sheet-content').innerHTML = html;
        sheet.classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
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

    // ==========================================
    // *** חדש: כרטיס משפחה מלא ***
    // ==========================================
    function openFullFamilyCard(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc);
        const fam = db[bldg].apts[aptIdx];
        if (!fam) return;

        const sheet = document.getElementById('f-sheet');
        sheet.style.height = '90vh';

        let html = `
        <button class="sheet-close-btn" onclick="fieldApp.closeOverlays(); document.getElementById('f-sheet').style.height=''">
            <i class="fas fa-times"></i>
        </button>
        <div style="margin-top:20px; overflow-y:auto; max-height:calc(90vh - 80px);">
            <h2 style="margin-bottom:5px;">משפחת ${escapeHTML(fam.name || 'ללא שם')}</h2>
            <p style="color:var(--text-muted); margin-bottom:20px;">${escapeHTML(bldg)} ${fam.num ? '· דירה ' + escapeHTML(String(fam.num)) : ''}</p>

            <div style="display:flex; border-bottom:1px solid var(--border-light); margin-bottom:15px; gap:0;">
                <div style="padding:10px 15px; border-bottom:3px solid var(--accent); font-weight:bold; color:var(--accent);">מידע כללי</div>
                <div style="padding:10px 15px; color:var(--text-muted);">משימות (${(fam.tasks || []).filter(t=>!t.done).length})</div>
                <div style="padding:10px 15px; color:var(--text-muted);">היסטוריה (${(fam.history || []).length})</div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px;">
                <div>
                    <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">שם האב</label>
                    <div style="padding:10px; background:var(--bg-body); border-radius:8px; font-weight:600;">${escapeHTML(fam.fatherName || '-')}</div>
                </div>
                <div>
                    <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">שם האם</label>
                    <div style="padding:10px; background:var(--bg-body); border-radius:8px; font-weight:600;">${escapeHTML(fam.motherName || '-')}</div>
                </div>
                <div>
                    <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">טלפון</label>
                    <div style="padding:10px; background:var(--bg-body); border-radius:8px;">${escapeHTML(fam.phone || fam.fatherPhone || fam.motherPhone || '-')}</div>
                </div>
                <div>
                    <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">טלפון בית</label>
                    <div style="padding:10px; background:var(--bg-body); border-radius:8px;">${escapeHTML(fam.homePhone || '-')}</div>
                </div>
                <div style="grid-column:span 2;">
                    <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:6px;">תגיות</label>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        ${(fam.tags || []).length > 0
                            ? (fam.tags).map(t => `<span style="background:var(--accent); color:white; padding:4px 12px; border-radius:15px; font-size:12px; font-weight:600;">${escapeHTML(t)}</span>`).join('')
                            : '<span style="color:var(--text-muted); font-size:13px;">אין תגיות</span>'
                        }
                    </div>
                </div>
            </div>

            <button onclick="fieldApp.openFamilyForm('${bldgEnc}', ${aptIdx}); document.getElementById('f-sheet').style.height='';" 
                style="width:100%; padding:15px; background:var(--text-main); color:white; border:none; border-radius:12px; font-weight:bold; font-size:16px; cursor:pointer; font-family:inherit;">
                <i class="fas fa-edit"></i> ערוך פרטי משפחה
            </button>
        </div>`;

        document.getElementById('f-sheet-content').innerHTML = html;
        // וודא שהחלונית פתוחה (closeOverlays סגרה אותה קודם)
        sheet.classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
    }

    function openFamilyCard(bldgEnc, aptIdx) {
        const bldg = decodeURIComponent(bldgEnc); currentTarget = { bldg, aptIdx }; const fam = db[bldg].apts[aptIdx];
        if (!fam) return;
        const safeName = escapeHTML(fam.name || 'ללא שם');
        const parents = [fam.fatherName, fam.motherName].filter(Boolean).join(' ו-');
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
        if (coords) html += `<div style="display:flex; gap:10px; margin-top:15px;"><button onclick="fieldApp.openExternalNav(${coords[0]}, ${coords[1]}, 'waze')" style="flex:1; padding:8px; background:#33ccff; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:13px;"><i class="fab fa-waze"></i> Waze</button><button onclick="fieldApp.openExternalNav(${coords[0]}, ${coords[1]}, 'google')" style="flex:1; padding:8px; background:#ea4335; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:13px;"><i class="fas fa-map-marker-alt"></i> Google</button></div>`;
        
        // *** כפתור כרטיס מלא ***
        html += `<button onclick="fieldApp.openFullFamilyCard('${safeBldgEnc}', ${aptIdx})" style="width:100%; margin-top:15px; padding:12px; background:rgba(37,99,235,0.08); color:var(--accent); border:1px solid rgba(37,99,235,0.4); border-radius:12px; font-weight:bold; cursor:pointer; font-family:inherit;"><i class="fas fa-id-card"></i> פתח כרטיס משפחה מלא</button>`;
        
        html += historyHTML;

        document.getElementById('f-sheet-content').innerHTML = html;
        document.getElementById('f-sheet').classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
    }

    // ==========================================
    // עריכה ובניית מסלולים
    // ==========================================

    // *** עדכון: toggleRouteBuilderMode עם דיאלוג הוראות ***
    function toggleRouteBuilderMode() {
        isRouteBuilderMode = true;
        closeOverlays();

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

        if (selectedRouteBuildings.length > 0) { 
            if(bar) { bar.style.display = 'flex'; document.getElementById('f-route-counter').innerText = selectedRouteBuildings.length; }
        } else { 
            if(bar) bar.style.display = 'none'; 
            isRouteBuilderMode = false;
        }
    }

    function toggleTargetForRoute(el, lng, lat) {
        if (!lng || !lat || isNaN(lng)) { showToast("למשפחה זו אין מיקום מוגדר במפה."); return; }
        const coordsStr = `${lng},${lat}`;
        const existingIdx = selectedRouteBuildings.findIndex(c => `${c.coords[0]},${c.coords[1]}` === coordsStr);

        if (existingIdx >= 0) {
            selectedRouteBuildings.splice(existingIdx, 1);
            el.style.border = "1px solid var(--border-light)";
            el.style.background = "var(--surface)";
        } else {
            selectedRouteBuildings.push({ address: 'יעד מהקהילה', coords: [lng, lat], featureId: null });
            el.style.border = "2px solid var(--accent)";
            el.style.background = "rgba(59,130,246,0.05)";
        }
        isRouteBuilderMode = true;
        updateRouteVisuals();
    }

    function promptAddToRoute(bldgEnc) {
        const bldg = decodeURIComponent(bldgEnc); const coords = db[bldg]?.info?.coords;
        if(!coords) return showToast("אין מיקום למשפחה זו");
        isRouteBuilderMode = true;
        const existingIdx = selectedRouteBuildings.findIndex(b => b.address === bldg);
        if(existingIdx === -1) selectedRouteBuildings.push({ address: bldg, coords: coords });
        closeOverlays(); updateRouteVisuals(); showToast("הבניין נוסף למסלול! סרגל המסלול מוצג למטה.");
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
        if (fabIsOpen) { fabIsOpen = false; document.getElementById('f-fab-wrapper')?.classList.remove('open'); }
        document.getElementById('f-scrim').style.display = 'none';
        if(db) document.getElementById('f-fab-wrapper').style.display = 'block';
        if (activeBuildingFeatureId && map) { map.setFeatureState({source: 'composite', sourceLayer: 'building', id: activeBuildingFeatureId}, { active: false }); activeBuildingFeatureId = null; }
    }

    function toggleFab() {
        fabIsOpen = !fabIsOpen;
        document.getElementById('f-fab-wrapper')?.classList.toggle('open', fabIsOpen);
        const scrim = document.getElementById('f-scrim');
        if (fabIsOpen) { document.querySelectorAll('.f-sheet').forEach(s => s.classList.remove('open')); scrim.style.display = 'block'; if (navigator.vibrate) navigator.vibrate(20); }
        else { scrim.style.display = 'none'; }
    }

    function switchView(viewId, element) {
        if (element) { document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active')); element.classList.add('active'); }
        document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
        document.getElementById('view-' + viewId).classList.add('active');
        closeOverlays();
        if (viewId === 'map' && map) setTimeout(() => map.resize(), 100);
        if (viewId === 'tasks' && db) renderTasks();
    }

    function openRouteMenu() {
        closeOverlays();
        document.getElementById('f-fab-wrapper').style.display = 'none';
        switchView('map', document.querySelector('.nav-item'));
        document.getElementById('f-route-sheet').classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
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
            const parents = [f.apt.fatherName, f.apt.motherName].filter(Boolean).join(' ו-');
            const tags = (f.apt.tags || []).map(t => `<span style="background:var(--accent);color:white;padding:2px 6px;border-radius:4px;font-size:11px;">${escapeHTML(t)}</span>`).join(' ');
            const safeBldgEnc = encodeURIComponent(f.bldg);

            return `
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
                        <button class="card-action-btn" onclick="event.stopPropagation(); fieldApp.openFamilyCard('${safeBldgEnc}', ${f.aptIdx});"><i class="fas fa-id-card" style="color:var(--accent);"></i>כרטיס</button>
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
            document.getElementById('f-add-fam-father').value = fam.fatherName || '';
            document.getElementById('f-add-fam-mother').value = fam.motherName || '';
            document.getElementById('f-add-fam-address').value = bldgDecoded === NO_ADDRESS_KEY ? '' : bldgDecoded;
            document.getElementById('f-add-fam-apt').value = fam.num || '';
            document.getElementById('f-add-fam-phone').value = fam.phone || fam.fatherPhone || fam.motherPhone || '';
            document.getElementById('f-add-fam-homephone').value = fam.homePhone || '';
            document.getElementById('f-add-fam-intercom').value = db[bldgDecoded].info?.code || '';
            titleIcon.innerHTML = '<i class="fas fa-user-edit" style="color:var(--accent);"></i> עריכת פרטי משפחה';
            saveBtn.innerHTML = '<i class="fas fa-save"></i> עדכן נתונים';
        } else {
            editingFamilyContext = null;
            ['name', 'father', 'mother', 'address', 'apt', 'phone', 'homephone', 'intercom'].forEach(id => { document.getElementById('f-add-fam-' + id).value = ''; });
            titleIcon.innerHTML = '<i class="fas fa-user-plus" style="color:var(--accent);"></i> הוספת משפחה חדשה';
            saveBtn.innerHTML = '<i class="fas fa-save"></i> הוסף למערכת';
        }
        sheet.classList.add('open'); document.getElementById('f-scrim').style.display = 'block';
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

        const familyData = { name, fatherName, motherName, phone, homePhone, num: aptNum };
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

        storageSet(DATA_KEY, db); storageSet(OUTBOX_KEY, outbox); closeOverlays(); renderCommunity(); renderMarkers();
    }

    function openAddTask() {
        closeOverlays(); document.getElementById('f-fab-wrapper').style.display = 'none';
        document.getElementById('f-add-task-text').value = '';
        const select = document.getElementById('f-add-task-family-select');
        let optionsHtml = '<option value="">-- משימה כללית (ללא שיוך) --</option>';
        Object.keys(db).forEach(bldg => { if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return; (db[bldg].apts || []).forEach((apt, aptIdx) => { optionsHtml += `<option value="${encodeURIComponent(bldg)}|${aptIdx}">משפחת ${escapeHTML(apt.name)} (${escapeHTML(bldg)})</option>`; }); });
        select.innerHTML = optionsHtml;
        document.getElementById('f-add-task-sheet').classList.add('open'); document.getElementById('f-scrim').style.display = 'block';
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

    function initTaskDateFilter() {
        const d = document.getElementById('f-task-date-filter');
        if (d && !d.value) d.value = new Date().toISOString().split('T')[0];
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
                    allTasks.push({ ...t, isGeneral: false, bldg, aptIdx, tIdx, famName: apt.name || bldg });
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
                (t.tags || []).some(tag => tag.toLowerCase().includes(searchQ));
            if (!matchSearch) return false;
            if (taskFilterMode === 'all') return true;
            // המרת תאריך המשימה מעברית ל-ISO
            let tISO = null;
            if (t.date) {
                const parts = t.date.split('.');
                if (parts.length === 3) tISO = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
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

    function initTaskDateFilter() {
        const d = document.getElementById('f-task-date-filter');
        if (d && !d.value) d.value = new Date().toISOString().split('T')[0];
    }

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
        const isGeneral = el.getAttribute('data-general') === 'true';
        if (isGeneral) {
            currentEditTaskRef = db.meta.generalTasks[el.getAttribute('data-idx')];
        } else {
            const bldg = decodeURIComponent(el.getAttribute('data-bldg'));
            currentEditTaskRef = db[bldg].apts[el.getAttribute('data-apt')].tasks[el.getAttribute('data-task')];
        }
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
        document.getElementById('f-task-edit-sheet').classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
        document.getElementById('f-fab-wrapper').style.display = 'none';
    }

    let currentEditTags = [];
    let tagDropdownItems = [];
    let tagDropdownFocus = -1;

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
        document.getElementById('f-voice-sheet').classList.add('open');
        document.getElementById('f-scrim').style.display = 'block';
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

    function startMissionMode(waypoints) {
        missionWaypoints = waypoints || []; missionCurrentIdx = 0; missionPaused = false; isMissionActive = true;
        document.getElementById('f-mission-hud').style.display = 'flex';
        document.getElementById('f-bottom-nav-bar').style.display = 'none';
        document.getElementById('f-fab-wrapper').style.display = 'none';
        document.getElementById('f-sync-status').style.display = 'none';
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

    function showMissionSummary() {
        isMissionActive = false; if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
        let visitedCount = Object.keys(getVisited()).length; let completedTasks = 0;
        Object.keys(db).forEach(bldg => { if(bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return; (db[bldg].apts || []).forEach(apt => { (apt.tasks || []).forEach(t => { if(t.done) completedTasks++; }); }); });
        document.getElementById('f-mission-hud').style.display = 'none';
        document.getElementById('f-mission-summary').style.display = 'flex';
        document.getElementById('f-summary-families').innerText = visitedCount;
        document.getElementById('f-summary-tasks').innerText = completedTasks;
        document.getElementById('f-summary-stops').innerText = missionWaypoints.length;
        if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    }

    function closeMissionSummary() {
        document.getElementById('f-mission-summary').style.display = 'none';
        document.getElementById('f-bottom-nav-bar').style.display = 'flex';
        document.getElementById('f-fab-wrapper').style.display = 'block';
        document.getElementById('f-sync-status').style.display = 'flex';
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

    function openSavedRoutesSheet() { closeOverlays(); renderSavedRoutesSheet(); document.getElementById('f-saved-routes-sheet').classList.add('open'); document.getElementById('f-scrim').style.display = 'block'; }
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
    // חשיפת הפונקציות החוצה
    // ==========================================
    return { 
        init, login, switchView, toggleFab, closeOverlays, openRouteMenu, buildRoute, openFamilyForm, saveFamilyForm,
        openAddTask, saveNewTask, openBuildingCard, openFamilyCard, openArrivalSheet: openArrivalSheetEncoded,
        openVoiceSummary, toggleVoiceRecording, saveVisitLog, confirmAutoTask, jumpToCenter, recenter,
        callFamilyNumber, toggleDarkMode, forceSync, openExternalNav, searchAddressInput, selectAddressOption,
        toggleTargetForRoute, startCustomRoute, saveQuickTask, showToast,
        finishMission, pauseMission, refreshMissionRoute, markAllDoneInBuilding, saveRoute, loadSavedRoutes,
        deleteSavedRoute, toggleTaskLayer, completeMissionTask, switchMissionTab, nextMissionTarget, prevMissionTarget,
        closeMissionSummary, buildRouteFromSaved, openSavedRoutesSheet, routeDialogGoNow, routeDialogSaveLater,
        toggleRouteBuilderMode, promptAddToRoute, openRouteEditor, moveRouteItem, removeRouteItem, saveAndStartEditedRoute,
        handleCardTouchStart, handleCardTouchEnd, addSingleToRoute, removeSingleFromRoute,
        // *** פונקציות חדשות חשופות ***
        openFullImage, openFullFamilyCard,
        // *** מסך משימות מתקדם ***
        toggleViewAllTasks, toggleCompletedTasks, setTaskFilter, openTaskEdit, saveEditedTask,
        deleteCurrentTask, addEditTag, removeEditTag, toggleChipTag, onTagAtInput, onTagAtKey, selectDropdownTag,
        toggleVoiceSearch
    };
})();

window.addEventListener('DOMContentLoaded', () => fieldApp.init());
