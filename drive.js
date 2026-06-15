// ── מבנה תיקיות Google Drive ──────────────────────────────────
const ROOT_FOLDER_NAME = 'השליחות שלי';
let rootFolderId        = localStorage.getItem('drive_root_folder_id') || null;
let fieldUpdatesFolderId = localStorage.getItem('drive_field_updates_folder_id') || null;
let whatsappFolderId    = localStorage.getItem('drive_whatsapp_folder_id') || null;
let backupsFolderId     = localStorage.getItem('drive_backups_folder_id') || null;

async function ensureSubfolder(name, parentId, storageKey) {
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;
    const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const { files } = await res.json();
    let folderId;
    if (files && files.length > 0) {
        folderId = files[0].id;
    } else {
        const create = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
        });
        folderId = (await create.json()).id;
    }
    localStorage.setItem(storageKey, folderId);
    return folderId;
}

async function ensureFolderStructure() {
    if (!rootFolderId) {
        const q = encodeURIComponent(`name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const { files } = await res.json();
        if (files && files.length > 0) {
            rootFolderId = files[0].id;
        } else {
            const create = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
            });
            rootFolderId = (await create.json()).id;
        }
        localStorage.setItem('drive_root_folder_id', rootFolderId);
    }
    fieldUpdatesFolderId = await ensureSubfolder('field-updates', rootFolderId, 'drive_field_updates_folder_id');
    whatsappFolderId     = await ensureSubfolder('whatsapp-agent', rootFolderId, 'drive_whatsapp_folder_id');
    backupsFolderId      = await ensureSubfolder('backups', rootFolderId, 'drive_backups_folder_id');
    // חשוף את ה-ID של field-updates לאפליקציית השטח
    localStorage.setItem('drive_field_updates_folder_id', fieldUpdatesFolderId);
}
// ─────────────────────────────────────────────────────────────

function handleAuth(resp) {
    // Legacy handler — only called if GIS SDK popup somehow fires
    if (!resp || !resp.access_token) return;
    accessToken = resp.access_token;
    const expiresAt = Date.now() + 3500000;
    localStorage.setItem('gdrive_session', JSON.stringify({ token: accessToken, expiresAt }));
    scheduleTokenRefresh();
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.style.display = 'none';
    syncWithDrive();
}
window.logout = async function() {
    const proceed = await showCustomDialog({ title: 'התנתקות', message: 'האם אתה בטוח שברצונך להתנתק מהחשבון?', showCancel: true });
    if (proceed) {
        localStorage.removeItem('gdrive_session');
        localStorage.removeItem('crm_logged_in');
        if (window.tokenClient && accessToken) {
            try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch(e) {}
        }
        location.reload();
    }
};

window.continueWithoutLogin = function() {
    // סגור את מסך ההתחברות — מצב מקומי בלבד (ללא גיבוי ענן)
    const authOverlay = document.getElementById('auth-overlay');
    const splashScreen = document.getElementById('splash-screen');
    if(authOverlay) authOverlay.style.display = 'none';
    if(splashScreen) { splashScreen.style.display = 'flex'; }
    // הצג הודעה קצרה שמסבירה למשתמש את המצב
    setTimeout(() => {
        if(splashScreen) {
            splashScreen.style.opacity = '0';
            setTimeout(() => { if(splashScreen) splashScreen.style.display = 'none'; }, 600);
        }
        showToast('פועל במצב מקומי — הנתונים נשמרים רק במכשיר זה', 'warning');
    }, 800);
    // עדכן סטטוס סנכרון
    const syncStatus = document.getElementById('sync-status');
    const syncText = document.getElementById('sync-text');
    const syncIcon = document.getElementById('sync-icon');
    if(syncText) syncText.innerText = 'מצב מקומי';
    if(syncIcon) syncIcon.className = 'fas fa-laptop';
    if(syncStatus) syncStatus.style.color = 'var(--text-muted)';
};
async function ensureAuthAndExecute(cb) {
    const session = JSON.parse(localStorage.getItem('gdrive_session') || 'null');
    const isValid = session && session.token && session.expiresAt > (Date.now() + 60000);
    if (isValid) {
        cb();
    } else if (window.tokenClient) {
        showToast('מחדש חיבור לענן...', 'info');
        window._pendingAuthCallback = cb;
        window.tokenClient.requestAccessToken({ prompt: '' });
    } else {
        showToast('יש להתחבר מחדש', 'warning');
        window.handleGoogleLogin();
    }
}

async function geocodeMissingAddresses() {
    const bldgs = Object.keys(db).filter(k => k !== '__BOARDS__' && k !== '__SETTINGS__' && k !== NO_ADDRESS_KEY && k !== 'meta' && db[k] && db[k].info && (!db[k].info.coords || isNaN(db[k].info.coords[0])));
    if(bldgs.length === 0) return;
    showToast(`מתבצע עדכון מיקומים ברקע (${bldgs.length} בניינים)...`, "info");

    // proximity לפי מרכז האזור המוגדר — מבטיח תוצאות מאזורנו בלבד
    const homeCoords = appSettings.homeLocation?.coords || appSettings.center || null;
    const proximityParam = homeCoords
        ? `&proximity=${homeCoords[0]},${homeCoords[1]}`
        : '';
    // bbox צר סביב הבית (רדיוס ~5 ק"מ) למניעת תוצאות מרוחקות
    const bboxParam = homeCoords
        ? `&bbox=${homeCoords[0]-0.07},${homeCoords[1]-0.05},${homeCoords[0]+0.07},${homeCoords[1]+0.05}`
        : '';

    let updated = false;
    for(let b of bldgs) {
        try {
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(b)}.json?country=il&language=he${proximityParam}${bboxParam}&access_token=${mapboxgl.accessToken}`;
            const r = await fetch(url);
            if(r.status === 429) {
                await new Promise(res => setTimeout(res, 4000));
                continue;
            }
            const d = await r.json();
            if(d.features && d.features.length > 0) {
                db[b].info.coords = d.features[0].center;
                db[b].info._coordSource = 'mapbox';
                updated = true;
            }
        } catch(e) { console.error("Geocode Error", e); }
        await new Promise(res => setTimeout(res, 250));
    }
    if(updated) { saveDB(); refreshMap(); }
}

