/**
 * field-app.js — המוח המאוחד של אפליקציית השטח
 * ============================================================
 * ארכיטקטורה:
 * - קריאה מ-Google Drive (community_data_final.json)
 * - ניהול Outbox מקומי לסנכרון עתידי
 * - זיהוי הגעה אוטומטי (Geofencing) וניווט תלת-ממדי
 * - תיעוד קולי מהיר מבוסס Web Speech API
 * ============================================================
 * תיקונים:
 * 1. null-safety לפני כל גישה ל-db.families
 * 2. watchPosition מנוהל עם clearWatch
 * 3. geofencing עמיד בין sessions (localStorage)
 * 4. הגנה מפני קריאות כפולות ל-triggerArrival
 * 5. feedback למשתמש כשקובץ Drive חסר
 * 6. הגנה מפני toggle כפול של FAB
 * 7. ניקוי recognition בעת סגירת sheet
 * ============================================================
 */

'use strict';

const CLIENT_ID   = '348261974014-242r9b0dvctlka7rj3aetu81v96ere46.apps.googleusercontent.com';
const SCOPES      = 'email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
const GEOFENCE_M  = 30;   // רדיוס זיהוי הגעה במטרים
const OUTBOX_KEY  = 'field_outbox';
const DATA_KEY    = 'field_data';
const VISITED_KEY = 'field_visited'; // [תיקון 3] מפתח לביקורים שנשמרים בין sessions

mapboxgl.accessToken = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';
mapboxgl.setRTLTextPlugin(
    'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js',
    null,
    true
);

