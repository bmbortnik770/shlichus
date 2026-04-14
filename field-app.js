/**
 * field-app.js — המוח המאוחד והמודרני של אפליקציית השטח (V7)
 */

'use strict';

const CLIENT_ID   = '348261974014-242r9b0dvctlka7rj3aetu81v96ere46.apps.googleusercontent.com';
const SCOPES      = 'email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
const GEOFENCE_M  = 30;   // רדיוס הגעה
const DATA_KEY    = 'field_data';
const VISITED_KEY = 'field_visited';

mapboxgl.accessToken = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';
mapboxgl.setRTLTextPlugin('https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js', null, true);

const fieldApp = (function () {
    let map = null, markers = [], db = null;
    let accessToken = null, isOfflineMode = false, currentTarget = null;
    let watchId = null;
    let fabIsOpen = false;

    const storageGet = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
    const storageSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));
    
    // ניהול ביקורים כדי לא להקפיץ שוב ושוב את אותה משפחה
    const getVisited = () => storageGet(VISITED_KEY) || {};
    const markVisited = (id) => { const v = getVisited(); v[id] = new Date().toISOString(); storageSet(VISITED_KEY, v); };
    const isVisited = (id) => !!getVisited()[id];

    // --- אתחול ---
    async function init() {
        console.log("🚀 אתחול מערכת שטח V7...");

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('field-sw.js').catch(err => console.error("SW Error:", err));
        }

        // יצירת מיכל הודעות קופצות (Toasts) אם לא קיים
        if (!document.getElementById('f-toast-container')) {
            const tc = document.createElement('div');
            tc.id = 'f-toast-container';
            tc.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:9999; display:flex; flex-direction:column; gap:10px; width:90%;';
            document.body.appendChild(tc);
        }

        if (typeof google !== 'undefined') {
            const tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID, scope: SCOPES, callback: handleGoogleAuthResponse
            });
            google.accounts.id.initialize({
                client_id: CLIENT_ID, callback: () => tokenClient.requestAccessToken({ prompt: '' })
            });
            google.accounts.id.renderButton(document.getElementById('f-btn-login'), { theme: 'outline', size: 'large' });

            if (localStorage.getItem('field_has_logged_in') === 'true') {
                tokenClient.requestAccessToken({ prompt: '' });
            } else {
                showAuthScreen();
            }
        } else {
            continueOffline();
        }
    }

    function showAuthScreen() {
        document.getElementById('f-splash').style.display = 'none';
        document.getElementById('f-login').style.display = 'block';
    }

    async function handleGoogleAuthResponse(resp) {
        if (resp.error) { showAuthScreen(); return; }
        accessToken = resp.access_token;
        localStorage.setItem('field_has_logged_in', 'true');
        document.getElementById('f-login').style.display = 'none';
        await loadDataFromDrive();
        bootMap();
        startLocationTracking();
    }

    async function loadDataFromDrive() {
        try {
            const q = encodeURIComponent(`name='community_data_final.json' and trashed=false`);
            const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const searchData = await searchRes.json();

            if (!searchData.files || searchData.files.length === 0) {
                showToast("⚠️ קובץ הנתונים לא נמצא ב-Drive. עובד אופליין.");
                continueOffline(); return;
            }

            const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            db = await dlRes.json();
            storageSet(DATA_KEY, db);
        } catch (e) {
            console.error("Drive error:", e);
            continueOffline();
        }
    }

    function continueOffline() {
        isOfflineMode = true;
        db = storageGet(DATA_KEY);
        if (db) {
            document.getElementById('f-login').style.display = 'none';
            bootMap();
            startLocationTracking();
        } else {
            showToast("❌ אין נתונים מקומיים. חובה להתחבר לרשת פעם אחת.");
            showAuthScreen();
        }
    }

    // --- מפה ---
    function bootMap() {
        const splash = document.getElementById('f-splash');
        splash.style.opacity = '0';
        setTimeout(() => splash.style.display = 'none', 500); // הסרה בטוחה

        const centerCoords = db?.meta?.homeLocation?.lng ? [db.meta.homeLocation.lng, db.meta.homeLocation.lat] : [34.8878, 31.9928];

        map = new mapboxgl.Map({
            container: 'f-map',
            style: 'mapbox://styles/mapbox/dark-v11', // עיצוב כהה
            center: centerCoords,
            zoom: 14,
            pitch: 60,
            antialias: true
        });

        map.on('load', () => {
            map.addLayer({
                'id': '3d-buildings', 'source': 'composite', 'source-layer': 'building', 'filter': ['==', 'extrude', 'true'],
                'type': 'fill-extrusion', 'minzoom': 15,
                'paint': { 'fill-extrusion-color': '#1e293b', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.6 }
            });
            renderMarkers();
            renderTasks();      // טעינת לשונית משימות
            renderCommunity();  // טעינת לשונית קהילה
        });
    }

    function renderMarkers() {
        if (!map || !db?.families) return;
        markers.forEach(m => m.remove()); markers = [];

        db.families.forEach((fam) => {
            if (!fam.lng || !fam.lat) return;
            const el = document.createElement('div');
            // עיצוב נקודה מודרנית במפה
            el.style.cssText = 'width:20px; height:20px; background:var(--accent); border:3px solid white; border-radius:50%; box-shadow:0 0 15px rgba(0,0,0,0.6); cursor:pointer;';
            const marker = new mapboxgl.Marker(el).setLngLat([fam.lng, fam.lat]).addTo(map);
            el.addEventListener('click', () => openArrivalSheet(fam));
            markers.push(marker);
        });
    }

    // --- Geofencing ---
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
                        markVisited(famId);
                        openArrivalSheet(fam); // קפיצה אוטומטית בהגעה
                    }
                });
            },
            (err) => console.error(err), { enableHighAccuracy: true }
        );
    }

    function calculateDistance(l1, l2) {
        const R = 6371e3;
        const dLat = (l2[1] - l1[1]) * Math.PI / 180;
        const dLon = (l2[0] - l1[0]) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(l1[1] * Math.PI / 180) * Math.cos(l2[1] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // --- לוגיקת ממשק V7 ---

    function switchView(viewId, element) {
        if (element) {
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            element.classList.add('active');
        }
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

    function startMissionMode() {
        toggleFab();
        switchView('map', document.querySelector('.nav-item'));
        showToast("🔍 מחפש מסלולים מוכנים...");
    }

    function openAddFamily() { toggleFab(); showToast("פתיחת טופס משפחה..."); }
    function openAddTask() { toggleFab(); showToast("פתיחת טופס משימה..."); }

    // מגירת הגעה Uber Style
    function openArrivalSheet(fam) {
        currentTarget = fam;
        const sheet = document.getElementById('f-sheet');
        const content = document.getElementById('f-sheet-content');
        if (!sheet || !content) return;

        // התקרבות דרמטית ליעד
        if(fam.lng && fam.lat) map.flyTo({ center: [fam.lng, fam.lat], zoom: 18, pitch: 60, duration: 2000 });

        content.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <h3 style="margin: 0 0 5px 0; font-size: 22px;">משפחת ${fam.familyName}</h3>
                    <div style="color: var(--text-muted); font-size: 14px;">
                        <i class="fas fa-map-marker-alt"></i> ${fam.address || 'ללא כתובת'} ${fam.apt ? 'דירה '+fam.apt : ''}
                    </div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 5px 10px; border-radius: 8px; text-align: center; border: 1px solid var(--border-light);">
                    <div style="font-size: 11px; color: var(--text-muted);">אינטרקום</div>
                    <div style="font-weight: 800; font-size: 16px; color: var(--success);">${fam.bldgCode || 'אין'}</div>
                </div>
            </div>
            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <button style="flex: 1; padding: 14px; background: var(--success); color: white; border: none; border-radius: 12px; font-weight: bold; font-size: 16px;" onclick="fieldApp.closeSheet()">
                    <i class="fas fa-check"></i> הגעתי / סיום
                </button>
                <button style="width:50px; background: rgba(255,255,255,0.1); color: white; border: 1px solid var(--border-light); border-radius: 12px; cursor:pointer;" onclick="fieldApp.callFamily()">
                    <i class="fas fa-phone"></i>
                </button>
            </div>
        `;
        
        sheet.classList.add('open');
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
    }

    function closeSheet() {
        document.getElementById('f-sheet')?.classList.remove('open');
        if (fabIsOpen) toggleFab();
    }

    function showToast(msg) {
        const container = document.getElementById('f-toast-container');
        if (!container) return;
        const t = document.createElement('div');
        t.style.cssText = 'background:var(--surface); color:var(--text-main); padding:14px 20px; border-radius:20px; box-shadow:0 8px 24px rgba(0,0,0,0.6); font-weight:bold; border:1px solid var(--border-light);';
        t.innerHTML = msg;
        container.appendChild(t);
        setTimeout(() => { t.style.transition='opacity 0.3s'; t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 3000);
    }

    // --- תוכן ללשוניות ---
    function renderTasks() {
        const container = document.getElementById('f-tasks-list');
        if (!container || !db?.meta?.generalTasks) return;
        container.innerHTML = db.meta.generalTasks.filter(t => !t.done).map(t => `
            <div style="background:var(--surface); border:1px solid var(--border-light); padding:16px; border-radius:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:600; font-size:16px;">${t.text}</div>
                    <div style="font-size:13px; color:var(--text-muted); margin-top:4px;"><i class="far fa-calendar"></i> ${t.date || 'ללא מועד'}</div>
                </div>
                <button style="background:none; border:2px solid var(--border-light); width:35px; height:35px; border-radius:50%; color:var(--text-muted);"><i class="fas fa-check"></i></button>
            </div>
        `).join('');
    }

    function renderCommunity() {
        const container = document.getElementById('f-community-list');
        if (!container || !db?.families) return;
        container.innerHTML = db.families.slice(0, 50).map(f => {
            const safeObj = encodeURIComponent(JSON.stringify(f));
            return `
            <div style="background:var(--surface); border:1px solid var(--border-light); padding:16px; border-radius:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:600; font-size:16px;">משפחת ${f.familyName}</div>
                    <div style="font-size:13px; color:var(--text-muted); margin-top:4px;">${f.address || 'ללא כתובת'}</div>
                </div>
                <button style="background:var(--accent); border:none; width:40px; height:40px; border-radius:50%; color:white; cursor:pointer; box-shadow:0 4px 10px rgba(37, 99, 235, 0.3);" onclick="fieldApp.openArrivalSheet(JSON.parse(decodeURIComponent('${safeObj}')))">
                    <i class="fas fa-map-marker-alt"></i>
                </button>
            </div>`;
        }).join('');
    }

    function jumpToCenter() {
        const centerCoords = db?.meta?.homeLocation?.lng ? [db.meta.homeLocation.lng, db.meta.homeLocation.lat] : [34.8878, 31.9928];
        map.flyTo({ center: centerCoords, zoom: 15, pitch: 45 });
    }
    
    function recenter() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(p => map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 17, pitch: 60 }));
        }
    }

    function callFamily() {
        const p = currentTarget?.fatherPhone || currentTarget?.motherPhone || currentTarget?.phone;
        if (p) window.location.href = `tel:${p}`;
        else showToast("אין מספר טלפון רשום");
    }

    return {
        init,
        switchView,
        toggleFab,
        startMissionMode,
        openAddFamily,
        openAddTask,
        openArrivalSheet,
        closeSheet,
        jumpToCenter,
        recenter,
        callFamily
    };
})();

window.addEventListener('DOMContentLoaded', () => fieldApp.init());