// ── תיקון מיקומים — geocode מחדש לכל הבניינים עם proximity נכון ──
window.regeocodeAllBuildings = async function() {
    const bldgs = Object.keys(db).filter(k =>
        k !== '__BOARDS__' && k !== '__SETTINGS__' && k !== NO_ADDRESS_KEY && k !== 'meta'
        && db[k] && db[k].info
    );
    if(bldgs.length === 0) { showToast('אין בניינים לעדכון', 'info'); return; }
    showToast(`מתקן מיקומים של ${bldgs.length} בניינים... זה ייקח כחצי דקה`, 'info');

    const homeCoords = appSettings.homeLocation?.coords || appSettings.center || null;
    const proximityParam = homeCoords ? `&proximity=${homeCoords[0]},${homeCoords[1]}` : '';
    const bboxParam = homeCoords
        ? `&bbox=${homeCoords[0]-0.07},${homeCoords[1]-0.05},${homeCoords[0]+0.07},${homeCoords[1]+0.05}`
        : '';

    let updated = 0, failed = 0;
    for(let b of bldgs) {
        try {
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(b)}.json?country=il&language=he${proximityParam}${bboxParam}&access_token=${mapboxgl.accessToken}`;
            const r = await fetch(url);
            if(r.status === 429) { await new Promise(res => setTimeout(res, 5000)); continue; }
            const d = await r.json();
            if(d.features && d.features.length > 0) {
                db[b].info.coords = d.features[0].center;
                db[b].info._coordSource = 'mapbox';
                updated++;
            } else {
                failed++;
            }
        } catch(e) { failed++; }
        await new Promise(res => setTimeout(res, 300));
    }
    saveDB();
    refreshMap();
    showToast(`✅ תוקנו ${updated} מיקומים${failed > 0 ? ` (${failed} לא נמצאו)` : ''}`, 'success');
};

// ── תקן קואורדינטות שה-GIS דרס — החזר geocoding מ-Mapbox ──────
window.fixOverwrittenCoords = async () => {
    showToast('מתקן מיקומים... זה ייקח כמה שניות', 'info');
    // מחק את כל הקואורדינטות שהגיעו מה-GIS (לא מ-Mapbox)
    let fixed = 0;
    for(const k of Object.keys(db)) {
        if(k==='__BOARDS__'||k==='meta'||k===NO_ADDRESS_KEY||k==='__SETTINGS__') continue;
        if(db[k].info?._coordSource !== 'mapbox') {
            // אפס קואורדינטות כדי ש-geocodeMissingAddresses יחשב מחדש
            db[k].info.coords = null;
            fixed++;
        }
    }
    await geocodeMissingAddresses();
    try { renderGISBuildingLayer(); } catch(e) {} // GIS layer הוקפא — מוגן עד לבנייה מחדש
    showToast(`✓ תוקנו ${fixed} מיקומים`, 'success');
};

// merge חכם — מאחד נתונים מקומיים וענן לפי מבנה הקיים
function mergeDB(local, remote) {
    if(!remote) return local;
    if(!local) return remote;
    const result = JSON.parse(JSON.stringify(local));

    Object.keys(remote).forEach(k => {
        // דלג על מפתחות מיוחדים
        if(k === '__BOARDS__' || k === '__SETTINGS__' || k === 'meta') return;

        if(!result[k]) {
            // בניין חדש שלא קיים לוקאלית — קח מהענן
            result[k] = remote[k];
            return;
        }

        // בניין קיים בשניהם — מזג דירות לפי שם+מספר
        const localApts = result[k].apts || [];
        const remoteApts = remote[k].apts || [];
        const map = new Map();

        localApts.forEach(a => {
            map.set(`${a.name}_${a.num}`, a);
        });
        remoteApts.forEach(a => {
            const key = `${a.name}_${a.num}`;
            if(!map.has(key)) {
                map.set(key, a);
            } else {
                const existing = map.get(key);
                const localTime = existing.updatedAt || 0;
                const remoteTime = a.updatedAt || 0;
                // קח את הגרסה החדשה יותר
                if(remoteTime > localTime) map.set(key, a);
            }
        });
        result[k].apts = Array.from(map.values());
    });

    if(!result.meta) result.meta = {};
    result.meta.lastModified = Math.max(
        local.meta?.lastModified || 0,
        remote.meta?.lastModified || 0
    );
    return result;
}

// ── Auto-refresh token silently using GIS tokenClient ──
function scheduleTokenRefresh() {
    const session = JSON.parse(localStorage.getItem('gdrive_session') || 'null');
    if (!session) return;
    const msUntilExpiry = session.expiresAt - Date.now();
    if (msUntilExpiry <= 0) return;
    // Silent refresh 5 minutes before expiry (minimum 30 seconds from now)
    const refreshIn = Math.max(msUntilExpiry - 300000, 30000);
    setTimeout(() => {
        if (!accessToken) return;
        if (window.tokenClient) {
            window.tokenClient.requestAccessToken({ prompt: '' });
        } else {
            setSyncStatus('error', 'פג תוקף');
            showToast('חיבור Google פג — לחץ "סנכרן" לחידוש', 'warning');
        }
    }, refreshIn);
}

async function syncWithDrive(forcePull = false) {
    setSyncStatus('wait', 'שואב...');
    try {
        await ensureFolderStructure();
        const parentQ = rootFolderId ? ` and '${rootFolderId}' in parents` : '';
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name='community_data_final.json'${parentQ}`)}&spaces=drive`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                localStorage.removeItem('gdrive_session');
                accessToken = null;
                if (window.tokenClient) {
                    // Silent token refresh — no redirect or user interaction needed
                    setSyncStatus('wait', 'מחדש חיבור...');
                    window._pendingAuthCallback = () => syncWithDrive(forcePull);
                    window.tokenClient.requestAccessToken({ prompt: '' });
                } else {
                    setSyncStatus('error', 'פג תוקף — יש להתחבר מחדש');
                    showToast('חיבור Google פג — לחץ "סנכרן" לחידוש', 'warning');
                }
                return;
            }
            throw new Error('Drive API error: ' + res.status);
        }
        const list = await res.json();
        if (list.files && list.files.length > 0) {
            driveFileId = list.files[0].id;
            const content = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
            const remote = await content.json();
            if(Object.keys(remote).length > 0) {
                const remoteTime = remote.meta?.lastModified || 0;
                const localTime = db.meta?.lastModified || 0;

                // Count real data entries in local vs remote
                const countFamilies = (d) => Object.keys(d).filter(k => k !== '__BOARDS__' && k !== '__SETTINGS__' && k !== 'meta' && d[k]?.apts?.length > 0).reduce((s, k) => s + d[k].apts.length, 0);
                const localFamilies = countFamilies(db);
                const remoteFamilies = countFamilies(remote);

                // Force pull if: explicitly requested, local is empty, or remote has significantly more data
                if(forcePull || localFamilies === 0 || remoteFamilies > localFamilies * 1.5) {
                    db = remote;
                    showToast(`נטענו ${remoteFamilies} משפחות מהענן! ✅`, 'success');
                } else if(remoteTime > localTime) {
                    db = mergeDB(db, remote);
                } else if(localTime > remoteTime) {
                    await pushToDrive();
                } else {
                    db = mergeDB(db, remote);
                }

                if(db['__SETTINGS__']) {
                    appSettings = db['__SETTINGS__'];
                    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
                    document.documentElement.style.setProperty('--accent', appSettings.themeColor);
                    populateFilterDropdowns();
                }
            }
        } else {
            const createMeta = { name: 'community_data_final.json', mimeType: 'application/json' };
            if (rootFolderId) createMeta.parents = [rootFolderId];
            const create = await fetch('https://www.googleapis.com/drive/v3/files', { method:'POST', headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'}, body:JSON.stringify(createMeta) });
            driveFileId = (await create.json()).id;
            await pushToDrive();
        }
        if(!db[NO_ADDRESS_KEY]) db[NO_ADDRESS_KEY] = { info: {code:'',rep:'',notes:'',coords:null}, apts:[] };
        if(!db['__BOARDS__']) db['__BOARDS__'] = [{ id: 'b_default', name: 'לוח מעקב כללי', columns: ['מתעניין חדש', 'בטיפול', 'פעיל קבוע', 'לא רלוונטי'], archived: false }];
        if(!db.meta) db.meta = { lastModified: 0 };
        saveLocal();
        setSyncStatus('ok', 'מסונכרן');
        // ── after main sync, absorb any field updates written by the mobile app ──
        await mergeOutboxUpdates();
        // ── בדוק התראות אירועים קרובים ──
        setTimeout(checkStartupAlerts, 1500);
    } catch(e) {
        console.error('sync error', e);
        const msg = e?.message || String(e);
        if (msg.includes('401') || msg.includes('403') || msg.includes('invalid_token')) {
            setSyncStatus('error', 'פג תוקף');
            showToast('חיבור Google פג — לחץ "סנכרן" להתחבר מחדש', 'warning');
        } else if (msg.includes('Drive API error')) {
            setSyncStatus('error', 'שגיאת API');
            showToast('שגיאת Drive: ' + msg + ' — נסה להתנתק ולהתחבר שוב', 'error');
        } else {
            setSyncStatus('error', 'שגיאה');
            showToast('שגיאת סנכרון: ' + msg, 'error');
        }
    }

    document.getElementById('splash-screen').style.opacity='0'; 
    setTimeout(() => { 
        document.getElementById('splash-screen').style.display='none'; 
        map.resize();
        if(appSettings.homeLocation && appSettings.homeLocation.coords) {
            map.flyTo({ center: appSettings.homeLocation.coords, zoom: appSettings.zoom || 17.5, pitch: appSettings.pitch || 60, duration: 1200 });
        } else if(appSettings.center) {
            map.flyTo({ center: appSettings.center, zoom: appSettings.zoom || 17.5, pitch: appSettings.pitch || 60, duration: 1200 });
        }
        handleOmniSearch(); 
        updateHomeButton();
        const obModal = document.getElementById('onboardingModal');
        if(!appSettings.homeLocation && obModal) obModal.style.display = 'flex';
        geocodeMissingAddresses();
        if(appSettings.territory && appSettings.territory.polygon) renderTerritoryOnMap();
        updateCoverageStats();
        updateTerritoryStatsDisplay();
        try { renderGISBuildingLayer(); } catch(e) {}
    }, 800);
}


// ════════════════════════════════════════════════════════
// ── Outbox Consumer (שלב 2) ──
// מחפש קבצי mobile_update_*.json ב-Drive, ממזג אותם
// לתוך community_data_final.json, ואז מוחק (trash) אותם.
// ════════════════════════════════════════════════════════

// מצב גלובלי של עדכוני שטח ממתינים
let pendingFieldUpdateFiles = []; // { fileId, filename, events, deviceId, createdAt }
let _fieldUpdatesSessionHandled = false; // מניעת הצגה חוזרת באותה סשן

async function mergeOutboxUpdates() {
    if (!accessToken) return;
    // מאפשר טריגר ידני לעקוף את דגל הסשן
    if (_fieldUpdatesSessionHandled && !window._fieldUpdatesManualTrigger) return;
    try {
        const folderFilter = fieldUpdatesFolderId ? ` and '${fieldUpdatesFolderId}' in parents` : '';
        const q = encodeURIComponent(`name contains 'mobile_update_' and trashed = false${folderFilter}`);
        const listRes = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,createdTime)&orderBy=createdTime`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!listRes.ok) return;
        const { files } = await listRes.json();

        // אין קבצים כלל — הכל מעודכן
        if (!files || files.length === 0) {
            // הצג toast רק אם המשתמש לחץ ידנית (לא polling אוטומטי)
            if (window._fieldUpdatesManualTrigger) {
                showToast('✅ הכל מעודכן — אין עדכונים מהשטח', 'success');
                window._fieldUpdatesManualTrigger = false;
            }
            _fieldUpdatesSessionHandled = true;
            return;
        }

        if (!appSettings.appliedEventIds) appSettings.appliedEventIds = {};

        pendingFieldUpdateFiles = [];
        // מעקב אחר events ייחודיים למניעת כפילויות
        const seenEventKeys = new Set();

        for (const file of files) {
            try {
                const contentRes = await fetch(
                    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                if (!contentRes.ok) continue;
                const payload = await contentRes.json();

                const allEvents = payload.events || [];
                const newEvents = allEvents.filter(ev => {
                    const evId = ev.id || `${ev.type}_${ev.bldg}_${ev.aptName}_${ev.timestamp}`;
                    // סנן כבר-עובדו
                    if (appSettings.appliedEventIds[evId]) return false;
                    // סנן כפילויות — אותו סוג+בניין+משפחה+תוכן
                    const dedupeKey = `${ev.type}_${ev.bldg}_${ev.aptName}_${JSON.stringify(ev.payload)}`;
                    if (seenEventKeys.has(dedupeKey)) return false;
                    seenEventKeys.add(dedupeKey);
                    return true;
                });

                if (newEvents.length === 0) {
                    await trashDriveFile(file.id);
                    continue;
                }

                pendingFieldUpdateFiles.push({
                    fileId: file.id,
                    filename: file.name,
                    events: newEvents,
                    allEventsCount: allEvents.length,
                    deviceId: payload.deviceId || 'unknown',
                    createdAt: payload.createdAt || file.createdTime
                });
            } catch (e) {
                console.error('mergeOutbox: error reading file', file.name, e);
            }
        }

        if (pendingFieldUpdateFiles.length === 0) {
            if (window._fieldUpdatesManualTrigger) {
                showToast('✅ הכל מעודכן — אין עדכונים חדשים מהשטח', 'success');
                window._fieldUpdatesManualTrigger = false;
            }
            _fieldUpdatesSessionHandled = true;
            return;
        }

        window._fieldUpdatesManualTrigger = false;
        const totalEvents = pendingFieldUpdateFiles.reduce((s, f) => s + f.events.length, 0);
        await _autoApplyFieldUpdates(pendingFieldUpdateFiles, totalEvents);

    } catch (e) {
        console.error('mergeOutboxUpdates error:', e);
    }
}

