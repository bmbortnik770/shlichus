/**
 * field-app.js  —  אפליקציית השטח
 * ============================================================
 * ארכיטקטורה:
 *   - Read-only על community_data_final.json
 *   - כל פעולה נשמרת ב-Outbox (localStorage) ומועלת כקובץ
 *     mobile_update_TIMESTAMP.json ל-Google Drive
 *   - מערכת האם (Desktop) תמזג ותמחק קבצים אלו
 * ============================================================
 */

'use strict';

// ── קבועים ──────────────────────────────────────────────────
const CLIENT_ID   = '348261974014-242r9b0dvctlka7rj3aetu81v96ere46.apps.googleusercontent.com';
const SCOPES      = 'email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
const GEOFENCE_M  = 30;   // מטר לזיהוי הגעה אוטומטי
const OUTBOX_KEY  = 'field_outbox';
const DATA_KEY    = 'field_data';

mapboxgl.accessToken = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';
mapboxgl.setRTLTextPlugin(
    'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js',
    null, true
);

// ── מצב גלובלי ──────────────────────────────────────────────
const fieldApp = (() => {

    let map = null;
    let db  = null;           // הנתונים שנקראו מ-Drive (Read Only)
    let accessToken = null;
    let outbox = [];          // [{ id, type, bldg, aptName, aptNum, payload, timestamp, status }]
    let watchId = null;       // GPS watch ID
    let userPos = null;       // { lat, lng }
    let userMarker = null;
    let navTarget = null;     // { bldg, aptIdx, apt } — יעד ניווט פעיל
    let fabOpen = false;
    let recognition = null;   // SpeechRecognition
    let distInterval = null;

    // ── Utils ──────────────────────────────────────────────

    function esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;');
    }

    function haversineM(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2-lat1) * Math.PI / 180;
        const dLon = (lon2-lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 +
                  Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    function formatDist(m) {
        if (m < 1000) return Math.round(m) + ' מ׳';
        return (m / 1000).toFixed(1) + ' ק״מ';
    }

    function toast(msg, type = 'info', dur = 3000) {
        const c = document.getElementById('f-toast-container');
        const t = document.createElement('div');
        t.className = `f-toast f-toast-${type}`;
        const icons = { success:'check-circle', error:'exclamation-circle', info:'info-circle', warning:'exclamation-triangle' };
        t.innerHTML = `<i class="fas fa-${icons[type] || 'info-circle'}"></i>${esc(msg)}`;
        c.appendChild(t);
        setTimeout(() => {
            t.style.animation = 'none';
            t.style.opacity   = '0';
            t.style.transition = 'opacity .3s';
            setTimeout(() => t.remove(), 350);
        }, dur);
    }

    function haptic(type) {
        if (!navigator.vibrate) return;
        ({ light:()=>navigator.vibrate(28), medium:()=>navigator.vibrate(50),
           success:()=>navigator.vibrate([25,35,25]), error:()=>navigator.vibrate([55,30,55])
        }[type] || (()=>navigator.vibrate(28)))();
    }

    function storageGet(key, def = null) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
        catch(e) { return def; }
    }

    function storageSet(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
    }

    // ── Auth ───────────────────────────────────────────────

    function login() {
        const redirectUri = encodeURIComponent(location.origin + location.pathname);
        const url = [
            'https://accounts.google.com/o/oauth2/v2/auth',
            '?client_id=' + CLIENT_ID,
            '&redirect_uri=' + redirectUri,
            '&response_type=token',
            '&scope=' + encodeURIComponent(SCOPES),
            '&prompt=select_account'
        ].join('');
        location.href = url;
    }

    function checkOAuthHash() {
        const hash = location.hash;
        if (!hash || !hash.includes('access_token')) return false;
        const params = {};
        hash.slice(1).split('&').forEach(p => { const [k,v]=p.split('='); params[k]=decodeURIComponent(v||''); });
        if (!params.access_token) return false;
        accessToken = params.access_token;
        const expiresAt = Date.now() + parseInt(params.expires_in||'3500',10)*1000;
        storageSet('field_session', { token: accessToken, expiresAt });
        history.replaceState(null, '', location.pathname);
        return true;
    }

    function continueOffline() {
        document.getElementById('f-auth').classList.add('hidden');
        const cached = storageGet(DATA_KEY);
        if (cached) { db = cached; buildMap(); afterLoad(); }
        else { toast('אין נתונים שמורים — יש להתחבר לפחות פעם אחת', 'warning'); }
    }

    // ── Drive ──────────────────────────────────────────────

    async function driveGet(path) {
        const res = await fetch('https://www.googleapis.com/drive/v3/' + path,
            { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) throw new Error('Drive ' + res.status);
        return res.json();
    }

    async function drivePatch(fileId, body) {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`,
            { method:'PATCH', headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
        if (!res.ok) throw new Error('Drive PATCH ' + res.status);
        return res.json();
    }

    async function driveUploadJson(name, obj) {
        // Multipart upload
        const meta = JSON.stringify({ name, mimeType: 'application/json' });
        const content = JSON.stringify(obj);
        const boundary = '-------fieldBoundary314159';
        const body = [
            `--${boundary}`,
            'Content-Type: application/json; charset=UTF-8',
            '', meta, '',
            `--${boundary}`,
            'Content-Type: application/json',
            '', content, '',
            `--${boundary}--`
        ].join('\r\n');

        const res = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            { method:'POST', headers:{ Authorization:`Bearer ${accessToken}`,
              'Content-Type':`multipart/related; boundary="${boundary}"`}, body });
        if (!res.ok) throw new Error('Drive upload ' + res.status);
        return res.json();
    }

    async function loadDataFromDrive() {
        try {
            const list = await driveGet("files?q=name%3D'community_data_final.json'%20and%20trashed%3Dfalse&spaces=drive");
            if (!list.files || list.files.length === 0) {
                toast('קובץ נתונים לא נמצא ב-Drive', 'warning');
                const cached = storageGet(DATA_KEY);
                if (cached) { db = cached; return; }
                db = {}; return;
            }
            const fileId = list.files[0].id;
            const res = await fetch(
                `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            db = await res.json();
            storageSet(DATA_KEY, db);  // cache locally for offline use
        } catch(e) {
            console.error('loadDataFromDrive', e);
            const cached = storageGet(DATA_KEY);
            if (cached) { db = cached; toast('שימוש בנתונים מקומיים (אופליין)', 'warning'); }
            else { db = {}; toast('שגיאת טעינה', 'error'); }
        }
    }

    // ── Outbox ─────────────────────────────────────────────

    function loadOutbox() { outbox = storageGet(OUTBOX_KEY, []); updateOutboxBadge(); }
    function saveOutbox() { storageSet(OUTBOX_KEY, outbox); updateOutboxBadge(); }

    function updateOutboxBadge() {
        const pending = outbox.filter(e => e.status !== 'sent').length;
        const badge = document.getElementById('f-outbox-badge');
        if (!badge) return;
        if (pending > 0) { badge.textContent = pending; badge.classList.remove('hidden'); }
        else { badge.classList.add('hidden'); }
    }

    function addToOutbox(type, bldg, apt, payload) {
        const ev = {
            id: 'field_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
            type, bldg,
            aptName: apt.name,
            aptNum:  String(apt.num || ''),
            payload,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };
        outbox.push(ev);
        saveOutbox();
        uploadOutboxEvent(ev);   // נסה להעלות מיד
        return ev;
    }

    async function uploadOutboxEvent(ev) {
        if (!accessToken || ev.status === 'sent') return;
        try {
            const fileName = `mobile_update_${ev.id}.json`;
            await driveUploadJson(fileName, ev);
            ev.status = 'sent';
            saveOutbox();
            renderOutboxSheet();
        } catch(e) {
            console.warn('uploadOutboxEvent failed, stays in outbox:', e.message);
        }
    }

    async function flushOutbox() {
        const pending = outbox.filter(e => e.status !== 'sent');
        if (pending.length === 0) { toast('אין עדכונים ממתינים', 'info'); return; }
        toast(`מעלה ${pending.length} עדכונים...`, 'info');
        let sent = 0;
        for (const ev of pending) {
            await uploadOutboxEvent(ev);
            if (ev.status === 'sent') sent++;
        }
        toast(`${sent} עדכונים הועלו בהצלחה`, 'success');
        haptic('success');
    }

    // ── Map ────────────────────────────────────────────────

    function buildMap() {
        const saved = storageGet('field_map_state', { center: [35.2130, 31.7683], zoom: 13 });
        map = new mapboxgl.Map({
            container: 'f-map',
            style: 'mapbox://styles/mapbox/streets-v12',
            center: saved.center,
            zoom: saved.zoom,
            pitch: 0, bearing: 0,
            antialias: true
        });

        map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
        map.addControl(new mapboxgl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true,
            showUserHeading: true
        }), 'bottom-right');

        map.on('load', () => { plotFamilyMarkers(); });
        map.on('moveend', () => {
            storageSet('field_map_state', { center: map.getCenter().toArray(), zoom: map.getZoom() });
        });
    }

    function plotFamilyMarkers() {
        if (!db) return;
        const NO_ADDR = '__NO_ADDRESS__';
        Object.keys(db).forEach(bldg => {
            if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta' || bldg === NO_ADDR) return;
            const bData = db[bldg];
            if (!bData || !bData.info || !bData.info.coords) return;
            const [lng, lat] = bData.info.coords;

            // ספור משפחות + משימות פתוחות
            const apts = bData.apts || [];
            const openTasks = apts.reduce((n, a) => n + (a.tasks || []).filter(t => !t.done).length, 0);

            const el = document.createElement('div');
            el.className = 'f-marker';
            el.style.cssText = `
                width:36px; height:36px; border-radius:50%;
                background:${openTasks > 0 ? '#f59e0b' : '#2563eb'};
                border:3px solid #fff;
                box-shadow:0 3px 10px rgba(0,0,0,.3);
                display:flex; align-items:center; justify-content:center;
                color:#fff; font-size:13px; font-weight:800;
                cursor:pointer; user-select:none;
            `;
            el.textContent = apts.length;

            const marker = new mapboxgl.Marker({ element: el })
                .setLngLat([lng, lat])
                .addTo(map);

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                // אם יש דירה אחת — פתח ישירות
                if (apts.length === 1) {
                    openArrivalSheet({ bldg, aptIdx: 0, apt: apts[0] }, false);
                } else {
                    showBuildingPicker(bldg, apts);
                }
            });
        });
    }

    function showBuildingPicker(bldg, apts) {
        // Sheet פשוט עם רשימת הדירות
        const sheet = document.getElementById('f-arrival-sheet');
        sheet.classList.remove('hidden');
        document.getElementById('f-arrival-name').textContent = bldg;
        document.getElementById('f-arrival-addr').textContent = `${apts.length} משפחות בבניין`;
        document.getElementById('f-arrival-entry-code').classList.add('hidden');
        document.getElementById('f-arrival-tasks').classList.add('hidden');

        const qa = sheet.querySelector('.f-quick-actions');
        const noteSection = sheet.querySelector('.f-note-section');
        const manualBtn = sheet.querySelector('.f-manual-arrive');
        qa.innerHTML = apts.map((a, i) => `
            <button class="f-qa-btn" style="background:#2563eb; grid-column: span 2;" 
                    onclick="fieldApp.selectApt('${esc(bldg)}', ${i})">
                <i class="fas fa-door-open"></i>
                <span>${esc(a.name || 'ללא שם')} ${a.num ? '• דירה ' + a.num : ''}</span>
            </button>
        `).join('');
        noteSection.style.display = 'none';
        if (manualBtn) manualBtn.classList.remove('visible');
    }

    // ── Navigation ─────────────────────────────────────────

    function startNav(target) {
        navTarget = target;
        document.getElementById('f-hud').classList.remove('hidden');
        document.getElementById('f-hud-name').textContent = target.apt.name || target.bldg;

        // 3D pitch mode
        map.easeTo({ pitch: 60, zoom: 17, duration: 800 });

        // GPS tracking
        startGPS();

        // show manual "הגעתי" button
        const btn = document.getElementById('f-arrival-sheet').querySelector('.f-manual-arrive');
        if (btn) btn.classList.add('visible');

        // update distance every 3s
        distInterval = setInterval(() => updateHUDDistance(), 3000);
        updateHUDDistance();
    }

    function cancelNav() {
        navTarget = null;
        document.getElementById('f-hud').classList.add('hidden');
        map.easeTo({ pitch: 0, zoom: 14, duration: 600 });
        clearInterval(distInterval);
        closeSheet('f-arrival-sheet');
        document.getElementById('f-topbar-title').textContent = 'מפת קהילה';
    }

    function updateHUDDistance() {
        if (!navTarget || !userPos) { document.getElementById('f-hud-dist').textContent = '—'; return; }
        const bData = db[navTarget.bldg];
        if (!bData || !bData.info || !bData.info.coords) return;
        const [lng, lat] = bData.info.coords;
        const dist = haversineM(userPos.lat, userPos.lng, lat, lng);
        document.getElementById('f-hud-dist').textContent = formatDist(dist);
        document.getElementById('f-topbar-title').textContent = esc(navTarget.apt.name || navTarget.bldg);

        // Geofence
        if (dist <= GEOFENCE_M) {
            clearInterval(distInterval);
            haptic('success');
            openArrivalSheet(navTarget, true);
        }
    }

    // ── GPS ────────────────────────────────────────────────

    function startGPS() {
        if (!navigator.geolocation) return;
        if (watchId !== null) return;
        watchId = navigator.geolocation.watchPosition(pos => {
            userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            updateHUDDistance();
        }, null, { enableHighAccuracy: true, maximumAge: 5000 });
    }

    function stopGPS() {
        if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    }

    // ── Arrival Sheet ──────────────────────────────────────

    function openArrivalSheet(target, autoTriggered = false) {
        navTarget = target;
        const apt = target.apt;
        const bData = db[target.bldg] || {};

        const sheet = document.getElementById('f-arrival-sheet');
        sheet.classList.remove('hidden');

        // כותרת
        document.getElementById('f-arrival-name').textContent = apt.name || '(ללא שם)';
        document.getElementById('f-arrival-addr').textContent =
            target.bldg === '__NO_ADDRESS__' ? '' : target.bldg + (apt.num ? ` דירה ${apt.num}` : '');

        // קוד כניסה
        const entryCode = bData.info && bData.info.code ? String(bData.info.code) : '';
        const codeEl = document.getElementById('f-arrival-entry-code');
        if (entryCode) {
            document.getElementById('f-entry-code-text').textContent = `קוד כניסה: ${entryCode}`;
            codeEl.classList.remove('hidden');
        } else {
            codeEl.classList.add('hidden');
        }

        // משימות פתוחות
        const openTasks = (apt.tasks || []).filter(t => !t.done);
        const tasksSection = document.getElementById('f-arrival-tasks');
        if (openTasks.length > 0) {
            tasksSection.classList.remove('hidden');
            const list = document.getElementById('f-tasks-list');
            list.innerHTML = openTasks.map((task, i) => `
                <div class="f-task-item" id="f-task-${i}">
                    <input type="checkbox" onchange="fieldApp.toggleTask(${i}, this.checked)">
                    <span>${esc(task.text)}</span>
                </div>
            `).join('');
        } else {
            tasksSection.classList.add('hidden');
        }

        // restore quick actions to default
        const qa = sheet.querySelector('.f-quick-actions');
        qa.innerHTML = `
            <button class="f-qa-btn f-qa-done"        onclick="fieldApp.quickAction('done')">
                <i class="fas fa-check-circle"></i><span>בוצע</span>
            </button>
            <button class="f-qa-btn f-qa-later"       onclick="fieldApp.quickAction('no_answer')">
                <i class="fas fa-clock"></i><span>אין מענה</span>
            </button>
            <button class="f-qa-btn f-qa-no"          onclick="fieldApp.quickAction('not_interested')">
                <i class="fas fa-hand-paper"></i><span>לא מעוניינים</span>
            </button>
            <button class="f-qa-btn f-qa-irrelevant"  onclick="fieldApp.quickAction('not_relevant')">
                <i class="fas fa-ban"></i><span>לא רלוונטי</span>
            </button>
        `;
        sheet.querySelector('.f-note-section').style.display = '';

        // clear previous note
        document.getElementById('f-note-input').value = '';

        if (autoTriggered) {
            haptic('success');
            toast('הגעת ל-' + (apt.name || target.bldg) + '!', 'success');
        }
    }

    function selectApt(bldg, aptIdx) {
        const apt = db[bldg].apts[aptIdx];
        openArrivalSheet({ bldg, aptIdx, apt }, false);
    }

    // ── Quick Actions ──────────────────────────────────────

    function quickAction(result) {
        if (!navTarget) return;
        const note = (document.getElementById('f-note-input').value || '').trim();

        addToOutbox('visit_log', navTarget.bldg, navTarget.apt, { note, result });
        haptic('success');
        toast(resultLabel(result), 'success');
        closeSheet('f-arrival-sheet');
        cancelNav();
    }

    function resultLabel(r) {
        return ({ done:'✅ תויג כבוצע', no_answer:'⏰ יחזרו מאוחר יותר',
                  not_interested:'🙅 לא מעוניינים', not_relevant:'🚫 לא רלוונטי' })[r] || r;
    }

    function toggleTask(taskIdx, checked) {
        if (!navTarget) return;
        const openTasks = (navTarget.apt.tasks || []).filter(t => !t.done);
        const task = openTasks[taskIdx];
        if (!task) return;
        if (checked) {
            addToOutbox('task_done', navTarget.bldg, navTarget.apt, { taskText: task.text });
            const el = document.getElementById(`f-task-${taskIdx}`);
            if (el) el.classList.add('done');
            haptic('light');
        }
    }

    // ── Voice ──────────────────────────────────────────────

    function toggleVoice() {
        const btn = document.getElementById('f-voice-btn');
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRec) { toast('הדפדפן אינו תומך בהקלטה קולית', 'warning'); return; }

        if (recognition && recognition._running) {
            recognition.stop();
            return;
        }

        recognition = new SpeechRec();
        recognition.lang = 'he-IL';
        recognition.interimResults = false;
        recognition._running = true;

        recognition.onstart = () => { btn.classList.add('recording'); };
        recognition.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            const inp = document.getElementById('f-note-input');
            inp.value = (inp.value ? inp.value + ' ' : '') + transcript;
        };
        recognition.onerror = (e) => {
            toast('שגיאת הקלטה: ' + e.error, 'error');
        };
        recognition.onend = () => {
            btn.classList.remove('recording');
            recognition._running = false;
        };
        recognition.start();
    }

    // ── Search ─────────────────────────────────────────────

    function openSearch() {
        const sheet = document.getElementById('f-search-sheet');
        sheet.classList.remove('hidden');
        setTimeout(() => document.getElementById('f-search-input').focus(), 200);
    }

    function closeSearch() {
        document.getElementById('f-search-sheet').classList.add('hidden');
        document.getElementById('f-search-input').value = '';
        document.getElementById('f-search-results').innerHTML = '';
    }

    function handleSearch(q) {
        const container = document.getElementById('f-search-results');
        if (!q || q.length < 2) { container.innerHTML = ''; return; }

        const results = [];
        const NO_ADDR = '__NO_ADDRESS__';
        if (!db) return;

        Object.keys(db).forEach(bldg => {
            if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
            const bData = db[bldg];
            if (!bData || !bData.apts) return;
            bData.apts.forEach((apt, aptIdx) => {
                const hay = [apt.name, apt.father, apt.mother, apt.fatherPhone,
                             apt.motherPhone, bldg].filter(Boolean).join(' ').toLowerCase();
                if (hay.includes(q.toLowerCase())) {
                    results.push({ bldg, aptIdx, apt });
                }
            });
        });

        if (results.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b;">אין תוצאות</div>';
            return;
        }

        container.innerHTML = results.slice(0, 30).map(r => `
            <div class="f-search-item" onclick="fieldApp.searchSelect('${encodeURIComponent(r.bldg)}', ${r.aptIdx})">
                <div class="f-search-icon"><i class="fas fa-users"></i></div>
                <div class="f-search-info">
                    <div class="f-search-name">${esc(r.apt.name || '(ללא שם)')}</div>
                    <div class="f-search-addr">${esc(r.bldg === NO_ADDR ? 'ללא כתובת' : r.bldg)}</div>
                </div>
                <i class="fas fa-chevron-left" style="color:#94a3b8; font-size:14px;"></i>
            </div>
        `).join('');
    }

    function searchSelect(encBldg, aptIdx) {
        const bldg = decodeURIComponent(encBldg);
        const apt  = db[bldg].apts[aptIdx];
        closeSearch();

        // עוף למיקום
        const bData = db[bldg];
        if (bData && bData.info && bData.info.coords) {
            map.flyTo({ center: bData.info.coords, zoom: 18, pitch: 60, duration: 900 });
        }

        // פתח arrival sheet
        openArrivalSheet({ bldg, aptIdx, apt }, false);

        // הצע ניווט
        setTimeout(() => {
            if (bData && bData.info && bData.info.coords) {
                startNav({ bldg, aptIdx, apt });
            }
        }, 500);
    }

    // ── Outbox Sheet ───────────────────────────────────────

    function openOutboxStatus() {
        renderOutboxSheet();
        document.getElementById('f-outbox-sheet').classList.remove('hidden');
    }

    function renderOutboxSheet() {
        const list = document.getElementById('f-outbox-list');
        if (!list) return;
        if (outbox.length === 0) {
            list.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b;">תור ריק — אין עדכונים ממתינים</div>';
            return;
        }
        const typeLabel = { visit_log:'ביקור', call_log:'שיחה', task_done:'משימה', stage_change:'שלב', quick_status:'סטטוס' };
        list.innerHTML = outbox.map(ev => `
            <div class="f-outbox-item">
                <i class="fas fa-${ev.type === 'visit_log' ? 'walking' : ev.type === 'task_done' ? 'check' : 'pen'}"></i>
                <div>
                    <div class="f-ob-name">${esc(ev.aptName || ev.bldg)}</div>
                    <div style="font-size:12px; color:#64748b;">${typeLabel[ev.type] || ev.type} • ${ev.timestamp.split('T')[0]}</div>
                </div>
                <span class="f-ob-status ${ev.status === 'sent' ? 'sent' : ''}">${ev.status === 'sent' ? 'נשלח ✓' : 'ממתין'}</span>
            </div>
        `).join('');
    }

    // ── FAB ────────────────────────────────────────────────

    function toggleFab() {
        fabOpen = !fabOpen;
        document.getElementById('f-fab-backdrop').classList.toggle('hidden', !fabOpen);
        document.getElementById('f-fab-dial').classList.toggle('hidden', !fabOpen);
        document.getElementById('f-fab').classList.toggle('open', fabOpen);
    }

    function closeFab() {
        fabOpen = false;
        document.getElementById('f-fab-backdrop').classList.add('hidden');
        document.getElementById('f-fab-dial').classList.add('hidden');
        document.getElementById('f-fab').classList.remove('open');
    }

    function fabAction(type) {
        closeFab();
        if (type === 'family') {
            openSheet('f-new-family-sheet');
        } else if (type === 'task') {
            toast('פתח כרטיס משפחה מהמפה ורשום משימה', 'info');
        } else if (type === 'log') {
            // תיעוד מהיר ללא יעד ספציפי
            toast('סמן משפחה על המפה לתיעוד', 'info');
        }
    }

    // ── New Family ─────────────────────────────────────────

    function submitNewFamily() {
        const name    = document.getElementById('f-nf-name').value.trim();
        const address = document.getElementById('f-nf-address').value.trim();
        const num     = document.getElementById('f-nf-num').value.trim();
        const phone   = document.getElementById('f-nf-phone').value.trim();
        const notes   = document.getElementById('f-nf-notes').value.trim();

        if (!name) { toast('יש להזין שם משפחה', 'warning'); return; }

        const bldg = address || '__NO_ADDRESS__';
        const fakeApt = { name, num: num || '' };

        addToOutbox('new_family', bldg, fakeApt, { name, address, num, phone, notes });
        toast('המשפחה נשמרה בתור לסנכרון', 'success');
        haptic('success');
        closeSheet('f-new-family-sheet');

        // ניקוי טופס
        ['f-nf-name','f-nf-address','f-nf-num','f-nf-phone','f-nf-notes'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }

    // ── Sheet helpers ──────────────────────────────────────

    function openSheet(id)  { document.getElementById(id).classList.remove('hidden'); }
    function closeSheet(id) { document.getElementById(id).classList.add('hidden'); }

    // ── Init ───────────────────────────────────────────────

    function afterLoad() {
        loadOutbox();
        buildMap();
        startGPS();

        // Search input listener
        document.getElementById('f-search-input').addEventListener('input', function() {
            handleSearch(this.value.trim());
        });

        // Service Worker registration
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('field-sw.js').catch(() => {});
        }
    }

    async function init() {
        // 1. בדוק OAuth redirect
        const fromOAuth = checkOAuthHash();

        // 2. בדוק session שמור
        const session = storageGet('field_session');
        const tokenValid = session && session.token && session.expiresAt > Date.now();

        if (fromOAuth || tokenValid) {
            if (fromOAuth && !tokenValid) {
                // token just arrived via redirect, already saved
            } else if (tokenValid) {
                accessToken = session.token;
            }
            // Try loading from Drive
            document.getElementById('f-auth').classList.add('hidden');
            await loadDataFromDrive();
            afterLoad();
        } else {
            // No valid token — show auth screen
            const cached = storageGet(DATA_KEY);
            if (cached) {
                // Offer offline with cached data
                db = cached;
            }
            document.getElementById('f-splash').style.opacity = '0';
            setTimeout(() => {
                document.getElementById('f-splash').classList.add('hidden');
                document.getElementById('f-auth').style.display = 'flex';
            }, 400);
            return;
        }

        // Fade out splash
        document.getElementById('f-splash').style.opacity = '0';
        setTimeout(() => document.getElementById('f-splash').classList.add('hidden'), 500);
    }

    // Public API
    return {
        init,
        login,
        continueOffline,
        openSearch,
        closeSearch,
        openArrivalSheet,
        selectApt,
        quickAction,
        toggleTask,
        toggleVoice,
        cancelNav,
        openOutboxStatus,
        flushOutbox,
        toggleFab,
        closeFab,
        fabAction,
        submitNewFamily,
        closeSheet,
        openSheet,
        currentTarget: null,  // used by manual "הגעתי" button
        get navTarget() { return navTarget; }
    };
})();

// ── Boot ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => fieldApp.init());