const fieldApp = (function () {
    let map = null, markers = [], db = null;
    let accessToken = null, isOfflineMode = false, currentTarget = null;
    let recognition = null, isRecording = false;
    let watchId = null;           // [תיקון 2] שמירת watchPosition ID לביטול עתידי
    let fabIsOpen = false;        // [תיקון 6] מצב FAB

    // --- עוזרים לתשתית ---
    const storageGet = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
    const storageSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));

    // [תיקון 3] ניהול רשימת ביקורים עמידה בין sessions
    const getVisited = () => storageGet(VISITED_KEY) || {};
    const markVisited = (id) => {
        const v = getVisited();
        v[id] = new Date().toISOString();
        storageSet(VISITED_KEY, v);
    };
    const isVisited = (id) => !!getVisited()[id];

    // --- אתחול המערכת ---
    async function init() {
        console.log("🚀 אתחול מערכת שטח...");

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('field-sw.js').catch(err => console.error("SW Error:", err));
        }

        initSpeech();
        updateOutboxUI();

        if (typeof google !== 'undefined') {
            const tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: handleGoogleAuthResponse
            });

            google.accounts.id.initialize({
                client_id: CLIENT_ID,
                callback: () => tokenClient.requestAccessToken({ prompt: '' })
            });

            google.accounts.id.renderButton(
                document.getElementById('f-google-btn'),
                { theme: 'outline', size: 'large' }
            );

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
        document.getElementById('f-splash').classList.add('hidden');
        document.getElementById('f-auth').classList.remove('hidden');
    }

    async function handleGoogleAuthResponse(resp) {
        if (resp.error) { showAuthScreen(); return; }
        accessToken = resp.access_token;
        localStorage.setItem('field_has_logged_in', 'true');
        document.getElementById('f-auth').classList.add('hidden');
        await loadDataFromDrive();
        bootMap();
        startLocationTracking();
    }

    async function loadDataFromDrive() {
        try {
            const q = encodeURIComponent(`name='community_data_final.json' and trashed=false`);
            const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const searchData = await searchRes.json();

            // [תיקון 5] טיפול מפורש בקובץ חסר
            if (!searchData.files || searchData.files.length === 0) {
                showToast("⚠️ הקובץ community_data_final.json לא נמצא ב-Drive. עובד עם נתונים מקומיים.");
                continueOffline();
                return;
            }

            const dlRes = await fetch(
                `https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`,
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );

            if (!dlRes.ok) {
                showToast("⚠️ שגיאה בהורדת הנתונים מ-Drive. עובד עם נתונים מקומיים.");
                continueOffline();
                return;
            }

            db = await dlRes.json();
            storageSet(DATA_KEY, db);
        } catch (e) {
            console.error("Drive load error:", e);
            continueOffline();
        }
    }

    function continueOffline() {
        isOfflineMode = true;
        db = storageGet(DATA_KEY);
        if (db) {
            document.getElementById('f-auth').classList.add('hidden');
            bootMap();
            startLocationTracking();
        } else {
            // [תיקון 5] אין נתונים בכלל — הודעה ברורה
            showToast("❌ אין נתונים מקומיים זמינים. נא להתחבר לרשת ולהתחבר שוב.");
            showAuthScreen();
        }
    }

    // --- מפה וניווט ---
    function bootMap() {
        const splash = document.getElementById('f-splash');
        splash.style.opacity = '0';
        setTimeout(() => splash.classList.add('hidden'), 500);

        const centerCoords = db?.meta?.homeLocation?.lng
            ? [db.meta.homeLocation.lng, db.meta.homeLocation.lat]
            : [34.8878, 31.9928];

        map = new mapboxgl.Map({
            container: 'f-map',
            style: 'mapbox://styles/mapbox/streets-v12',
            center: centerCoords,
            zoom: 14,
            pitch: 60,
            antialias: true
        });

        map.on('load', () => {
            map.addLayer({
                'id': '3d-buildings',
                'source': 'composite',
                'source-layer': 'building',
                'filter': ['==', 'extrude', 'true'],
                'type': 'fill-extrusion',
                'minzoom': 15,
                'paint': {
                    'fill-extrusion-color': '#e2e8f0',
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-opacity': 0.7
                }
            });
            renderMarkers();
        });
    }

    function renderMarkers() {
        // [תיקון 1] null-safety
        if (!map || !db?.families) return;

        markers.forEach(m => m.remove());
        markers = [];

        db.families.forEach((fam) => {
            if (!fam.lng || !fam.lat) return;
            const el = document.createElement('div');
            el.className = 'f-marker';
            el.style.cssText = 'width:30px; height:30px; background-image:url(https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png); background-size:contain; cursor:pointer;';
            const marker = new mapboxgl.Marker(el).setLngLat([fam.lng, fam.lat]).addTo(map);
            el.addEventListener('click', () => {
                map.flyTo({ center: [fam.lng, fam.lat], zoom: 17, pitch: 45 });
                openFamilySheet(fam);
            });
            markers.push(marker);
        });
    }

    function drawRouteTo(destLng, destLat) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const start = [pos.coords.longitude, pos.coords.latitude];
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${destLng},${destLat}?geometries=geojson&access_token=${mapboxgl.accessToken}`;
            try {
                const res = await fetch(url);
                const json = await res.json();
                if (!json.routes?.[0]) return;
                const coords = json.routes[0].geometry.coordinates;
                const geojson = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
                if (map.getSource('route')) {
                    map.getSource('route').setData(geojson);
                } else {
                    map.addLayer({
                        id: 'route', type: 'line',
                        source: { type: 'geojson', data: geojson },
                        paint: { 'line-color': '#2563eb', 'line-width': 6 }
                    });
                }
                const bounds = new mapboxgl.LngLatBounds(start, start).extend([destLng, destLat]);
                coords.forEach(c => bounds.extend(c));
                map.fitBounds(bounds, { padding: { top: 50, bottom: 350, left: 50, right: 50 }, duration: 1500 });
            } catch (e) {
                console.error("Route error:", e);
            }
        });
    }

    // --- Geofencing ---
    function startLocationTracking() {
        if (!navigator.geolocation) return;

        // [תיקון 1] null-safety לפני לולאה
        // [תיקון 2] שמירת watchId לביטול
        // [תיקון 3+4] שימוש ב-localStorage ומניעת קריאות כפולות
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (!db?.families) return; // [תיקון 1]
                const user = [pos.coords.longitude, pos.coords.latitude];
                db.families.forEach(fam => {
                    if (!fam.lng || !fam.lat) return;
                    const famId = fam.id || fam.familyName;
                    const d = calculateDistance(user, [fam.lng, fam.lat]);
                    // [תיקון 3+4] בדיקה מול localStorage במקום דגל זמני
                    if (d < GEOFENCE_M && !isVisited(famId)) {
                        markVisited(famId);
                        triggerArrival(fam);
                    }
                });
            },
            (err) => console.error("Geolocation error:", err),
            { enableHighAccuracy: true }
        );
    }

    // [תיקון 2] פונקציה לעצירת המעקב
    function stopLocationTracking() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
    }

    function triggerArrival(fam) {
        currentTarget = fam;
        map.flyTo({ center: [fam.lng, fam.lat], zoom: 17, pitch: 60, duration: 2000 });

        document.getElementById('fa-name').innerText = `משפחת ${fam.familyName}`;
        document.getElementById('fa-details').innerText = `${fam.address}${fam.apt ? ', דירה ' + fam.apt : ''}`;

        const contactRow = document.getElementById('fa-contact-actions');
        (fam.fatherPhone || fam.motherPhone || fam.phone)
            ? contactRow.classList.remove('hidden')
            : contactRow.classList.add('hidden');

        const badge = document.getElementById('fa-code-badge');
        if (fam.bldgCode) {
            document.getElementById('fa-code-val').innerText = fam.bldgCode;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }

        document.getElementById('f-arrival-sheet').classList.remove('hidden');
        document.getElementById('f-scrim').classList.remove('hidden');
    }

    function calculateDistance(l1, l2) {
        const R = 6371e3;
        const dLat = (l2[1] - l1[1]) * Math.PI / 180;
        const dLon = (l2[0] - l1[0]) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(l1[1] * Math.PI / 180) * Math.cos(l2[1] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // --- תקשורת ותיעוד קולי ---
    function initSpeech() {
        window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (window.SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.lang = 'he-IL';
            recognition.interimResults = true;
            recognition.continuous = true;
            recognition.onresult = (e) => {
                let t = '';
                for (let i = e.resultIndex; i < e.results.length; ++i) {
                    t += e.results[i][0].transcript;
                }
                document.getElementById('f-voice-result').value = t;
            };
            recognition.onerror = (e) => {
                console.error("Speech recognition error:", e.error);
                isRecording = false;
            };
        }
    }

    function toggleVoice() {
        if (!currentTarget) return;
        document.getElementById('f-arrival-sheet').classList.add('hidden');
        document.getElementById('f-voice-sheet').classList.remove('hidden');
        document.getElementById('f-voice-result').value = '';
        // [תיקון 7] הפעלה רק אם לא כבר מקליט
        if (recognition && !isRecording) {
            recognition.start();
            isRecording = true;
        }
    }

    function addQuickText(t) {
        const el = document.getElementById('f-voice-result');
        el.value += (el.value.trim() ? ', ' : '') + t;
    }

    function stopVoiceAndSave() {
        // [תיקון 7] עצירה בטוחה
        if (recognition && isRecording) {
            recognition.stop();
            isRecording = false;
        }
        const text = document.getElementById('f-voice-result').value;
        if (!text.trim()) return;
        saveToOutbox({
            type: 'visit_log',
            familyId: currentTarget?.id || currentTarget?.familyName,
            timestamp: new Date().toISOString(),
            content: text
        });
        closeSheet();
    }

    function saveToOutbox(obj) {
        const o = storageGet(OUTBOX_KEY) || [];
        o.push(obj);
        storageSet(OUTBOX_KEY, o);
        updateOutboxUI();
        showToast("✅ התיעוד נשמר לאופליין!");
    }

    // --- ממשק ושיפורי UI ---
    function openFamilySheet(fam) {
        currentTarget = fam;
        document.getElementById('fs-name').innerText = 'משפחת ' + fam.familyName;
        document.getElementById('fs-address').innerText = fam.address;
        document.getElementById('f-family-sheet').classList.remove('hidden');
        document.getElementById('f-scrim').classList.remove('hidden');
        if (fam.lng && fam.lat) drawRouteTo(fam.lng, fam.lat);
    }

    function closeSheet() {
        // [תיקון 7] עצירת הקלטה בעת סגירה
        if (recognition && isRecording) {
            recognition.stop();
            isRecording = false;
        }
        document.querySelectorAll('.f-sheet').forEach(s => s.classList.add('hidden'));
        document.getElementById('f-scrim').classList.add('hidden');
        if (map.getLayer('route')) {
            map.removeLayer('route');
            map.removeSource('route');
        }
        // סגירת FAB אם פתוח
        if (fabIsOpen) toggleFab();
    }

    function showToast(msg) {
        const container = document.getElementById('f-toast-container');
        if (!container) return;
        const t = document.createElement('div');
        t.className = 'f-toast';
        t.innerHTML = `<i class="fas fa-check-circle"></i> <span>${msg}</span>`;
        container.appendChild(t);
        setTimeout(() => {
            t.style.opacity = '0';
            setTimeout(() => t.remove(), 300);
        }, 3000);
    }

    function updateOutboxUI() {
        const o = storageGet(OUTBOX_KEY) || [];
        const btn = document.getElementById('f-outbox-btn');
        if (!btn) return;
        if (o.length > 0) {
            btn.classList.remove('hidden');
            document.getElementById('f-outbox-count').innerText = o.length;
        } else {
            btn.classList.add('hidden');
        }
    }

    // [תיקון 6] FAB עם ניהול מצב מסודר
    function toggleFab() {
        fabIsOpen = !fabIsOpen;
        document.getElementById('f-fab-options').classList.toggle('hidden', !fabIsOpen);
        document.getElementById('f-fab-main').style.transform = fabIsOpen ? 'rotate(45deg)' : 'rotate(0deg)';
        document.getElementById('f-scrim').classList.toggle('hidden', !fabIsOpen);
    }

    return {
        init,
        continueOffline,
        closeSheet,
        stopLocationTracking,       // [תיקון 2] חשיפה לשימוש חיצוני אם נדרש
        toggleFab,
        startWazeNavigation: () => {
            if (!currentTarget) return;
            window.location.href = `https://waze.com/ul?ll=${currentTarget.lat},${currentTarget.lng}&navigate=yes`;
        },
        callFamily: () => {
            const p = currentTarget?.fatherPhone || currentTarget?.motherPhone || currentTarget?.phone;
            if (p) window.location.href = `tel:${p}`;
        },
        whatsappFamily: () => {
            const p = currentTarget?.fatherPhone || currentTarget?.motherPhone || currentTarget?.phone;
            if (p) {
                const c = p.replace(/\D/g, '');
                window.location.href = `https://wa.me/${c.startsWith('0') ? '972' + c.substring(1) : c}`;
            }
        },
        toggleVoice,
        stopVoiceAndSave,
        cancelVoice: closeSheet,
        addQuickText,
        logVisit: stopVoiceAndSave
    };
})();

window.addEventListener('DOMContentLoaded', () => fieldApp.init());