// ── יישום אוטומטי של עדכוני שטח ––
async function _autoApplyFieldUpdates(updateFiles, totalEvents) {
    if (!appSettings.appliedEventIds) appSettings.appliedEventIds = {};
    let applied = 0;
    const usedFileIds = new Set();

    for (const file of updateFiles) {
        for (const ev of file.events) {
            if (applyOutboxEvent(ev)) {
                applied++;
                usedFileIds.add(file.fileId);
                const evId = ev.id || `${ev.type}_${ev.bldg}_${ev.aptName}_${ev.timestamp}`;
                appSettings.appliedEventIds[evId] = Date.now();
            }
        }
        if (usedFileIds.has(file.fileId)) await trashDriveFile(file.fileId);
    }

    // נקה appliedEventIds ישנים (מעל 30 יום)
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const id of Object.keys(appSettings.appliedEventIds)) {
        if (appSettings.appliedEventIds[id] < cutoff) delete appSettings.appliedEventIds[id];
    }

    if (applied > 0) {
        db.meta.lastModified = Date.now();
        await pushToDrive();
        saveLocal();
        if (typeof refreshMap === 'function') refreshMap();
        if (typeof handleOmniSearch === 'function') handleOmniSearch();
        showToast(`✅ ${applied} עדכוני שטח יושמו אוטומטית`, 'success');
    }

    _fieldUpdatesSessionHandled = true;
    pendingFieldUpdateFiles = [];
}

