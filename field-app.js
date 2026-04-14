'use strict';

const CLIENT_ID   = '348261974014-242r9b0dvctlka7rj3aetu81v96ere46.apps.googleusercontent.com';
const SCOPES      = 'email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
const GEOFENCE_M  = 30;   
const DATA_KEY    = 'field_data';
const VISITED_KEY = 'field_visited';
const OUTBOX_KEY  = 'field_outbox'; 

mapboxgl.accessToken = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';
mapboxgl.setRTLTextPlugin('https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js', null, true);

const fieldApp = (function () {
    let map = null, markers = [], db = null;
    let accessToken = null, isOfflineMode = false, currentTarget = null;
    let watchId = null;
    let fabIsOpen = false;
    let isDark = false;
    let tokenClient = null;

    const storageGet = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
    const storageSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));
    
    const getVisited = () => storageGet(VISITED_KEY) || {};
    const markVisited = (id) => { const v = getVisited(); v[id] = new Date().toISOString(); storageSet(VISITED_KEY, v); };
    const isVisited = (id) => !!getVisited()[id];

    async function init() {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('field-sw.js').catch(e=>console.log(e));
        
        isDark = localStorage.getItem('field_theme') === 'dark';
        if(isDark) {
            document.body.classList.add('dark-mode');
            document.getElementById('f-theme-btn').innerHTML = '<i class="fas fa-sun"></i>';
        }

        if (!document.getElementById('f-toast-container')) {
            const tc = document.createElement('div'); tc.id = 'f-toast-container';
            tc.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:9999; display:flex; flex-direction:column; gap:10px; width:90%; pointer-events:none;';
            document.body.appendChild(tc);
        }

        if (typeof google !== 'undefined') {
            tokenClient = google.accounts.oauth2.initTokenClient({ 
                client_id: CLIENT_ID, 
                scope: SCOPES, 
                callback: handleGoogleAuthResponse 
            });
            
            if (localStorage.getItem('field_has_logged_in') === 'true') {
                tokenClient.requestAccessToken({ prompt: '' });
            } else {
                showAuthScreen();
            }
        } else {
            continueOffline();
        }
    }

    function showAuthScreen() { document.getElementById('f-splash').style.display = 'none'; document.getElementById('f-login').style.display = 'block'; }
    
    function login() {
        if(tokenClient) tokenClient.requestAccessToken({ prompt: 'consent' });
        else showToast("שירותי גוגל טרם נטענו, נסה שוב");
    }

    async function handleGoogleAuthResponse(resp) {
        if (resp.error) { showAuthScreen(); return; }
        accessToken = resp.access_token;
        localStorage.setItem('field_has_logged_in', 'true');
        document.getElementById('f-login').style.display = 'none';
        document.getElementById('f-splash').style.display = 'flex'; // מחזירים מסך טעינה
        showToast("מתחבר לדרייב ומושך נתונים...");
        await loadDataFromDrive();
        bootMap();
        startLocationTracking();
    }

    async function loadDataFromDrive() {
        try {
            // התיקון הקריטי: מחפש את הקובץ המעודכן ביותר כדי לא למשוך גרסת גיבוי ישנה וריקה
            const query = encodeURIComponent(`name='community_data_final.json' and trashed=false`);
            const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime desc&fields=files(id,name)`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const searchData = await searchRes.json();
            
            if (!searchData.files || searchData.files.length === 0) { 
                showToast("⚠️ לא נמצא קובץ נתונים בדרייב");
                continueOffline(); return; 
            }
            
            const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const textData = await dlRes.text(); // משיכה כטקסט למניעת קריסה
            
            try {
                db = JSON.parse(textData);
                
                // ולידציה בסיסית שומרת על יציבות
                if(!db.families) db.families = [];
                if(!db.meta) db.meta = {};
                
                storageSet(DATA_KEY, db);
                showToast(`✅ סונכרן! נטענו ${db.families.length} משפחות.`);
            } catch(e) {
                showToast("❌ הקובץ בדרייב פגום. עובר לאופליין.");
                continueOffline();
                return;
            }
        } catch (e) { 
            showToast("❌ תקלת תקשורת מגוגל.");
            continueOffline(); 
        }
    }

    function continueOffline() {
        isOfflineMode = true; db = storageGet(DATA_KEY);
        if (db) { document.getElementById('f-login').style.display = 'none'; bootMap(); startLocationTracking(); }
        else { showToast("❌ חובה חיבור רשת לאיפוס ראשוני"); showAuthScreen(); }
    }

    function bootMap() {
        setTimeout(() => document.getElementById('f-splash').style.display = 'none', 500);
        
        let centerCoords = [34.8878, 31.9928];
        if(db?.meta?.homeLocation?.lng) {
            centerCoords = [db.meta.homeLocation.lng, db.meta.homeLocation.lat];
        }

        map = new mapboxgl.Map({
            container: 'f-map',
            style: isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12',
            center: centerCoords, zoom: 14, pitch: 60, antialias: true
        });

        map.on('load', () => {
            add3DLayer();
            renderMarkers();
            renderTasks();
            renderCommunity();
        });
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
        if (!map || !db?.families) return;
        markers.forEach(m => m.remove()); markers = [];

        if(db?.meta?.homeLocation?.lng) {
            const homeCoords = [db.meta.homeLocation.lng, db.meta.homeLocation.lat];
            const homeEl = document.createElement('div');
            homeEl.style.cssText = `width:45px; height:45px; background-image:url('https://raw.githubusercontent.com/bmbortnik770/shlichus/refs/heads/main/favicon.ico'); background-size:contain; background-repeat:no-repeat; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5)); cursor:pointer; z-index: 5;`;
            const homeMarker = new mapboxgl.Marker(homeEl).setLngLat(homeCoords).addTo(map);
            homeEl.addEventListener('click', () => { showToast("מרכז בית חב״ד"); map.flyTo({ center: homeCoords, zoom: 18, pitch: 60 }); });
            markers.push(homeMarker);
        }

        db.families.forEach((fam) => {
            if (!fam.lng || !fam.lat) return;
            const el = document.createElement('div');
            el.style.cssText = 'width:18px; height:18px; background:var(--accent); border:3px solid white; border-radius:50%; box-shadow:0 0 10px rgba(0,0,0,0.4); cursor:pointer;';
            const marker = new mapboxgl.Marker(el).setLngLat([fam.lng, fam.lat]).addTo(map);
            el.addEventListener('click', () => openArrivalSheet(fam));
            markers.push(marker);
        });
    }

    function toggleDarkMode() {
        isDark = !isDark;
        document.body.classList.toggle('dark-mode', isDark);
        localStorage.setItem('field_theme', isDark ? 'dark' : 'light');
        document.getElementById('f-theme-btn').innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        if (map) { map.setStyle(isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12'); map.once('style.load', () => { add3DLayer(); renderMarkers(); }); }
    }

    function startLocationTracking() {
        if (!navigator.geolocation) return;
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (!db?.families) return;
                const user = [pos.coords.longitude, pos.coords.latitude];
                db.families.forEach(fam => {
                    if (!fam.lng || !fam.lat) return;
                    const famId = fam.id || fam.familyName;
                    if (calculateDistance(user, [fam.lng, fam.lat]) < GEOFENCE_M && !isVisited(famId)) {
                        markVisited(famId); openArrivalSheet(fam);
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

    function startMissionMode() { toggleFab(); switchView('map', document.querySelector('.nav-item')); showToast("🔍 מחפש מסלולים..."); }
    function openAddFamily() { toggleFab(); showToast("פתיחת טופס משפחה..."); }
    function openAddTask() { toggleFab(); showToast("פתיחת טופס משימה..."); }

    function openArrivalSheet(fam) {
        currentTarget = fam;
        const sheet = document.getElementById('f-sheet');
        if (!sheet) return;
        if(fam.lng && fam.lat) map.flyTo({ center: [fam.lng, fam.lat], zoom: 18, pitch: 60, duration: 2000 });
        
        document.getElementById('f-sheet-content').innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <h3 style="margin: 0 0 5px 0; font-size: 22px;">משפחת ${fam.familyName}</h3>
                    <div style="color: var(--text-muted); font-size: 14px;"><i class="fas fa-map-marker-alt"></i> ${fam.address || 'ללא כתובת'} ${fam.apt ? 'דירה '+fam.apt : ''}</div>
                </div>
                <div style="background: var(--bg-body); padding: 5px 10px; border-radius: 8px; text-align: center; border: 1px solid var(--border-light);">
                    <div style="font-size: 11px; color: var(--text-muted);">אינטרקום</div>
                    <div style="font-weight: 800; font-size: 16px; color: var(--success);">${fam.bldgCode || 'אין'}</div>
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
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
    }

    function openArrivalSheetByIndex(idx) {
        if(db && db.families && db.families[idx]) {
            openArrivalSheet(db.families[idx]);
        }
    }

    function closeSheet() { document.getElementById('f-sheet')?.classList.remove('open'); if (fabIsOpen) toggleFab(); }

    function showToast(msg) {
        const c = document.getElementById('f-toast-container'); if (!c) return;
        const t = document.createElement('div');
        t.style.cssText = 'background:var(--surface); color:var(--text-main); padding:14px 20px; border-radius:20px; box-shadow:var(--shadow); font-weight:bold; border:1px solid var(--border-light); pointer-events:none;';
        t.innerHTML = msg; c.appendChild(t);
        setTimeout(() => { t.style.transition='opacity 0.3s'; t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 3000);
    }

    function renderTasks() {
        const c = document.getElementById('f-tasks-list'); 
        if (!c || !db?.meta?.generalTasks) return;
        
        c.innerHTML = db.meta.generalTasks.map((t, index) => {
            if (t.done) return ''; 
            return `
            <div class="task-swipe-container" style="position:relative; margin-bottom:12px; overflow:hidden; border-radius:16px; box-shadow:var(--shadow);">
                <div class="task-bg-success" style="position:absolute; top:0; left:0; width:100%; height:100%; background:var(--success); color:white; display:flex; align-items:center; padding-left:20px; font-size:20px; font-weight:bold; z-index:1;">
                    <i class="fas fa-check"></i>
                </div>
                <div class="task-item-front" data-index="${index}" style="position:relative; background:var(--surface); border:1px solid var(--border-light); padding:16px; border-radius:16px; display:flex; justify-content:space-between; align-items:center; z-index:2; transition: transform 0.2s ease;">
                    <div>
                        <div style="font-weight:600; font-size:16px;">${t.text}</div>
                        <div style="font-size:13px; color:var(--text-muted); margin-top:4px;"><i class="far fa-calendar"></i> ${t.date || 'ללא מועד'}</div>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        initSwipeLogic();
    }

    function initSwipeLogic() {
        const items = document.querySelectorAll('.task-item-front');
        items.forEach(item => {
            let startX = 0; let currentX = 0; let isDragging = false;
            item.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; isDragging = true; item.style.transition = 'none'; }, {passive: true});
            item.addEventListener('touchmove', (e) => {
                if (!isDragging) return; currentX = e.touches[0].clientX; let diff = currentX - startX;
                if (diff < 0) item.style.transform = `translateX(${diff}px)`;
            }, {passive: true});
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
        
        const taskIndex = item.getAttribute('data-index');
        db.meta.generalTasks[taskIndex].done = true;
        storageSet(DATA_KEY, db);
        
        const outbox = storageGet(OUTBOX_KEY) || [];
        outbox.push({ type: 'task_complete', taskIndex: taskIndex, timestamp: new Date().toISOString() });
        storageSet(OUTBOX_KEY, outbox);

        showToast("✅ המשימה הושלמה!");
        setTimeout(() => {
            const container = item.closest('.task-swipe-container'); container.style.opacity = '0';
            setTimeout(() => container.remove(), 300);
        }, 300);
    }

    function renderCommunity() {
        const c = document.getElementById('f-community-list'); 
        if (!c || !db?.families) return;
        // התיקון הקריטי: שולחים רק את האינדקס לכפתור, ולא את כל האובייקט, כדי למנוע קריסה ממרכאות כפולות!
        c.innerHTML = db.families.slice(0, 50).map((f, index) => `
            <div style="background:var(--surface); border:1px solid var(--border-light); padding:16px; border-radius:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow);">
                <div><div style="font-weight:600; font-size:16px;">משפחת ${f.familyName || 'ללא שם'}</div><div style="font-size:13px; color:var(--text-muted); margin-top:4px;">${f.address || 'ללא כתובת'}</div></div>
                <button style="background:var(--accent); border:none; width:40px; height:40px; border-radius:50%; color:white; cursor:pointer; box-shadow:0 4px 10px rgba(37,99,235,0.3);" onclick="fieldApp.openArrivalSheetByIndex(${index})"><i class="fas fa-map-marker-alt"></i></button>
            </div>`).join('');
    }

    function jumpToCenter() {
        const c = db?.meta?.homeLocation?.lng ? [db.meta.homeLocation.lng, db.meta.homeLocation.lat] : [34.8878, 31.9928];
        map.flyTo({ center: c, zoom: 18, pitch: 60 });
    }
    
    function recenter() { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 17, pitch: 60 })); }
    function callFamily() { const p = currentTarget?.fatherPhone || currentTarget?.motherPhone || currentTarget?.phone; if (p) window.location.href = `tel:${p}`; else showToast("אין מספר רשום"); }

    return { init, login, switchView, toggleFab, startMissionMode, openAddFamily, openAddTask, openArrivalSheet, openArrivalSheetByIndex, closeSheet, jumpToCenter, recenter, callFamily, toggleDarkMode };
})();

window.addEventListener('DOMContentLoaded', () => fieldApp.init());