// ── הצגת חלון עדכונים מהשטח (נשמר לשימוש ידני בלבד) ──
function showFieldUpdatesDialog(updateFiles, totalEvents) {
    // בנה רשימה מאוחדת של כל האירועים
    const allEvents = [];
    updateFiles.forEach(file => {
        file.events.forEach(ev => {
            allEvents.push({ ...ev, _fileId: file.fileId, _deviceId: file.deviceId });
        });
    });

    document.getElementById('fieldUpdatesCount').innerText = `${totalEvents} עדכונים`;

    const list = document.getElementById('fieldUpdatesList');
    list.innerHTML = allEvents.map((ev, i) => {
        const time = ev.timestamp ? new Date(ev.timestamp).toLocaleString('he-IL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
        const { icon, color, desc } = getEventDisplayInfo(ev);
        const hasConflict = detectConflict(ev);

        return `
        <div class="field-update-row ${hasConflict ? 'has-conflict' : ''}" style="
            background:var(--surface); border:1px solid ${hasConflict ? 'var(--warning)' : 'var(--border-light)'};
            border-radius:12px; padding:14px; margin-bottom:10px; display:flex; gap:12px; align-items:flex-start;">
            <label style="display:flex; gap:12px; align-items:flex-start; cursor:pointer; flex:1;">
                <input type="checkbox" class="field-update-cb" data-idx="${i}" checked
                    style="width:18px; height:18px; margin-top:2px; accent-color:var(--accent); cursor:pointer; flex-shrink:0;">
                <div style="flex:1;">
                    <div style="display:flex; gap:8px; align-items:center; margin-bottom:4px; flex-wrap:wrap;">
                        <i class="fas ${icon}" style="color:${color}; font-size:14px;"></i>
                        <strong style="font-size:14px; color:var(--text-main);">${desc}</strong>
                        ${hasConflict ? `<span style="background:rgba(245,158,11,0.15); color:var(--warning); font-size:11px; font-weight:700; padding:2px 8px; border-radius:20px;">⚠️ התנגשות</span>` : ''}
                    </div>
                    <div style="font-size:12px; color:var(--text-muted); display:flex; gap:12px; flex-wrap:wrap;">
                        <span><i class="fas fa-clock"></i> ${time}</span>
                        <span><i class="fas fa-mobile-alt"></i> ${ev._deviceId}</span>
                    </div>
                    ${getEventDetails(ev)}
                    ${hasConflict ? `<div style="margin-top:8px; padding:8px; background:rgba(245,158,11,0.08); border-radius:8px; font-size:12px; color:var(--warning);"><i class="fas fa-exclamation-triangle"></i> הערך שונה גם באפליקציה וגם במשרד מאז הסנכרון האחרון. בחר מי גובר.</div>` : ''}
                </div>
            </label>
        </div>`;
    }).join('');

    // שמור מצב עדכונים לשימוש בעת אישור
    window._pendingFieldEvents = allEvents;
    document.getElementById('fieldUpdatesModal').style.display = 'flex';
}

function getEventDisplayInfo(ev) {
    const nameLabel = ev.aptName ? `משפחת ${escapeHTML(ev.aptName)}` : (ev.bldg ? escapeHTML(ev.bldg) : 'משפחה');
    switch (ev.type) {
        case 'visit_log':      return { icon:'fa-walking', color:'var(--success)',  desc:`ביקור נרשם — ${nameLabel}` };
        case 'call_log':       return { icon:'fa-phone',   color:'var(--accent)',   desc:`שיחה נרשמה — ${nameLabel}` };
        case 'edit_family':    return { icon:'fa-pen',     color:'var(--warning)',  desc:`פרטים עודכנו — ${nameLabel}` };
        case 'stage_change':   return { icon:'fa-columns', color:'var(--accent)',   desc:`שלב שונה — ${nameLabel}` };
        case 'quick_status':   return { icon:'fa-tag',     color:'var(--warning)',  desc:`סטטוס שונה — ${nameLabel}` };
        case 'task_done':      return { icon:'fa-check-circle', color:'var(--success)', desc:`משימה הושלמה — ${nameLabel}` };
        case 'task_undone':    return { icon:'fa-undo',    color:'var(--text-muted)', desc:`משימה בוטלה — ${nameLabel}` };
        case 'add_family_task':return { icon:'fa-thumbtack', color:'var(--accent)', desc:`משימה חדשה — ${nameLabel}` };
        case 'delete_family':  return { icon:'fa-trash',   color:'var(--danger)',   desc:`משפחה נמחקה — ${nameLabel}` };
        case 'contact_update': return { icon:'fa-address-book', color:'var(--success)', desc:`איש קשר עודכן — ${nameLabel}` };
        case 'new_family':
        case 'add_full_family':return { icon:'fa-user-plus', color:'var(--success)', desc:`משפחה חדשה — ${nameLabel}` };
        case 'add_general_task':    return { icon:'fa-thumbtack', color:'var(--warning)', desc:`משימה כללית חדשה` };
        case 'building_visit_log':  return { icon:'fa-building', color:'var(--success)', desc:`ביקור בבניין — ${ev.bldg ? escapeHTML(ev.bldg) : ''}` };
        case 'tag_add':             return { icon:'fa-tag',     color:'var(--warning)', desc:`תג נוסף: "${ev.tag || ''}" — ${nameLabel}` };
        case 'event_create':        return { icon:'fa-calendar-plus', color:'var(--accent)', desc:`אירוע חדש: "${ev.payload?.name || ''}"` };
        case 'event_add_registrant':return { icon:'fa-user-plus', color:'var(--accent)', desc:`נרשם לאירוע: ${ev.payload?.regName || ''}` };
        case 'event_attendance':    return { icon:'fa-check-circle', color:'var(--success)', desc:`נוכחות באירוע: ${ev.payload?.regName || ''}` };
        case 'add_donation':        return { icon:'fa-shekel-sign', color:'var(--success)', desc:`תרומה ₪${ev.payload?.amount || ''} — ${nameLabel}` };
        case 'delete_log':          return { icon:'fa-trash-alt', color:'var(--danger)', desc:`לוג נמחק — ${nameLabel}` };
        case 'delete_task':         return { icon:'fa-trash-alt', color:'var(--danger)', desc:`משימה נמחקה: "${ev.payload?.text || ''}" — ${nameLabel}` };
        default:               return { icon:'fa-sync',    color:'var(--text-muted)', desc:`עדכון — ${nameLabel}` };
    }
}

function getEventDetails(ev) {
    let lines = [];
    if ((ev.type === 'visit_log' || ev.type === 'building_visit_log') && (ev.payload || ev.text)) {
        const note = ev.payload?.note || ev.text || '';
        const result = ev.payload?.result || '';
        if (note) lines.push(`📝 ${escapeHTML(note)}`);
        if (result) lines.push(`תוצאה: ${escapeHTML(result)}`);
    }
    if (ev.type === 'edit_family' && ev.payload) {
        const fields = ['father','mother','fatherPhone','motherPhone','style','notes'];
        fields.forEach(f => { if (ev.payload[f]) lines.push(`${f}: ${escapeHTML(String(ev.payload[f]))}`); });
    }
    if (ev.type === 'stage_change' && ev.payload) {
        lines.push(`${ev.payload.boardId} → ${escapeHTML(ev.payload.stage)}`);
    }
    if (ev.type === 'add_family_task' && ev.payload) {
        lines.push(`✓ ${escapeHTML(ev.payload.taskText)}`);
    }
    if (!lines.length) return '';
    return `<div style="margin-top:6px; padding:6px 10px; background:var(--bg-body); border-radius:8px; font-size:12px; color:var(--text-muted); line-height:1.6;">${lines.join('<br>')}</div>`;
}

function detectConflict(ev) {
    if (!ev.bldg || !ev.aptName) return false;
    const bldgData = db[ev.bldg];
    if (!bldgData) return false;
    const apt = bldgData.apts?.find(a => a.name === ev.aptName);
    if (!apt) return false;

    // בדוק לפי סוג אירוע
    if (ev.type === 'edit_family' && ev.payload) {
        const conflictFields = ['father','mother','fatherPhone','motherPhone','style'];
        for (const field of conflictFields) {
            if (ev.payload[field] !== undefined && apt[field] !== ev.payload[field]) {
                // הערך הנוכחי שונה — ייתכן התנגשות
                // בדוק אם הערך כבר עודכן מהסנכרון האחרון
                const lastSync = db.meta?.lastModified || 0;
                if (apt.updatedAt && apt.updatedAt > lastSync) return true;
            }
        }
    }
    return false;
}

// ── אישור עדכונים נבחרים ──
window.applySelectedFieldUpdates = async function() {
    const cbs = document.querySelectorAll('.field-update-cb:checked');
    if (cbs.length === 0) { showToast('לא נבחרו עדכונים', 'warning'); return; }

    const allEvents = window._pendingFieldEvents || [];
    const selectedIndices = new Set([...cbs].map(cb => +cb.dataset.idx));

    if (!appSettings.appliedEventIds) appSettings.appliedEventIds = {};

    let applied = 0;
    const usedFileIds = new Set();

    allEvents.forEach((ev, idx) => {
        if (!selectedIndices.has(idx)) return;
        if (applyOutboxEvent(ev)) {
            applied++;
            usedFileIds.add(ev._fileId);
            // רשום את ה-event כמעובד
            const evId = ev.id || `${ev.type}_${ev.bldg}_${ev.aptName}_${ev.timestamp}`;
            appSettings.appliedEventIds[evId] = Date.now();
        }
    });

    // מחק / סמן קבצים לפי מידת הטיפול
    for (const file of pendingFieldUpdateFiles) {
        const fileEvents = allEvents.filter(ev => ev._fileId === file.fileId);
        const selectedCount = fileEvents.filter(ev => selectedIndices.has(allEvents.indexOf(ev))).length;
        if (selectedCount === 0) continue; // לא נבחר כלום — אל תגע
        if (selectedCount === fileEvents.length) {
            // טיפול מלא — מחק
            await trashDriveFile(file.fileId);
        } else {
            // טיפול חלקי — סמן _processed כדי שהאפליקציה תדע לנקות shadow
            await _patchDriveFileProcessed(file.fileId);
        }
    }

    // נקה appliedEventIds ישנים (מעל 30 יום) כדי לא לתפוח
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const id of Object.keys(appSettings.appliedEventIds)) {
        if (appSettings.appliedEventIds[id] < cutoff) delete appSettings.appliedEventIds[id];
    }

    if (applied > 0) {
        db.meta.lastModified = Date.now();
        await pushToDrive();
        saveLocal();
        refreshMap();
        handleOmniSearch();
    }

    document.getElementById('fieldUpdatesModal').style.display = 'none';
    _fieldUpdatesSessionHandled = true;
    pendingFieldUpdateFiles = [];
    showToast(`✅ ${applied} עדכונים יושמו בהצלחה!`, 'success');
};

// ── אישור הכל ──
window.applyAllFieldUpdates = async function() {
    document.querySelectorAll('.field-update-cb').forEach(cb => cb.checked = true);
    await window.applySelectedFieldUpdates();
};

// ── דחיית כל העדכונים ──
window.dismissFieldUpdates = async function() {
    const confirmed = await showCustomDialog({
        title: 'דחיית עדכונים',
        message: `האם לדחות את ${(window._pendingFieldEvents || []).length} העדכונים? הם יישארו ב-Drive ולא יוצגו שוב עד שתבחר "טען עדכונים" ידנית.`,
        showCancel: true
    });
    if (confirmed) {
        document.getElementById('fieldUpdatesModal').style.display = 'none';
        _fieldUpdatesSessionHandled = true;
        pendingFieldUpdateFiles = [];
        showToast('העדכונים נדחו — לחץ "טען עדכונים" כדי לראות שוב', 'info');
    }
};

async function trashDriveFile(fileId) {
    try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ trashed: true })
        });
    } catch(e) { console.error('trashDriveFile error:', e); }
}

// סמן קובץ outbox כ-_processed (טיפול חלקי) — האפליקציה תנקה shadow בסנכרון הבא
async function _patchDriveFileProcessed(fileId) {
    try {
        const getRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!getRes.ok) return;
        const content = await getRes.json();
        content._processed = true;
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(content)
        });
        console.log('[Drive] קובץ outbox סומן _processed:', fileId);
    } catch(e) { console.warn('_patchDriveFileProcessed error:', e); }
}

/**
 * מחיל event בודד מאפליקציית השטח על ה-db.
 * סכמת event:
 * {
 *   type: 'task_done' | 'task_undone' | 'visit_log' | 'call_log' | 'stage_change' | 'quick_status' | 'edit_family' | 'delete_family' | 'add_family_task' | 'contact_update' | 'new_family' | 'tag_add' | 'building_visit_log',
 *   bldg: <מפתח הבניין>,
 *   aptName: <שם המשפחה>,
 *   aptNum: <מספר דירה> (אופציונלי),
 *   aptIdx: <אינדקס> (אופציונלי — fallback),
 *   payload: { ... },
 *   timestamp: <ISO string>
 * }
 * מחזיר true אם הצליח לאתר ולעדכן את הדירה.
 */
function applyOutboxEvent(ev) {
    if (!ev || !ev.type) return false;

    // ── event_create / event_add_registrant / event_attendance ──
    if (ev.type === 'event_create') {
        if (!db.meta) db.meta = {};
        if (!db.meta.events) db.meta.events = [];
        if (ev.payload) {
            const newEv = { ...ev.payload, registrants: [], attendance: [] };
            if (!newEv.id) newEv.id = ev.timestamp || Date.now().toString();
            db.meta.events.push(newEv);
        }
        return true;
    }
    if (ev.type === 'event_add_registrant') {
        if (!db.meta?.events) return false;
        const evObj = db.meta.events.find(e => e.id === ev.eventId) || db.meta.events[ev.eventIdx];
        if (!evObj) return false;
        if (!evObj.registrants) evObj.registrants = [];
        const reg = ev.payload;
        if (reg && !evObj.registrants.some(r => r.name === reg.regName)) {
            evObj.registrants.push({ name: reg.regName, phone: reg.regPhone || '', famRef: reg.famRef || null });
        }
        return true;
    }
    if (ev.type === 'event_attendance') {
        if (!db.meta?.events) return false;
        const evObj = db.meta.events.find(e => e.id === ev.eventId) || db.meta.events[ev.eventIdx];
        if (!evObj) return false;
        if (!evObj.attendance) evObj.attendance = [];
        const regName = ev.payload?.regName;
        if (!regName) return false;
        if (ev.payload?.present) {
            if (!evObj.attendance.includes(regName)) evObj.attendance.push(regName);
        } else {
            evObj.attendance = evObj.attendance.filter(n => n !== regName);
        }
        return true;
    }

    // ── add_general_task: משימה כללית (לא שייכת למשפחה ספציפית) ──
    if (ev.type === 'add_general_task') {
        if (!db.meta) db.meta = {};
        if (!db.meta.generalTasks) db.meta.generalTasks = [];
        db.meta.generalTasks.push({
            text: ev.payload?.text || '',
            date: ev.payload?.date || '',
            done: false
        });
        return true;
    }

    // ── building_visit_log: ביקור ברמת בניין (דיבריף מאפליקציית השטח) ──
    if (ev.type === 'building_visit_log') {
        if (!ev.bldg) return false;
        const bldgData = db[ev.bldg];
        if (!bldgData?.apts) return false;
        const ts = ev.timestamp || new Date().toISOString();
        const dateHe = new Date(ts).toLocaleDateString('he-IL');
        const note = ev.payload?.note || ev.text || '';
        const result = ev.payload?.result || '';
        bldgData.apts.forEach(apt => {
            if (!apt.interactions) apt.interactions = [];
            apt.interactions.push({ date: dateHe, type: 'ביקור', notes: escapeHTML(note), result, source: 'field' });
            apt.updatedAt = Date.now();
        });
        return true;
    }

    if (!ev.bldg) return false;
    const bldgData = db[ev.bldg];

    // ── new_family / add_full_family: משפחה חדשה שנוצרה בשטח ──
    if (ev.type === 'new_family' || ev.type === 'add_full_family') {
        if (!bldgData) {
            db[ev.bldg] = { info: { code:'', rep:'', notes:'', coords: ev.payload?.coords || null }, apts: [] };
        }
        if (ev.payload) {
            const fam = { ...ev.payload };
            fam.updatedAt = Date.now();
            db[ev.bldg].apts.push(fam);
        }
        return true;
    }

    if (!bldgData || !bldgData.apts) return false;

    // ── delete_family: מחיקת משפחה ──
    if (ev.type === 'delete_family') {
        const idx = typeof ev.aptIdx === 'number'
            ? ev.aptIdx
            : bldgData.apts.findIndex(a => a.name === ev.aptName);
        if (idx >= 0 && idx < bldgData.apts.length) {
            bldgData.apts.splice(idx, 1);
            return true;
        }
        return false;
    }

    // אתר את הדירה לפי שם (עדיפות) ואחר כך לפי אינדקס
    let apt = ev.aptName
        ? bldgData.apts.find(a => a.name === ev.aptName && (ev.aptNum === undefined || String(a.num) === String(ev.aptNum)))
        : null;
    if (!apt && typeof ev.aptIdx === 'number') apt = bldgData.apts[ev.aptIdx];
    if (!apt) return false;

    const ts = ev.timestamp || new Date().toISOString();
    const dateOnly = ts.split('T')[0];
    const dateHe = new Date(ts).toLocaleDateString('he-IL');

    switch (ev.type) {
        case 'task_done': {
            // נסה לפי אינדקס קודם, אז לפי טקסט
            let task = typeof ev.taskIdx === 'number' ? (apt.tasks || [])[ev.taskIdx] : null;
            if (!task) task = (apt.tasks || []).find(t => t.text === ev.payload?.taskText && !t.done);
            if (task) { task.done = true; task.doneAt = ts; }
            break;
        }
        case 'task_undone': {
            let task = typeof ev.taskIdx === 'number' ? (apt.tasks || [])[ev.taskIdx] : null;
            if (!task) task = (apt.tasks || []).find(t => t.text === ev.payload?.taskText && t.done);
            if (task) { task.done = false; delete task.doneAt; }
            break;
        }
        case 'add_family_task': {
            if (!apt.tasks) apt.tasks = [];
            apt.tasks.push({ text: ev.payload?.taskText || '', date: ev.payload?.taskDate || '', done: false });
            break;
        }
        case 'visit_log': {
            if (!apt.interactions) apt.interactions = [];
            apt.interactions.push({
                date: dateHe,
                type: 'ביקור',
                notes: escapeHTML(ev.payload?.note || ''),
                result: ev.payload?.result || '',
                source: 'field'
            });
            break;
        }
        case 'call_log': {
            if (!apt.interactions) apt.interactions = [];
            apt.interactions.push({
                date: dateHe,
                type: 'שיחה',
                notes: escapeHTML(ev.payload?.note || ''),
                source: 'field'
            });
            break;
        }
        case 'stage_change': {
            if (!apt.boards) apt.boards = {};
            apt.boards[ev.payload?.boardId] = ev.payload?.stage;
            break;
        }
        case 'quick_status': {
            apt.status = ev.payload?.status;
            break;
        }
        case 'edit_family': {
            if (ev.payload) {
                // שדות מערך שלא ממוזגים מהשטח (מנוהלים בצדדים בנפרד)
                const skipKeys = ['tasks','interactions','history','donations','boards','tags','customFields'];
                Object.keys(ev.payload).forEach(k => {
                    if (skipKeys.includes(k)) return;
                    if (k === 'childrenList') {
                        // מיזוג חכם: ילדים מהשטח גוברים, ילדים שהוספו במשרד נשמרים
                        const desktopChildren = apt.childrenList || [];
                        const fieldChildren = ev.payload.childrenList || [];
                        const merged = [...fieldChildren];
                        desktopChildren.forEach(dc => {
                            if (dc.name && !merged.some(fc => fc.name === dc.name)) merged.push(dc);
                        });
                        apt.childrenList = merged;
                    } else {
                        apt[k] = ev.payload[k];
                    }
                });
            }
            break;
        }
        case 'tag_add': {
            if (!apt.tags) apt.tags = [];
            if (ev.tag && !apt.tags.includes(ev.tag)) apt.tags.push(ev.tag);
            break;
        }
        case 'add_donation': {
            if (!apt.donations) apt.donations = [];
            if (ev.payload) apt.donations.push({ ...ev.payload });
            break;
        }
        case 'delete_log': {
            const logs = apt.interactions || apt.history;
            if (!logs) break;
            // Try content match first (indexes may differ between desktop/field)
            const removedLog = ev.payload;
            let logRemoveIdx = -1;
            if (removedLog) {
                logRemoveIdx = logs.findIndex(l =>
                    l.date === removedLog.date &&
                    (l.text === removedLog.text || l.notes === removedLog.text || l.text === removedLog.notes)
                );
            }
            if (logRemoveIdx === -1 && typeof ev.logIdx === 'number') logRemoveIdx = ev.logIdx;
            if (logRemoveIdx >= 0 && logRemoveIdx < logs.length) logs.splice(logRemoveIdx, 1);
            break;
        }
        case 'delete_task': {
            if (!apt.tasks) break;
            const removedTask = ev.payload;
            let taskRemoveIdx = -1;
            if (removedTask?.text) {
                taskRemoveIdx = apt.tasks.findIndex(t => t.text === removedTask.text && !t.done === !removedTask.done);
            }
            if (taskRemoveIdx === -1 && typeof ev.taskIdx === 'number') taskRemoveIdx = ev.taskIdx;
            if (taskRemoveIdx >= 0 && taskRemoveIdx < apt.tasks.length) apt.tasks.splice(taskRemoveIdx, 1);
            break;
        }
        case 'contact_update': {
            // עדכון שדה ספציפי (טלפון/מייל) עם שיוך
            const { field, value, attribution } = ev;
            if (field === 'phone' || field === 'phone2') {
                if (attribution === 'father')       apt.fatherPhone = value;
                else if (attribution === 'mother')  apt.motherPhone = value;
                else if (attribution?.startsWith('child:')) {
                    const childName = attribution.replace('child:', '');
                    const child = (apt.childrenList || []).find(c => c.name === childName);
                    if (child) child.phone = value;
                } else apt.phone = value;
            }
            if (field === 'email') {
                if (attribution === 'father')       apt.fatherEmail = value;
                else if (attribution === 'mother')  apt.motherEmail = value;
                else apt.email = value;
            }
            break;
        }
        default:
            console.warn('applyOutboxEvent: unknown type', ev.type);
            return false;
    }

    apt.updatedAt = Date.now();
    return true;
}

// ── Wrapper for manual sync button — silent token refresh if expired ──
window.manualSync = async function() {
    const session = JSON.parse(localStorage.getItem('gdrive_session') || 'null');
    const tokenValid = session && session.token && session.expiresAt > Date.now();
    if (!tokenValid || !accessToken) {
        showToast('מחדש חיבור...', 'info');
        if (window.tokenClient) {
            window._pendingAuthCallback = () => syncWithDrive();
            window.tokenClient.requestAccessToken({ prompt: '' });
        } else {
            window.handleGoogleLogin();
        }
        return;
    }
    await syncWithDrive();
};

// ── שחזור כפוי מהענן (דורס נתונים מקומיים) ──
window.forcePullFromDrive = async function() {
    if (!accessToken) {
        showToast('יש להתחבר לחשבון Google קודם', 'warning');
        return;
    }
    const confirmed = await showCustomDialog({
        title: 'שחזור מהענן',
        message: 'פעולה זו תחליף את כל הנתונים המקומיים בנתונים מהענן. להמשיך?',
        showCancel: true
    });
    if (!confirmed) return;
    showToast('טוען נתונים מהענן...', 'info');
    await syncWithDrive(true);
    saveLocal();
    refreshMap();
    handleOmniSearch();
    showToast('שחזור הושלם בהצלחה! ✅', 'success');
};

// שמירה מקומית
function saveLocal() {
    localStorage.setItem('community_data_final', JSON.stringify(db));
}

// queue לשמירה — מונע התנגשויות
let saveQueue = Promise.resolve();
let _saveQueueDepth = 0;
const MAX_SAVE_QUEUE = 3;

function queueSave() {
    if (_saveQueueDepth >= MAX_SAVE_QUEUE) {
        // יש כבר מספיק שמירות בתור — דלג
        return;
    }
    _saveQueueDepth++;
    saveQueue = saveQueue
        .then(() => pushToDrive())
        .finally(() => { _saveQueueDepth = Math.max(0, _saveQueueDepth - 1); });
}

// מניעת שמירה כפולה
let isSaving = false;
async function pushToDrive() {
    if(!driveFileId || !accessToken) return;
    if(isSaving) return;
    isSaving = true;
    setSyncStatus('wait', 'שומר...');
    try {
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(db)
        });
        setSyncStatus('ok', 'נשמר');
    } catch(e) {
        setSyncStatus('error', 'שגיאה');
        console.error(e);
    } finally {
        isSaving = false;
    }
}

function setSyncStatus(st, txt) { document.getElementById('sync-text').innerText=txt; const ic=document.getElementById('sync-icon'), co=document.getElementById('sync-status'); if(st==='wait'){ic.className='fas fa-spinner fa-spin';co.style.color='var(--warning)';} if(st==='ok'){ic.className='fas fa-cloud-check';co.style.color='var(--success)';} if(st==='error'){ic.className='fas fa-exclamation-triangle';co.style.color='var(--danger)';} }

function saveDB() {
    // Safety: don't save uninitialized db (prevents overwriting Drive data on fresh load)
    if (!db || !db.meta) { console.warn('saveDB: db not initialized, skipping'); return; }

    db.meta.lastModified = Date.now();
    db['__SETTINGS__'] = appSettings;

    saveLocal();
    queueSave();
    // handleOmniSearch מופעל רק כשצריך לעדכן UI — לא בכל שמירה
    // כדי למנוע re-render מלא של המפה בכל פעולה
}

// autosave — שומר לוקאלית בלבד בזמן עריכה (לא לדרייב)
let saveTimeout;
function autoSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        db['__SETTINGS__'] = appSettings;
        saveLocal(); // רק לוקאלי — לא דרייב
    }, 2000);
}

// ── בדיקה תקופתית לעדכוני שטח (כל 5 דקות) ──
// מאפס את דגל הסשן לפני כל polling כך שקבצים חדשים מהשטח ייקלטו.
// appliedEventIds מונע יישום כפול של אירועים שכבר עובדו.
(function _startFieldUpdatePolling() {
    setInterval(() => {
        if (accessToken && document.visibilityState !== 'hidden') {
            _fieldUpdatesSessionHandled = false;
            mergeOutboxUpdates();
        }
    }, 5 * 60 * 1000);
})();
