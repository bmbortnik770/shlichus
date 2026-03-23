function getStoredJSON(key, defaultVal) {
    try {
        let val = localStorage.getItem(key);
        return val ? JSON.parse(val) : defaultVal;
    } catch (e) {
        console.error("Storage parse error:", e);
        return defaultVal;
    }
}

const CLIENT_ID = '348261974014-242r9b0dvctlka7rj3aetu81v96ere46.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
let accessToken = null, driveFileId = null;

mapboxgl.accessToken = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';
mapboxgl.setRTLTextPlugin('https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js', null, true);
const NO_ADDRESS_KEY = "__NO_ADDRESS__";

let markerColorMode = 'status';
const markerPalette = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#64748b', '#14b8a6', '#f43f5e', '#84cc16', '#0ea5e9'];
const chartStyleColors = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#64748b'];

function getColorForString(str, type) {
    if(!str) return '#94a3b8';
    if(type === 'style') {
        if(appSettings.styleColors && appSettings.styleColors[str]) return appSettings.styleColors[str];
        let idx = appSettings.styles.indexOf(str);
        return idx === -1 ? '#94a3b8' : chartStyleColors[idx % chartStyleColors.length];
    } else {
        if(appSettings.tagColors && appSettings.tagColors[str]) return appSettings.tagColors[str];
        let idx = appSettings.tags.indexOf(str);
        return idx === -1 ? '#94a3b8' : markerPalette[idx % markerPalette.length];
    }
}

window.changeMarkerColorMode = () => { 
    markerColorMode = document.getElementById('markerColorMode').value; 
    refreshMap(); 
};

let appSettings = JSON.parse(localStorage.getItem('crm_prefs')) || { 
    center: [35.24430, 31.82650], zoom: 17.5, pitch: 60, themeColor: '#3b82f6', defaultView: 'map',
    tags: ['דובר רוסית', 'חבר קהילה', 'תורם קבוע', 'מקורב'], styles: ['חרדי', 'מודרני', 'דתי', 'מסורתי', 'שאינו לעת עתה'], customFields: [],
    styleColors: {}, tagColors: {},
    goal: { text: 'חיפוש חופשי', target: 30 }
};

if(!appSettings.styleColors) appSettings.styleColors = {};
if(!appSettings.tagColors) appSettings.tagColors = {};
// נקה כפילויות שנשמרו בעבר
appSettings.styles = [...new Set(appSettings.styles)];
appSettings.tags = [...new Set(appSettings.tags)];

if(!appSettings.homeLocation) {
    if(appSettings.chabadHouseCoords) {
        appSettings.homeLocation = { coords: appSettings.chabadHouseCoords, address: appSettings.chabadHouseAddress || 'כתובת לא ידועה', isChabad: true };
    }
}

if(!appSettings.customFields) appSettings.customFields = [];
if(!appSettings.visibleColumns) {
    appSettings.visibleColumns = ['address', 'name', 'boards', 'tags', 'lastContact', 'actions'];
}
if(!appSettings.smartViews) {
    appSettings.smartViews = [
        { id: 'v_all', name: 'כל המשפחות', icon: 'fa-users', rule: 'none' },
        { id: 'v_novisit', name: 'דורש ביקור (מעל 3 חודשים)', icon: 'fa-walking', rule: 'no_visit_3m' },
        { id: 'v_bday', name: 'ילדים חוגגים יום הולדת החודש', icon: 'fa-birthday-cake', rule: 'bday_month' }
    ];
}
window.activeSmartView = 'v_all';
window.customSmartSort = '';
if(!appSettings.goal) appSettings.goal = { text: 'חיפוש חופשי', target: 30 };
if(!appSettings.templates) {
    appSettings.templates = [
        { title: 'הודעת פתיחה', text: 'שלום משפחת [שם], שמחים לעדכן אתכם ש...' },
        { title: 'תזכורת', text: 'שלום משפחת [שם], מזכירים לכם לגבי האירוע הקרוב...' }
    ];
}

document.documentElement.style.setProperty('--accent', appSettings.themeColor);
let currentMainView = appSettings.defaultView || 'map';

let db = getStoredJSON('community_data_final', { meta: { lastModified: 0 } });
if(!db.meta) db.meta = { lastModified: 0 };
if(!db[NO_ADDRESS_KEY]) db[NO_ADDRESS_KEY] = { info: { code:'', rep:'', notes:'', coords: null }, apts: [] };

if(!db['__BOARDS__']) {
    db['__BOARDS__'] = [{ id: 'b_default', name: 'לוח מעקב כללי', columns: ['מתעניין חדש', 'בטיפול', 'פעיל קבוע', 'לא רלוונטי'], archived: false }];
    Object.keys(db).forEach(b => {
        if(b !== '__BOARDS__' && db[b].apts) {
            db[b].apts.forEach(a => {
                if(!a.boards) a.boards = {};
                if(a.pipeline) { a.boards['b_default'] = a.pipeline; delete a.pipeline; }
            });
        }
    });
    localStorage.setItem('community_data_final', JSON.stringify(db));
}

let activeMarkers = [], chart = null, chabadHouseMarker = null, modalGeocoder = null;
let currentBldg = null, currentAptIdx = null;
let tempChildren=[], tempTags=[], tempLogs=[], tempDonations=[], tempTasks=[], tempCustom={}, tempBoards={}; 
let pendingMoveMode = false, isDirty = false, isCreatingNew = false;
let bulkSelection = []; 
let currentFilters = { tags: [], style: [], status: [] };
let tempSelectedAddress = null;

const compliments = ["אלוף! 💪", "פצצה! 🎯", "אין עליך! 🚀", "עבודה מדהימה! 🔥", "הקהילה גדלה! 👑"];
function getRandomCompliment() { return compliments[Math.floor(Math.random() * compliments.length)]; }

function showCustomDialog(opts) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customDialogModal');
        document.getElementById('cdTitle').innerText = opts.title || 'הודעה';
        document.getElementById('cdMessage').innerText = opts.message || '';
        const input = document.getElementById('cdInput');
        if(opts.showInput) {
            input.style.display = 'block'; input.value = opts.defaultValue || ''; input.focus();
        } else { input.style.display = 'none'; }

        document.getElementById('cdBtnOk').onclick = () => {
            modal.style.display = 'none'; resolve(opts.showInput ? input.value : true);
        };
        
        const btnCancel = document.getElementById('cdBtnCancel');
        if(opts.showCancel) {
            btnCancel.style.display = 'inline-block';
            btnCancel.onclick = () => { modal.style.display = 'none'; resolve(opts.showInput ? null : false); };
        } else { btnCancel.style.display = 'none'; }
        
        modal.style.display = 'flex';
    });
}

function showUndoToast(msg, undoCallback) {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast toast-info`;
    t.innerHTML = `<span><i class="fas fa-info-circle"></i> ${msg}</span> <button class="undo-btn">בטל (Undo)</button>`;
    
    let undoClicked = false;
    t.querySelector('button').onclick = () => {
        undoClicked = true;
        undoCallback();
        t.style.animation = 'fadeOut 0.3s ease-in forwards';
        setTimeout(()=>t.remove(), 300);
    };
    
    c.appendChild(t);
    setTimeout(() => {
        if(!undoClicked) {
            t.style.animation = 'fadeOut 0.3s ease-in forwards';
            setTimeout(()=>t.remove(), 300);
        }
    }, 6000); 
}

const map = new mapboxgl.Map({ container: 'map', style: 'mapbox://styles/mapbox/streets-v12', center: appSettings.center, zoom: appSettings.zoom, pitch: appSettings.pitch });
map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
map.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'bottom-right');

const geocoder = new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl: mapboxgl, placeholder: '📍 חפש אזור/כתובת במפה...', countries: 'il', language: 'he' });
document.getElementById('geocoder').appendChild(geocoder.onAdd(map));

let obGeocoder = new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl: mapboxgl, placeholder: 'הקלד כתובת בית חב"ד...', countries: 'il', language: 'he' });
let tempObLoc = null;
obGeocoder.on('result', (e) => { tempObLoc = { coords: e.result.center, address: e.result.place_name_he || e.result.place_name }; });

if(appSettings.homeLocation && appSettings.homeLocation.isChabad && !appSettings.primaryLocation) {
    appSettings.primaryLocation = { coords: appSettings.homeLocation.coords, address: appSettings.homeLocation.address };
}

let primaryGeocoder = new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl: mapboxgl, placeholder: 'חפש את הכתובת הקבועה...', countries: 'il', language: 'he' });
let tempPrimaryLoc = null;
primaryGeocoder.on('result', (e) => { tempPrimaryLoc = { coords: e.result.center, address: e.result.place_name_he || e.result.place_name }; });

let otherGeocoder = new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl: mapboxgl, placeholder: 'בחר מיקום...', countries: 'il', language: 'he' });
let tempOtherLoc = null;
otherGeocoder.on('result', (e) => { tempOtherLoc = { coords: e.result.center, address: e.result.place_name_he || e.result.place_name }; });

window.toggleHomeLocUI = () => {
    const isPrimary = document.getElementById('locTypePrimary').checked;
    document.getElementById('primaryLocUI').style.display = isPrimary ? 'block' : 'none';
    document.getElementById('otherLocUI').style.display = isPrimary ? 'none' : 'block';
    document.getElementById('primaryGeocoderWrapper').style.display = 'none';
    if(isPrimary) {
        const addr = (appSettings.primaryLocation && appSettings.primaryLocation.address)
            ? appSettings.primaryLocation.address
            : (appSettings.homeLocation && appSettings.homeLocation.isChabad && appSettings.homeLocation.address)
                ? appSettings.homeLocation.address
                : 'לא הוגדר';
        document.getElementById('currentPrimaryAddress').innerText = addr;
    }
};

window.openPrimaryChangeUI = () => { document.getElementById('primaryGeocoderWrapper').style.display = 'block'; };

window.confirmPrimaryChange = () => {
    if(!tempPrimaryLoc) { showToast('יש לחפש ולבחור כתובת מהרשימה', 'warning'); return; }
    appSettings.primaryLocation = { coords: tempPrimaryLoc.coords, address: tempPrimaryLoc.address };
    appSettings.homeLocation = { coords: tempPrimaryLoc.coords, address: tempPrimaryLoc.address, isChabad: true };
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    document.getElementById('currentPrimaryAddress').innerText = tempPrimaryLoc.address;
    document.getElementById('primaryGeocoderWrapper').style.display = 'none';
    primaryGeocoder.clear();
    tempPrimaryLoc = null;
    showToast('כתובת בית חב"ד עודכנה ונשמרה!', 'success');
};

window.onload = () => {
    let lastLogin = localStorage.getItem('last_login_date');
    let todayStr = new Date().toISOString().split('T')[0];
    let welcomeDiv = document.getElementById('welcomeMessage');
    if(lastLogin === todayStr) { welcomeDiv.innerHTML = "איזה כיף שחזרת! ממשיכים את המומנטום 🚀"; } 
    else if (lastLogin) { welcomeDiv.innerHTML = "ברוך שובך! פעם קודמת היית אש, בוא נראה מה תעשה היום 🔥"; } 
    else { welcomeDiv.innerHTML = "ברוך הבא למערכת! כאן מתחילים להפוך את העולם 🌍"; }
    localStorage.setItem('last_login_date', todayStr);

    const obContainer = document.getElementById('onboardingGeocoderContainer');
    if(obContainer) obContainer.appendChild(obGeocoder.onAdd(map));
    
    const pContainer = document.getElementById('settingsPrimaryGeocoderContainer');
    if(pContainer) pContainer.appendChild(primaryGeocoder.onAdd(map));
    const oContainer = document.getElementById('settingsOtherGeocoderContainer');
    if(oContainer) oContainer.appendChild(otherGeocoder.onAdd(map));

    const modContainer = document.getElementById('modalGeocoderContainer');
    if(modContainer) {
        modalGeocoder = new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl: mapboxgl, placeholder: 'הקלד כתובת לחיפוש...', countries: 'il', language: 'he', marker: false, flyTo: false });
        modContainer.appendChild(modalGeocoder.onAdd(map));
        modalGeocoder.on('result', (e) => {
            const f = e.result;
            const placeName = (f.place_name_he || f.place_name).split(',')[0].trim();
            tempSelectedAddress = { name: placeName, lng: f.center[0], lat: f.center[1] };
        });
        modalGeocoder.on('clear', () => { tempSelectedAddress = null; });
    }

    switchMainView(currentMainView);
    if(localStorage.getItem('darkMode')==='true') { document.body.classList.add('dark-mode'); document.getElementById('darkModeIcon').className='fas fa-sun'; }
    populateFilterDropdowns();
    // debounce לחיפוש — מונע ריצות מיותרות
    function debounce(fn, delay = 300) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
    }
    document.getElementById('smartSearch').addEventListener('input', debounce(handleOmniSearch));

    const session = JSON.parse(localStorage.getItem('gdrive_session'));
    if (session && session.token && session.expiresAt > new Date().getTime()) {
        accessToken = session.token; document.getElementById('auth-overlay').style.display='none'; document.getElementById('splash-screen').style.display='flex'; syncWithDrive();
    } else {
        window.gClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: handleAuth });
        document.getElementById('google-btn').innerHTML = `<button class="btn btn-primary" style="padding:12px 20px; font-size:16px;" onclick="window.gClient.requestAccessToken()"><i class="fab fa-google"></i> התחבר לענן</button>`;
        setTimeout(() => { document.getElementById('splash-screen').style.opacity='0'; setTimeout(()=>{document.getElementById('splash-screen').style.display='none'; document.getElementById('auth-overlay').style.display='flex';}, 800); }, 1500);
    }
};

function updateHomeButton() {
    const btn = document.getElementById('btnGoHome');
    if(btn && appSettings.homeLocation && appSettings.homeLocation.coords) {
        btn.style.display = 'flex';
        if(appSettings.homeLocation.isChabad) {
            btn.innerHTML = `<div style="width:20px;height:20px;background-image:url('770.jpg');background-size:cover;background-position:center;border-radius:4px;border:1px solid var(--accent);"></div>`;
        } else {
            btn.innerHTML = `<i class="fas fa-home" style="color:var(--accent);"></i>`;
        }
    } else if(btn) {
        btn.style.display = 'none';
    }
}

window.flyToHome = () => {
    if(appSettings.homeLocation && appSettings.homeLocation.coords) {
        map.flyTo({ center: appSettings.homeLocation.coords, zoom: 19, pitch: 60 });
    } else {
        showToast('לא הוגדר מיקום מרכזי. הגדר בהגדרות.', 'warning');
    }
};

window.saveOnboardingLocation = () => {
    if(!tempObLoc) { showToast('יש לחפש ולבחור כתובת', 'warning'); return; }
    appSettings.homeLocation = { coords: tempObLoc.coords, address: tempObLoc.address, isChabad: document.getElementById('onboardingIsChabad').checked };
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    document.getElementById('onboardingModal').style.display = 'none';
    updateHomeButton();
    refreshMap();
    showToast('ברוך הבא! מיקום נשמר.', 'success');
};

function handleAuth(resp) {
    accessToken = resp.access_token; localStorage.setItem('gdrive_session', JSON.stringify({ token: accessToken, expiresAt: new Date().getTime() + 3500000 }));
    document.getElementById('auth-overlay').style.opacity='0'; document.getElementById('splash-screen').style.display='flex'; document.getElementById('splash-screen').style.opacity='1';
    setTimeout(() => { document.getElementById('auth-overlay').style.display='none'; syncWithDrive(); }, 500);
}
window.logout = async function() { 
    const proceed = await showCustomDialog({ title: 'התנתקות', message: 'האם אתה בטוח שברצונך להתנתק מהחשבון?', showCancel: true });
    if(proceed) { localStorage.removeItem('gdrive_session'); location.reload(); } 
};
async function ensureAuthAndExecute(cb) {
    const session = JSON.parse(localStorage.getItem('gdrive_session'));
    if (!session || session.expiresAt < new Date().getTime() + 60000) { showToast("מחדש חיבור...", "warning"); window.gClient.callback = (r)=>{ handleAuth(r); setTimeout(cb, 1000); }; window.gClient.requestAccessToken({prompt: ''}); } else { cb(); }
}

async function geocodeMissingAddresses() {
    const bldgs = Object.keys(db).filter(k => k !== '__BOARDS__' && k !== '__SETTINGS__' && k !== NO_ADDRESS_KEY && k !== 'meta' && db[k] && db[k].info && (!db[k].info.coords || isNaN(db[k].info.coords[0])));
    if(bldgs.length > 0) showToast("מתבצע עדכון מיקומים ברקע...", "info");
    let updated = false;
    for(let b of bldgs) {
        try {
            const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(b)}.json?country=il&language=he&access_token=${mapboxgl.accessToken}`);
            if(r.status === 429) { 
                await new Promise(res => setTimeout(res, 4000)); // המתנה במקרה של חסימה זמנית מהשרת
                continue; 
            }
            const d = await r.json();
            if(d.features && d.features.length > 0) {
                db[b].info.coords = d.features[0].center;
                updated = true;
            }
        } catch(e) { console.error("Geocode Error", e); }
        await new Promise(res => setTimeout(res, 250));
    }
    if(updated) { saveDB(); refreshMap(); }
}

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

async function syncWithDrive() {
    setSyncStatus('wait', 'שואב...');
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='community_data_final.json'`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const list = await res.json();
        if (list.files && list.files.length > 0) {
            driveFileId = list.files[0].id;
            const content = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
            const remote = await content.json();
            if(Object.keys(remote).length > 0) {
                const remoteTime = remote.meta?.lastModified || 0;
                const localTime = db.meta?.lastModified || 0;
                if(remoteTime > localTime) {
                    db = mergeDB(db, remote);
                    if(db['__SETTINGS__']) {
                        appSettings = db['__SETTINGS__'];
                        localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
                        document.documentElement.style.setProperty('--accent', appSettings.themeColor);
                        populateFilterDropdowns();
                    }
                } else if(localTime > remoteTime) {
                    await pushToDrive();
                } else {
                    db = mergeDB(db, remote);
                }
            }
        } else {
            const create = await fetch('https://www.googleapis.com/drive/v3/files', { method:'POST', headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'}, body:JSON.stringify({name:'community_data_final.json',mimeType:'application/json'}) });
            driveFileId = (await create.json()).id;
            await pushToDrive();
        }
        if(!db[NO_ADDRESS_KEY]) db[NO_ADDRESS_KEY] = { info: {code:'',rep:'',notes:'',coords:null}, apts:[] };
        if(!db['__BOARDS__']) db['__BOARDS__'] = [{ id: 'b_default', name: 'לוח מעקב כללי', columns: ['מתעניין חדש', 'בטיפול', 'פעיל קבוע', 'לא רלוונטי'], archived: false }];
        if(!db.meta) db.meta = { lastModified: 0 };
        saveLocal();
        setSyncStatus('ok', 'מסונכרן');
    } catch(e) { setSyncStatus('error', 'שגיאה'); console.error('sync error', e); }

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
    }, 800);
}

// שמירה מקומית
function saveLocal() {
    localStorage.setItem('community_data_final', JSON.stringify(db));
}

// queue לשמירה — מונע התנגשויות
let saveQueue = Promise.resolve();
function queueSave() {
    saveQueue = saveQueue.then(() => pushToDrive());
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
    // בדיקת בטיחות: לא שומרים לדרייב אם אין נתונים אמיתיים
    const realKeys = Object.keys(db).filter(k => k !== '__BOARDS__' && k !== '__SETTINGS__' && k !== NO_ADDRESS_KEY && k !== 'meta');
    const hasRealData = realKeys.length > 0 || (db[NO_ADDRESS_KEY] && db[NO_ADDRESS_KEY].apts && db[NO_ADDRESS_KEY].apts.length > 0);
    if(!hasRealData) { console.warn('saveDB: מניעת שמירה של DB ריק'); return; }

    db.meta.lastModified = Date.now();
    db['__SETTINGS__'] = appSettings;

    saveLocal();
    handleOmniSearch();
    queueSave();
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

window.switchMainView = function(viewName) {
    currentMainView = viewName;
    document.querySelectorAll('.main-tab').forEach(t=>t.classList.remove('active'));
    document.getElementById('tab-' + viewName).classList.add('active');
    
    document.getElementById('map-container').style.display = viewName==='map'?'block':'none';
    document.getElementById('list-container').style.display = viewName==='table'?'block':'none';
    document.getElementById('kanban-container').style.display = viewName==='kanban'?'flex':'none';
    document.getElementById('comm-container').style.display = viewName==='comm'?'flex':'none';
    document.getElementById('tasks-container').style.display = viewName==='tasks'?'flex':'none';
    
    if(viewName==='map') map.resize();
    if(viewName==='tasks') {
        document.getElementById('globalTaskDate').value = new Date().toISOString().split('T')[0];
        renderGlobalTasks();
    }
    handleOmniSearch(); 
    if(window.innerWidth<=768) document.getElementById('sidebar').classList.remove('open');
};

window.switchCommTab = function(tabName) {
    document.querySelectorAll('#comm-container .crm-tab, #comm-container .comm-tab-content').forEach(e => e.classList.remove('active'));
    document.getElementById('commTabBtn-' + tabName).classList.add('active');
    document.getElementById('comm-' + tabName).classList.add('active');
    
    if (tabName === 'templates') renderTemplates();
    if (tabName === 'whatsapp' || tabName === 'email') renderCommSenders(tabName);
};

window.toggleMapStyle = () => { const s = map.getStyle().name.includes('Satellite'); map.setStyle(s ? 'mapbox://styles/mapbox/streets-v12' : 'mapbox://styles/mapbox/satellite-streets-v12'); showToast(s ? 'מפת רחובות' : 'מפת לוויין', 'info'); };
map.on('style.load', () => { if(!map.getLayer('3d-buildings')) map.addLayer({ 'id':'3d-buildings', 'source':'composite', 'source-layer':'building', 'filter':['==','extrude','true'], 'type':'fill-extrusion', 'minzoom':15, 'paint': { 'fill-extrusion-color':['case',['boolean',['feature-state','hover'],false],appSettings.themeColor,'#d1d5db'], 'fill-extrusion-height':['get','height'], 'fill-extrusion-base':['get','min_height'], 'fill-extrusion-opacity':0.8 } }); });

let hoveredStateId = null; const hoverPopup = new mapboxgl.Popup({ closeButton:false, closeOnClick:false, className:'hover-popup', offset:15 });
map.on('mousemove', '3d-buildings', (e) => { if(e.features.length>0) { map.getCanvas().style.cursor='pointer'; if(hoveredStateId!==null) map.setFeatureState({source:'composite',sourceLayer:'building',id:hoveredStateId},{hover:false}); hoveredStateId=e.features[0].id; map.setFeatureState({source:'composite',sourceLayer:'building',id:hoveredStateId},{hover:true}); hoverPopup.setLngLat(e.lngLat).setHTML('<div style="font-weight:600;font-size:12px;color:var(--accent);"><i class="fas fa-hand-pointer"></i> ניהול בניין</div>').addTo(map); } });
map.on('mouseleave', '3d-buildings', () => { map.getCanvas().style.cursor=''; if(hoveredStateId!==null) map.setFeatureState({source:'composite',sourceLayer:'building',id:hoveredStateId},{hover:false}); hoveredStateId=null; hoverPopup.remove(); });
map.on('click', '3d-buildings', async (e) => { hoverPopup.remove(); try { const r=await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${e.lngLat.lng},${e.lngLat.lat}.json?types=address&language=he&access_token=${mapboxgl.accessToken}`); const d=await r.json(); let addr=`מיקום (${e.lngLat.lng.toFixed(4)}, ${e.lngLat.lat.toFixed(4)})`; if(d.features&&d.features.length>0) addr=(d.features[0].place_name_he||d.features[0].place_name).split(',')[0].trim(); currentBldg=addr; if(!db[currentBldg]) db[currentBldg]={info:{code:'',rep:'',notes:'',coords:[e.lngLat.lng,e.lngLat.lat]},apts:[]}; openBuildingModal(); } catch(err){showToast("שגיאת כתובת","warning");} });

function getAllPhones(a) { return [a.fatherPhone, a.motherPhone, ...(a.childrenList||[]).map(c=>c.phone)].filter(Boolean); }
function getAllEmails(a) { return [a.fatherEmail, a.motherEmail, ...(a.childrenList||[]).map(c=>c.email)].filter(Boolean); }

window.openBuildingModal = function() {
    const b = db[currentBldg]; document.getElementById('bModalTitle').innerHTML = `<i class="fas fa-building" style="color:var(--accent);"></i> ${currentBldg}`;
    let c = b.info.coords || (currentBldg !== NO_ADDRESS_KEY ? currentBldg.split(',').map(Number) : null);
    document.getElementById('bModalNavBtn').innerHTML = (c&&!isNaN(c[0])) ? `<a href="https://waze.com/ul?ll=${c[1]},${c[0]}&navigate=yes" target="_blank" class="btn btn-outline" style="padding:4px 10px; font-size:12px; border-radius:15px; width:auto; border-color:#33ccff; color:#33ccff;"><i class="fab fa-waze"></i> נווט</a>` : '';
    
    let aptList = b.apts.map((a, i) => {
        let col = getStatusColor(a), bdg = (a.tags||[]).map(t=>`<span class="tag-badge">${escapeHTML(t)}</span>`).join('');
        let phones = getAllPhones(a); let ph = phones.length > 0 ? phones[0].replace(/\D/g, '') : '';
        let safeName = escapeHTML(a.name || '(ללא שם)');
        let safeNum = escapeHTML(a.num || '-');
        return `<div class="bldg-fam-item" style="border-right-color:${col}" onclick="openClientCard(${i})"><div><div style="font-weight:700;font-size:16px;">${safeName} <span style="font-size:12px;font-weight:normal;color:var(--text-muted);">(דירה ${safeNum})</span></div><div style="margin-top:4px;">${bdg}</div></div><div style="display:flex;gap:8px;">${ph?`<a href="tel:${ph}" class="btn-icon" style="color:var(--success);border-color:var(--success);" onclick="event.stopPropagation()"><i class="fas fa-phone"></i></a>`:''}<button class="btn-icon" style="color:var(--accent);"><i class="fas fa-pen"></i></button></div></div>`;
    }).join('');
    document.getElementById('bldgModalAptsList').innerHTML = aptList || '<div class="empty-state"><i class="fas fa-door-open"></i><div>אין משפחות רשומות בבניין.</div></div>';
    document.getElementById('bModalCode').value=b.info.code||''; document.getElementById('bModalRep').value=b.info.rep||''; document.getElementById('bModalNotes').value=b.info.notes||'';
    switchBldgTab('apts'); document.getElementById('buildingModal').style.display='flex';
};
window.switchBldgTab = (tab) => { document.querySelectorAll('#buildingModal .crm-tab, #buildingModal .crm-tab-content').forEach(e=>e.classList.remove('active')); document.getElementById(`bldgTabBtn-${tab}`).classList.add('active'); document.getElementById(`bldgTab-${tab}`).classList.add('active'); };

window.quickAddAptModal = () => { 
    db[currentBldg].apts.push({ num:'', name:'', style:appSettings.styles[0], boards:{}, tags:[], childrenList:[], interactions:[], donations:[], tasks:[], customFields:{} }); 
    isCreatingNew = true;
    document.getElementById('buildingModal').style.display='none'; 
    openClientCard(db[currentBldg].apts.length-1); 
};
window.saveBldgModalInfo = () => ensureAuthAndExecute(() => { db[currentBldg].info.code=document.getElementById('bModalCode').value; db[currentBldg].info.rep=document.getElementById('bModalRep').value; db[currentBldg].info.notes=document.getElementById('bModalNotes').value; saveDB(); showToast("נשמר " + getRandomCompliment(),"success"); });

window.markDirty = () => { 
    isDirty = true; 
    const btn = document.getElementById('saveClientBtn');
    if(btn && !btn.classList.contains('btn-warning')) {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-warning');
        btn.innerHTML = '<i class="fas fa-exclamation-circle"></i> שינויים לא שמורים - לחץ לשמירה';
    }
    autoSave();
};

window.closeModals = () => { 
    isDirty = false; 
    pendingMoveMode = false; // התיקון: איפוס מצב העברה
    tempSelectedAddress = null;
    if(modalGeocoder) modalGeocoder.clear();
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); 
};

window.attemptCloseCrmModal = async () => { 
    if(isDirty) {
        const proceed = await showCustomDialog({ title: 'שינויים לא שמורים', message: 'יש שינויים שלא שמרת. האם אתה בטוח שברצונך לצאת?', showCancel: true });
        if(!proceed) return;
    }
    if(isCreatingNew) {
        db[currentBldg].apts.splice(currentAptIdx, 1);
    }
    isDirty=false; 
    isCreatingNew=false;
    document.getElementById('clientModal').style.display='none'; 
    if(currentBldg!==NO_ADDRESS_KEY && currentMainView==='map') openBuildingModal(); 
};
window.formatPhone = (el) => { let v=el.value.replace(/\D/g,''); if(v.length>3&&v.length<=6) v=v.slice(0,3)+'-'+v.slice(3); else if(v.length>6) v=v.slice(0,3)+'-'+v.slice(3,6)+'-'+v.slice(6,10); el.value=v; };

window.quickAddFamily = () => {
    currentBldg = NO_ADDRESS_KEY;
    db[currentBldg].apts.push({num:'',name:'',style:appSettings.styles[0],boards:{},tags:[],childrenList:[],interactions:[],donations:[],tasks:[],customFields:{}});
    currentAptIdx = db[currentBldg].apts.length - 1;
    isCreatingNew = true;
    openClientCard(currentAptIdx);
};

window.openClientCard = function(idx) {
    isDirty = false; 
    const btn = document.getElementById('saveClientBtn');
    if(btn) { btn.classList.remove('btn-warning'); btn.classList.add('btn-primary'); btn.innerHTML = '<i class="fas fa-save"></i> שמור פרטים'; }
    
    document.getElementById('buildingModal').style.display='none'; currentAptIdx = idx; const a = db[currentBldg].apts[idx];
    document.getElementById('crmFamilyTitle').innerHTML = `<i class="fas fa-id-card"></i> ${a.name||'משפחה חדשה'} <span style="font-size:12px;">${currentBldg===NO_ADDRESS_KEY?'(ללא כתובת)':''}</span>`;
    document.getElementById('cAddressDisplay').value = currentBldg === NO_ADDRESS_KEY ? 'ללא כתובת (לחץ לעריכה)' : currentBldg;
    
    document.getElementById('cFamilyName').value=a.name||''; document.getElementById('cAptNum').value=a.num||''; document.getElementById('cFather').value=a.father||''; document.getElementById('cMother').value=a.mother||''; document.getElementById('cNotes').value=a.notes||'';
    
    if(a.phones && !a.fatherPhone && !a.motherPhone) {
         let pArr = a.phones.split(',');
         if(pArr.length > 0) a.fatherPhone = pArr[0].trim();
         if(pArr.length > 1) a.motherPhone = pArr[1].trim();
    }
    document.getElementById('cFatherPhone').value = a.fatherPhone || '';
    document.getElementById('cMotherPhone').value = a.motherPhone || '';
    document.getElementById('cFatherEmail').value = a.fatherEmail || '';
    document.getElementById('cMotherEmail').value = a.motherEmail || '';

    const sSel = document.getElementById('cStyle'); sSel.innerHTML = ''; 
    appSettings.styles.forEach(s => sSel.innerHTML += `<option value="${s}" ${a.style===s?'selected':''}>${s}</option>`); 
    if(a.style&&!appSettings.styles.includes(a.style)) sSel.innerHTML+=`<option selected>${a.style}</option>`;

    tempTags=[...(a.tags||[])]; renderModalTags();
    tempChildren=JSON.parse(JSON.stringify(a.childrenList||[])); renderModalChildren();
    tempLogs=JSON.parse(JSON.stringify(a.interactions||[])); renderLogs();
    tempDonations=JSON.parse(JSON.stringify(a.donations||[])); renderDonations();
    tempTasks=JSON.parse(JSON.stringify(a.tasks||[])); renderTasks();
    tempCustom=JSON.parse(JSON.stringify(a.customData || a.customFields ||{})); renderCustomFields();
    tempBoards=JSON.parse(JSON.stringify(a.boards||{})); renderModalBoards();
    
    const tStr = new Date().toISOString().split('T')[0];
    document.getElementById('newLogDate').value = tStr; 
    document.getElementById('newDonDate').value = tStr; 
    document.getElementById('newTaskDate').value = tStr;
    
    switchCrmTab('details'); document.getElementById('clientModal').style.display='flex';
};

window.switchCrmTab = (tab) => { 
    document.querySelectorAll('#clientModal .crm-tab, #clientModal .crm-tab-content').forEach(e=>e.classList.remove('active')); 
    document.getElementById(`tabBtn-${tab}`).classList.add('active'); 
    document.getElementById(`crm-${tab}`).classList.add('active'); 
};

window.renderModalBoards = () => {
    const c = document.getElementById('cBoardsList'); c.innerHTML = '';
    if(Object.keys(tempBoards).length === 0) { c.innerHTML = '<div style="font-size:13px; color:var(--text-muted);">המשפחה לא משויכת לאף פרויקט כרגע.</div>'; return; }
    Object.entries(tempBoards).forEach(([bid, status]) => {
        const board = db.__BOARDS__.find(b => b.id === bid);
        if(!board) return;
        let selHtml = `<select class="inline-input" style="padding:4px; font-size:13px;" onchange="tempBoards['${bid}']=this.value; markDirty()">`;
        board.columns.forEach(col => { selHtml += `<option value="${col}" ${status===col?'selected':''}>${col}</option>`; });
        selHtml += `</select>`;
        c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--surface); padding:6px 10px; border-radius:6px; border:1px solid var(--border-light);">
            <span style="font-weight:600; font-size:14px; width:40%; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${board.name}</span>
            <div style="display:flex; gap:8px; align-items:center; width:55%;">
                ${selHtml} <button class="btn-icon" style="color:var(--danger); border:none; padding:2px;" onclick="delete tempBoards['${bid}']; markDirty(); renderModalBoards();" title="הסר מהלוח"><i class="fas fa-times"></i></button>
            </div></div>`;
    });
};
window.addModalBoard = async () => {
    let unjoined = db.__BOARDS__.filter(b => !b.archived && !tempBoards[b.id]);
    if(unjoined.length === 0) { showToast("המשפחה כבר משויכת לכל הפרויקטים הפעילים", "warning"); return; }
    let opts = unjoined.map((b, i) => `${i+1}. ${b.name}`).join('\n');
    
    const num = await showCustomDialog({ title: 'צירוף לפרויקט', message: `לאיזה פרויקט לצרף?\nהקש מספר:\n${opts}`, showInput: true });
    if(num && !isNaN(num) && num > 0 && num <= unjoined.length) {
        const chosen = unjoined[num-1];
        tempBoards[chosen.id] = chosen.columns[0]; 
        markDirty(); renderModalBoards();
    } else if(num) {
        showToast('מספר לא תקין, נסה שוב', 'warning');
    }
};

function renderModalTags() { document.getElementById('cTagsContainer').innerHTML = appSettings.tags.map(t => `<span class="tag-bubble ${tempTags.includes(t)?'active':''}" onclick="toggleTempTag('${t}')">${t}</span>`).join(''); }
window.toggleTempTag = (t) => { markDirty(); if(tempTags.includes(t)) tempTags=tempTags.filter(x=>x!==t); else tempTags.push(t); renderModalTags(); };

window.renderModalChildren = () => { 
    document.getElementById('childrenWrapper').innerHTML = tempChildren.map((c,i) => `
        <div style="display:flex; flex-direction:column; gap:5px; padding:8px; background:var(--surface); border:1px solid var(--border-light); border-radius:6px;">
            <div style="display:flex; gap:5px; align-items:center;">
                <input type="text" placeholder="שם הילד/ה" value="${c.name||''}" oninput="tempChildren[${i}].name=this.value;markDirty()" class="inline-input" style="flex:1;">
                <input type="date" value="${c.dob||''}" onchange="tempChildren[${i}].dob=this.value;markDirty()" class="inline-input" style="flex:1;">
                <button onclick="toggleChildPhone(${i})" class="btn-icon" title="הוסף פרטי קשר" style="color:var(--accent);border:none;"><i class="fas fa-phone"></i></button>
                <button onclick="tempChildren.splice(${i},1);markDirty();renderModalChildren()" class="btn-icon" style="color:var(--danger);border:none;"><i class="fas fa-trash"></i></button>
            </div>
            ${c.showPhone || c.phone || c.email ? `<div style="display:flex; gap:5px;">
                <input type="text" placeholder="טלפון של הילד" value="${c.phone||''}" oninput="tempChildren[${i}].phone=this.value; formatPhone(this); markDirty()" class="inline-input" dir="ltr" style="text-align:right;">
                <input type="email" placeholder="מייל הילד" value="${c.email||''}" oninput="tempChildren[${i}].email=this.value; markDirty()" class="inline-input" dir="ltr" style="text-align:right;">
            </div>` : ''}
        </div>
    `).join(''); 
};
window.toggleChildPhone = (i) => { tempChildren[i].showPhone = !tempChildren[i].showPhone; renderModalChildren(); };
window.addModalChild = () => { markDirty(); tempChildren.push({name:'',dob:'', phone:'', email:'', showPhone: false}); renderModalChildren(); };

function renderCustomFields() {
    const c = document.getElementById('cCustomFieldsContainer'); c.innerHTML = '';
    appSettings.customFields.forEach(f => { c.innerHTML += `<div class="form-group"><label>${f}</label><input type="text" placeholder="הזן ערך..." value="${tempCustom[f]||''}" oninput="tempCustom['${f}']=this.value;markDirty()"></div>`; });
}

function renderTasks() {
    document.getElementById('cTasksList').innerHTML = tempTasks.length===0 ? '<div class="empty-state"><i class="fas fa-check-double"></i><div>אין משימות פתוחות.</div></div>' : tempTasks.map((t,i) => `
        <div class="log-item" style="opacity:${t.done?0.6:1};"><div class="log-header"><span style="text-decoration:${t.done?'line-through':'none'};"><input type="checkbox" ${t.done?'checked':''} onchange="tempTasks[${i}].done=this.checked;markDirty();renderTasks()" style="margin-left:8px;">${t.text}</span><div><span style="color:var(--text-muted);font-size:11px;margin-left:10px;">${t.date||''}</span><button onclick="tempTasks.splice(${i},1);markDirty();renderTasks()" style="background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fas fa-trash"></i></button></div></div></div>
    `).join('');
}
window.addTask = (text='', date='') => { const t=text||document.getElementById('newTaskText').value, d=date||document.getElementById('newTaskDate').value; if(!t){ showToast('יש להזין תוכן למשימה', 'warning'); return; } markDirty(); tempTasks.push({text:t,date:d,done:false}); document.getElementById('newTaskText').value=''; renderTasks(); };

function renderLogs() { document.getElementById('cLogsList').innerHTML = tempLogs.length===0 ? '<div class="empty-state"><i class="fas fa-comments"></i><div>עוד לא נוצר קשר. זה הזמן!</div></div>' : tempLogs.sort((a,b)=>new Date(b.date)-new Date(a.date)).map((l,i) => `<div class="log-item"><div class="log-header"><span><i class="fas fa-calendar-alt"></i> ${l.date} - ${l.type}</span><button onclick="tempLogs.splice(${i},1);markDirty();renderLogs()" style="background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fas fa-times"></i></button></div><div>${l.text}</div></div>`).join(''); }
window.addInteractionLog = () => { const d=document.getElementById('newLogDate').value, t=document.getElementById('newLogType').value, txt=document.getElementById('newLogText').value; if(!d||!txt){ showToast('יש למלא תאריך ותיאור', 'warning'); return; } markDirty(); tempLogs.push({date:d,type:t,text:txt}); document.getElementById('newLogText').value=''; renderLogs(); };

function renderDonations() { let sum=tempDonations.reduce((a,b)=>a+Number(b.amount||0),0); document.getElementById('cDonationsSum').innerText=`₪${sum}`; document.getElementById('cDonationsList').innerHTML = tempDonations.length===0 ? '<div class="empty-state"><i class="fas fa-hand-holding-heart"></i><div>אין תרומות.</div></div>' : tempDonations.sort((a,b)=>new Date(b.date)-new Date(a.date)).map((d,i) => `<div class="log-item"><div class="log-header"><span style="color:var(--success);"><i class="fas fa-shekel-sign"></i> ${d.amount}</span><span>${d.date}</span></div><div>${d.reason} <button onclick="tempDonations.splice(${i},1);markDirty();renderDonations()" style="float:left;background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fas fa-trash"></i></button></div></div>`).join(''); }

window.addDonation = () => { 
    const d=document.getElementById('newDonDate').value, a=document.getElementById('newDonAmount').value, r=document.getElementById('newDonReason').value; 
    if(!d||!a){ showToast('יש למלא תאריך וסכום', 'warning'); return; } markDirty(); 
    tempDonations.push({date:d,amount:a,reason:r||'כללי'}); 
    if(Number(a) >= 500) { addTask(`להתקשר להגיד תודה אישית על התרומה (${a} ש"ח)`, d); showToast('נוצרה משימה להכרת הטוב! ' + getRandomCompliment(), 'info'); switchCrmTab('tasks'); }
    document.getElementById('newDonAmount').value=''; document.getElementById('newDonReason').value=''; renderDonations(); 
};

window.saveClientWithAuthCheck = () => ensureAuthAndExecute(() => {
    const a = db[currentBldg].apts[currentAptIdx];
    a.name=document.getElementById('cFamilyName').value; a.num=document.getElementById('cAptNum').value; a.father=document.getElementById('cFather').value; a.mother=document.getElementById('cMother').value; 
    a.fatherPhone=document.getElementById('cFatherPhone').value; a.motherPhone=document.getElementById('cMotherPhone').value; a.phones = '';
    a.fatherEmail=document.getElementById('cFatherEmail').value; a.motherEmail=document.getElementById('cMotherEmail').value;
    a.style=document.getElementById('cStyle').value; a.notes=document.getElementById('cNotes').value;
    a.boards={...tempBoards}; a.childrenList=[...tempChildren]; a.tags=[...tempTags]; a.interactions=[...tempLogs]; a.donations=[...tempDonations]; a.tasks=[...tempTasks]; a.customData={...tempCustom}; a.customFields=a.customData; // backward compat
    a.updatedAt = Date.now();
    isDirty=false; isCreatingNew=false; saveDB(); document.getElementById('clientModal').style.display='none'; showToast("עודכן בהצלחה! " + getRandomCompliment(), "success");
    if(currentMainView==='map' && currentBldg!==NO_ADDRESS_KEY) openBuildingModal();
});

window.openAddressSearch = (isMove=false) => { pendingMoveMode=isMove; document.getElementById('addressSearchModal').style.display='flex'; };

window.confirmAddressSelection = () => {
    if (!tempSelectedAddress) { showToast("אנא חפש ובחר כתובת מהרשימה תחילה", "warning"); return; }
    selectAddress(tempSelectedAddress.name, tempSelectedAddress.lng, tempSelectedAddress.lat);
    tempSelectedAddress = null;
    setTimeout(() => { modalGeocoder.clear(); }, 500);
};

window.removeAddress = () => { 
    tempSelectedAddress = null;
    if(modalGeocoder) modalGeocoder.clear();
    processAddressSelection(NO_ADDRESS_KEY); 
};

window.selectAddress = (b,lng,lat) => { if(!db[b]) db[b]={info:{code:'',rep:'',notes:'',coords:[lng,lat]},apts:[]}; processAddressSelection(b); };

function processAddressSelection(t) { 
    const wasOpen = document.getElementById('clientModal').style.display === 'flex';
    if(pendingMoveMode) { 
        let apt = db[currentBldg].apts.splice(currentAptIdx,1)[0]; 
        db[t].apts.push(apt);
        currentBldg = t;
        currentAptIdx = db[t].apts.length - 1;
        showToast('הכתובת עודכנה! ' + getRandomCompliment(),'success'); 
    } 
    pendingMoveMode = false;
    saveDB(); 
    document.getElementById('addressSearchModal').style.display='none'; 
    if(wasOpen) openClientCard(currentAptIdx); 
}

window.toggleAdvFilters = () => { 
    const el=document.getElementById('advFilters'); 
    if(el) el.style.display = (el.style.display==='flex' || el.style.display==='block') ? 'none' : 'flex'; 
};

function populateFilterDropdowns() {
    appSettings.styles = [...new Set(appSettings.styles)];
    document.getElementById('fStyle').innerHTML='<option value="">כל הסגנונות</option>'+appSettings.styles.map(x=>`<option value="${x}">${x}</option>`).join('');
    document.getElementById('fTag').innerHTML='<option value="">כל התגיות</option>'+appSettings.tags.map(x=>`<option value="${x}">${x}</option>`).join('');
    renderChipFilters();
}

window.openFilterGroup = null; // שמירת המצב של איזו קטגוריה פתוחה כרגע

function renderChipFilters() {
    const container = document.getElementById('chipFiltersContainer');
    if(!container) return;

    // currentFilters הוא מקור האמת — מערכים לרב-בחירה
    const curStyles  = currentFilters.style;
    const curTags    = currentFilters.tags;
    const curStatuses = currentFilters.status;
    const curMissingArr = window.missingDataFields || [];

    let html = '';

    // פונקציית עזר לבניית קבוצת סינון מתקפלת עם רב-בחירה
    const buildGroup = (groupId, title, icon, options, activeArr, isMissingField = false) => {
        if(options.length === 0) return '';
        const isOpen = window.openFilterGroup === groupId;
        // עבור smart_view — activeArr הוא string (לא מערך)
        const isSmartView = groupId === 'smart_view';
        const curVal = isSmartView ? activeArr : null;
        const hasActive = isSmartView ? (curVal && curVal !== 'v_all') : activeArr.length > 0;

        let activeText = title;
        if (hasActive && !isOpen) {
            if(isSmartView) {
                const activeView = (appSettings.smartViews || []).find(v => v.id === curVal);
                activeText = `${title}: ${activeView ? activeView.name : curVal}`;
            } else {
                activeText = `${title}: ${activeArr.length === 1
                    ? (options.find(o => (o.value || o.val || o) === activeArr[0])?.label || activeArr[0])
                    : activeArr.length + ' נבחרו'}`;
            }
        }

        let res = `<div class="chip-group" ${isMissingField ? 'style="margin-right:auto;"' : ''}>`;

        res += `<div class="filter-chip ${hasActive && !isOpen ? 'active' : ''}" 
                     style="${hasActive && !isOpen ? '' : 'background:var(--surface); border-color:var(--border-light); color:var(--text-main);'}" 
                     onclick="window.openFilterGroup=window.openFilterGroup==='${groupId}'?null:'${groupId}'; renderChipFilters();">
                    <i class="${icon}" style="margin-left:6px; opacity:0.7;"></i>${activeText}
                    ${hasActive ? `<i class="fas fa-times" style="margin-right:6px; font-size:10px; opacity:0.7;" onclick="event.stopPropagation(); clearFilterGroup('${groupId}');"></i>` : `<i class="fas fa-chevron-${isOpen?'up':'down'}" style="margin-right:6px; font-size:10px; opacity:0.5;"></i>`}
                </div>`;

        if (isOpen) {
            options.forEach(opt => {
                const val = opt.val || opt.value || opt;
                const label = opt.label || opt;
                const color = opt.color || (isSmartView ? 'var(--accent)' : getColorForString(val, groupId));
                const isActive = isSmartView ? (curVal === val) : activeArr.includes(val);
                const iconHtml = opt.icon ? `<i class="fas ${opt.icon}" style="margin-left:5px; opacity:0.8;"></i>` : '';

                let clickFn = '';
                if(isMissingField) {
                    clickFn = `toggleMissingField('${val}');`;
                } else if(isSmartView) {
                    if(val === 'edit_rules') {
                        clickFn = `openSmartViewsManager();`;
                    } else {
                        clickFn = `applySmartView('${isActive ? 'v_all' : val}'); renderChipFilters();`;
                    }
                } else {
                    clickFn = `toggleFilterVal('${groupId}','${val}');`;
                }

                res += `<div class="filter-chip ${isActive ? 'active' : ''}" style="--chip-color:${color}" onclick="${clickFn}">${iconHtml}${label}${isActive && !isSmartView ? ' <i class="fas fa-check" style="font-size:10px; margin-right:4px;"></i>' : ''}</div>`;
            });
        }
        res += `</div>`;
        if(!isMissingField) res += `<div class="chip-divider"></div>`;
        return res;
    };

    // 1. סטטוס קשר
    html += buildGroup('status', 'סטטוס', 'fas fa-chart-line', [
        { val:'green',  label:'קשר טרי',   color:'#10b981' },
        { val:'orange', label:'קשר בינוני', color:'#f59e0b' },
        { val:'red',    label:'לטיפול דחוף',color:'#ef4444' }
    ], curStatuses);

    // 2. סגנון
    html += buildGroup('style', 'סגנון', 'fas fa-palette', appSettings.styles, curStyles);

    // 3. תגיות
    html += buildGroup('tag', 'תגיות', 'fas fa-tags', appSettings.tags, curTags);

    // 4. איתור חסרים
    const missingFields = [
        { value:'phone',   label:'חסר טלפון'  },
        { value:'email',   label:'חסר מייל'   },
        { value:'address', label:'חסרה כתובת' },
        { value:'style',   label:'ללא סגנון'  },
        { value:'notes',   label:'ללא הערות'  },
        { value:'tags',    label:'ללא תגיות'  },
        ...(appSettings.customFields||[]).map(f=>({ value:'custom_'+f, label:`חסר: ${f}` }))
    ];
    html += buildGroup('missing', 'איתור חסרים', 'fas fa-search-minus', missingFields, curMissingArr, true);

    // 5. תצוגות חכמות
    const smartViewOptions = (appSettings.smartViews || []).map(v => ({ value: v.id, label: v.name, icon: v.icon }));
    smartViewOptions.push({ value: 'edit_rules', label: 'ערוך כללים...', icon: 'fa-cog', color: '#64748b' });
    html += buildGroup('smart_view', 'תצוגה חכמה', 'fas fa-magic', smartViewOptions, window.activeSmartView || 'v_all');

    container.innerHTML = html;
}

// טוגל ערך בסינון רגיל (סגנון / תגית / סטטוס)
window.toggleFilterVal = (groupId, val) => {
    const key = groupId === 'tag' ? 'tags' : (groupId === 'style' ? 'style' : 'status');
    const arr = currentFilters[key];
    const idx = arr.indexOf(val);
    if(idx === -1) arr.push(val); else arr.splice(idx, 1);
    handleOmniSearch();
    renderChipFilters();
};

// ניקוי קבוצה שלמה
window.clearFilterGroup = (groupId) => {
    if(groupId === 'missing') {
        window.missingDataFields = [];
        window.missingDataField = '';
    } else if(groupId === 'smart_view') {
        window.activeSmartView = 'v_all';
        handleOmniSearch();
        renderChipFilters();
        return;
    } else {
        const key = groupId === 'tag' ? 'tags' : (groupId === 'style' ? 'style' : 'status');
        currentFilters[key] = [];
    }
    handleOmniSearch();
    renderChipFilters();
};

// טוגל שדה חסר (רב-בחירה)
window.toggleMissingField = (val) => {
    if(!window.missingDataFields) window.missingDataFields = [];
    const idx = window.missingDataFields.indexOf(val);
    if(idx === -1) window.missingDataFields.push(val); else window.missingDataFields.splice(idx, 1);
    window.missingDataField = window.missingDataFields[0] || '';
    handleOmniSearch();
    renderChipFilters();
};

window.applyAdvFilters = () => { handleOmniSearch(); };

window.handleOmniSearch = () => {
    const el = document.getElementById('smartSearch');
    if(!el) return;
    
    const q=el.value.toLowerCase(), dd=document.getElementById('searchDropdown'); let res=[];
    Object.keys(db).forEach(b => { 
        if(b === '__BOARDS__' || b === '__SETTINGS__' || b === 'meta') return;
        if(!db[b] || !db[b].apts) return;
        db[b].apts.forEach((a,i) => {
        let txt=`${b} ${a.name} ${getAllPhones(a).join(' ')} ${getAllEmails(a).join(' ')} ${a.notes||''} ${(a.tags||[]).join(' ')} ${a.father||''} ${a.mother||''}`.toLowerCase();
        let matchQ = q.length<2 || txt.includes(q);
        let matchStyle = currentFilters.style.length===0 || currentFilters.style.includes(a.style);
        let matchTag = currentFilters.tags.length===0 || currentFilters.tags.some(t=>(a.tags||[]).includes(t));
        let col = getStatusColor(a);
        let matchStat = currentFilters.status.length===0 || 
            (currentFilters.status.includes('green')&&col==='#10b981') || 
            (currentFilters.status.includes('orange')&&col==='#f59e0b') || 
            (currentFilters.status.includes('red')&&(col==='#ef4444'||col==='#94a3b8'));
            
        // בדיקת נתונים חסרים — רב-בחירה (OR logic)
        let matchMissing = true;
        const missingFieldsArr = (window.missingDataFields && window.missingDataFields.length > 0)
            ? window.missingDataFields
            : (window.missingDataField ? [window.missingDataField] : []);
        if(missingFieldsArr.length > 0) {
            matchMissing = missingFieldsArr.some(f => {
                if(f === 'phone') return getAllPhones(a).length === 0;
                if(f === 'email') return getAllEmails(a).length === 0;
                if(f === 'address') return b === NO_ADDRESS_KEY;
                if(f === 'style') return !a.style;
                if(f === 'notes') return !a.notes || a.notes.trim() === '';
                if(f === 'tags') return !a.tags || a.tags.length === 0;
                if(f.startsWith('custom_')) {
                    const fieldName = f.replace('custom_', '');
                    const customObj = a.customData || a.customFields || {};
                    return !customObj[fieldName];
                }
                return false;
            });
        }

        // לוגיקת Smart Views (מנוע מורחב עם תמיכה אחורה)
        let matchSmartView = true;
        if(window.activeSmartView && window.activeSmartView !== 'v_all') {
            const view = (appSettings.smartViews || []).find(v => v.id === window.activeSmartView);
            if(view) {
                const rule = view.rule;
                if(rule === 'child_age') {
                    const targetAge = parseInt(view.param1 || view.value);
                    const currentYear = new Date().getFullYear();
                    matchSmartView = (a.childrenList || []).some(c => c.dob && (currentYear - new Date(c.dob).getFullYear()) === targetAge);
                }
                else if(rule === 'no_interaction') {
                    const typeFilter = view.param1 || 'כלשהו';
                    const months = parseInt(view.param2 || view.value || 3);
                    let logs = (a.interactions || []);
                    if(typeFilter !== 'כלשהו') logs = logs.filter(i => i.type === typeFilter);
                    if(logs.length === 0) matchSmartView = true;
                    else {
                        const lastDate = new Date(Math.max.apply(null, logs.map(i => new Date(i.date))));
                        matchSmartView = ((new Date() - lastDate) / (1000 * 60 * 60 * 24 * 30)) >= months;
                    }
                }
                else if(rule === 'has_open_tasks') {
                    matchSmartView = (a.tasks || []).some(t => !t.done);
                }
                else if(rule === 'in_project') {
                    matchSmartView = !!(a.boards && a.boards[view.param1] !== undefined);
                }
                // תאימות אחורה לכללים ישנים
                else if(rule === 'no_visit_3m') {
                    const visits = (a.interactions || []).filter(i => i.type === 'ביקור');
                    if(visits.length === 0) matchSmartView = true;
                    else {
                        const last = new Date(Math.max.apply(null, visits.map(i => new Date(i.date))));
                        matchSmartView = ((new Date() - last) / (1000 * 60 * 60 * 24 * 30)) > 3;
                    }
                }
                else if(rule === 'bday_month') {
                    const currentMonth = new Date().getMonth();
                    matchSmartView = (a.childrenList || []).some(c => c.dob && new Date(c.dob).getMonth() === currentMonth);
                }
                else if(rule === 'no_visit_months' || rule === 'no_call_months') {
                    const months = parseInt(view.value || 3);
                    const type = rule === 'no_visit_months' ? 'ביקור' : 'שיחה';
                    const logs = (a.interactions || []).filter(i => i.type === type);
                    if(logs.length === 0) matchSmartView = true;
                    else {
                        const last = new Date(Math.max.apply(null, logs.map(i => new Date(i.date))));
                        matchSmartView = ((new Date() - last) / (1000 * 60 * 60 * 24 * 30)) >= months;
                    }
                }
                else if(rule === 'has_tag') {
                    matchSmartView = (a.tags || []).includes(view.value);
                }
            }
        }

        if(matchQ && matchStyle && matchTag && matchStat && matchMissing && matchSmartView) res.push({bldg:b, idx:i, apt:a});
    });});
    
    window.currentFilteredData = res;
    
    if(q.length>=2 && res.length>0) { 
        dd.style.display='block'; 
        dd.innerHTML=res.slice(0,15).map(r=>`<div class="search-item" onclick="jumpToSearchResult('${encodeURIComponent(r.bldg)}',${r.idx})"><div class="search-item-title">${r.apt.name||'ללא שם'} <span style="font-size:12px;">(${r.bldg===NO_ADDRESS_KEY?'ללא כתובת':r.bldg})</span></div></div>`).join(''); 
    } else { 
        if(dd) dd.style.display='none'; 
    }
    
    refreshMap(res); 
    if(currentMainView==='table') renderListView(res);
    if(currentMainView==='kanban') renderKanbanView(res);
};

window.jumpToSearchResult = (b,i) => { 
    document.getElementById('searchDropdown').style.display='none'; 
    currentBldg = decodeURIComponent(b); 
    document.getElementById('smartSearch').value=''; 
    handleOmniSearch(); 
    if(currentMainView === 'map') {
        let coords = null;
        if(currentBldg !== NO_ADDRESS_KEY && db[currentBldg].info && db[currentBldg].info.coords) {
            coords = db[currentBldg].info.coords;
        } else if (currentBldg !== NO_ADDRESS_KEY) {
            coords = currentBldg.split(',').map(Number); 
        }
        if(coords && !isNaN(coords[0])) {
            map.flyTo({ center: coords, zoom: 19, pitch: 60 });
            setTimeout(() => { openClientCard(i); }, 1200);
        } else {
            openClientCard(i); 
        }
    } else {
        openClientCard(i); 
    }
};

let ctxBldg = null, ctxIdx = null;
window.showContextMenu = (e, b, i) => {
    e.preventDefault();
    ctxBldg = decodeURIComponent(b);
    ctxIdx = i;
    const m = document.getElementById('contextMenu');
    m.style.display = 'block';
    m.style.position = 'fixed'; // קיבוע לפי מסך למניעת בעיות גלילה
    m.style.left = e.clientX + 'px';
    m.style.top = e.clientY + 'px';
};
window.ctxEdit = () => { currentBldg = ctxBldg; document.getElementById('contextMenu').style.display='none'; openClientCard(ctxIdx); };
window.ctxMove = () => { currentBldg = ctxBldg; currentAptIdx = ctxIdx; document.getElementById('contextMenu').style.display='none'; pendingMoveMode=true; document.getElementById('addressSearchModal').style.display='flex'; };

window.ctxDelete = () => { 
    document.getElementById('contextMenu').style.display='none'; 
    ensureAuthAndExecute(() => { 
        let deletedData = db[ctxBldg].apts.splice(ctxIdx, 1)[0]; 
        let deletedBldg = ctxBldg;
        saveDB(); 
        handleOmniSearch();
        showUndoToast("המשפחה נמחקה", () => {
            db[deletedBldg].apts.push(deletedData); // התיקון: דחיפה לסוף המערך למניעת התנגשויות
            saveDB();
            handleOmniSearch(); // רענון תצוגה
            showToast("המחיקה בוטלה, המשפחה שוחזרה!", "success");
        }); 
    }); 
};

// תיקון באג קליק מחוץ לרשימה שסגר אותה מוקדם מדי
document.addEventListener('click', (e) => { 
    const searchBox = document.getElementById('smartSearch');
    const dropDown = document.getElementById('searchDropdown');
    
    if (searchBox && dropDown && !searchBox.contains(e.target) && !dropDown.contains(e.target)) {
        dropDown.style.display = 'none';
    }
    
    const ctx = document.getElementById('contextMenu');
    if (ctx && ctx.style.display === 'block' && !ctx.contains(e.target)) { ctx.style.display = 'none'; }

    const colMenu = document.getElementById('colChooserMenu');
    if (colMenu && colMenu.style.display === 'block' && !e.target.closest('.column-chooser-dropdown') && !e.target.closest('button[onclick*="toggleTableColumnsMenu"]')) {
        colMenu.style.display = 'none';
    }
    
    if(e.target.classList.contains('modal')){
        if(e.target.id==='clientModal') attemptCloseCrmModal();
        else if(e.target.id!=='customDialogModal' && e.target.id!=='onboardingModal') e.target.style.display='none';
    } 
});

function getStatusColor(a) { const logs=a.interactions||[]; if(logs.length===0) return '#94a3b8'; const last=[...logs].sort((x,y)=>new Date(y.date)-new Date(x.date))[0].date; const diff=(new Date()-new Date(last))/86400000; return diff<=30?'#10b981':(diff<=90?'#f59e0b':'#ef4444'); }
window.flyToBuildingFromTable = (bEnc) => { const b=decodeURIComponent(bEnc); if(b===NO_ADDRESS_KEY||!db[b].info.coords) {showToast('ללא מיקום מפה','error');return;} switchMainView('map'); map.flyTo({center:db[b].info.coords,zoom:19,pitch:60}); setTimeout(()=>{currentBldg=b;openBuildingModal();},1200); };

window.createNewBoard = async () => {
    const name = await showCustomDialog({ title: 'פרויקט חדש', message: 'הכנס שם לפרויקט החדש (למשל: רישום לקייטנה):', showInput: true });
    if(!name) return;
    const newId = 'b_' + Date.now();
    db.__BOARDS__.push({ id: newId, name: name, columns: ['חדש', 'בטיפול', 'הושלם'], archived: false });
    saveDB(); showToast("פרויקט נפתח בהצלחה! " + getRandomCompliment(), "success"); renderKanbanView();
};
window.editCurrentBoard = async () => {
    const sel = document.getElementById('activeKanbanBoard'); const bId = sel.value;
    const board = db.__BOARDS__.find(b => b.id === bId);
    if(!board) return;
    const cols = await showCustomDialog({ title: 'עריכת עמודות', message: `ערוך עמודות לפרויקט "${board.name}" (הפרד בפסיק):`, showInput: true, defaultValue: board.columns.join(', ') });
    if(cols) { board.columns = cols.split(',').map(c => c.trim()); saveDB(); renderKanbanView(); showToast("עמודות עודכנו", "success"); }
};
window.toggleBoardArchive = (id) => {
    let b = db.__BOARDS__.find(x => x.id === id);
    b.archived = !b.archived;
    saveDB(); renderKanbanView();
    showToast(b.archived ? "הפרויקט ננעל והועבר לארכיון" : "הפרויקט שוחזר לפעילות", "success");
};
window.deleteBoard = async (id) => {
    const proceed = await showCustomDialog({ title: 'מחיקת פרויקט', message: 'האם למחוק את הפרויקט לחלוטין? (הפעולה לא תמחק את המשפחות, אלא רק את הלוח)', showCancel: true });
    if(proceed) {
        db.__BOARDS__ = db.__BOARDS__.filter(x => x.id !== id);
        Object.keys(db).forEach(bldg => {
           if(bldg !== '__BOARDS__' && bldg !== '__SETTINGS__' && bldg !== 'meta' && db[bldg] && db[bldg].apts) { db[bldg].apts.forEach(a => { if(a.boards && a.boards[id]) delete a.boards[id]; }); }
        });
        saveDB(); renderKanbanView(); showToast("הפרויקט נמחק לצמיתות", "success");
    }
};

window.renderKanbanView = (filteredRes = null) => {
    const sel = document.getElementById('activeKanbanBoard');
    let currentBoardId = sel.value;
    
    let activeOptions = db.__BOARDS__.filter(b=>!b.archived).map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    let archivedOptions = db.__BOARDS__.filter(b=>b.archived).map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    sel.innerHTML = `<optgroup label="פרויקטים פעילים">${activeOptions}</optgroup><optgroup label="ארכיון (סגורים)">${archivedOptions}</optgroup>`;
    
    if(currentBoardId && db.__BOARDS__.find(b=>b.id===currentBoardId)) sel.value = currentBoardId;
    else currentBoardId = db.__BOARDS__[0].id;
    
    const activeBoard = db.__BOARDS__.find(b => b.id === currentBoardId);
    
    if (!activeBoard) {
        document.getElementById('activeKanbanBoard').value = 'b_default';
        return renderKanbanView(filteredRes);
    }
    
    const actionsSpan = document.getElementById('kanbanBoardActions');
    if(activeBoard.id === 'b_default') {
         actionsSpan.innerHTML = `
             <button class="btn-icon" onclick="editCurrentBoard()"><i class="fas fa-cog"></i> ערוך עמודות</button> 
             <span class="tag-badge" style="background:#e2e8f0; color:#64748b; border:none; margin-right:10px;"><i class="fas fa-lock"></i> מוגן</span>`;
    } else if(activeBoard.archived) {
         actionsSpan.innerHTML = `
             <span class="tag-badge" style="background:rgba(239,68,68,0.1); color:var(--danger); border:none; margin-left:10px;"><i class="fas fa-archive"></i> בארכיון</span>
             <button class="btn-icon" onclick="toggleBoardArchive('${activeBoard.id}')" title="שחזר פרויקט"><i class="fas fa-unlock"></i> שחזר</button> 
             <button class="btn-icon" style="color:var(--danger);" onclick="deleteBoard('${activeBoard.id}')" title="מחק פרויקט"><i class="fas fa-trash"></i></button>`;
    } else {
         actionsSpan.innerHTML = `
             <button class="btn-icon" onclick="editCurrentBoard()"><i class="fas fa-cog"></i> ערוך עמודות</button> 
             <button class="btn-icon" onclick="toggleBoardArchive('${activeBoard.id}')" title="נעל והעבר לארכיון"><i class="fas fa-archive"></i> לארכיון</button>
             <button class="btn-icon" style="color:var(--danger);" onclick="deleteBoard('${activeBoard.id}')" title="מחק פרויקט"><i class="fas fa-trash"></i></button>`;
    }

    const c = document.getElementById('kanban-board-scroll'); c.innerHTML = '';
    if(!activeBoard) return;

    let arr = filteredRes || []; 
    if(!filteredRes) Object.keys(db).forEach(b=>{ if(b!=='__BOARDS__' && b!=='__SETTINGS__' && b!=='meta' && db[b] && db[b].apts) db[b].apts.forEach((a,i)=>arr.push({bldg:b,idx:i,apt:a})) });
    
    activeBoard.columns.forEach(stage => {
        let colCards = arr.filter(r => r.apt.boards && r.apt.boards[currentBoardId] === stage);
        let colHtml = `<div class="kanban-col" data-stage="${escapeHTML(stage)}" ondragover="allowDrop(event)" ondragleave="dragLeave(event)" ondrop="dropCard(event, '${stage}')"><div class="kanban-header">${escapeHTML(stage)} <span style="background:rgba(0,0,0,0.2);padding:2px 8px;border-radius:12px;font-size:12px;">${colCards.length}</span></div><div class="kanban-body">`;
        colCards.forEach(r => {
            const safeName = escapeHTML(r.apt.name || 'ללא שם');
            const safeBldg = escapeHTML(r.bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : r.bldg);
            colHtml += `<div class="kanban-card" data-enc-bldg="${encodeURIComponent(r.bldg)}" data-idx="${r.idx}" draggable="true" ondragstart="dragCard(event, '${encodeURIComponent(r.bldg)}', ${r.idx})" onclick="currentBldg='${r.bldg}'; openClientCard(${r.idx})"><div class="kanban-card-title">${safeName}</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:5px;">${safeBldg}</div></div>`;
        });
        c.innerHTML += colHtml + `</div></div>`;
    });

    // חיבור אירועי מגע לכל כרטיסייה לאחר הרינדור
    c.querySelectorAll('.kanban-card').forEach(cardEl => {
        const encBldg = cardEl.getAttribute('data-enc-bldg');
        const idx = cardEl.getAttribute('data-idx');
        if(encBldg !== null && idx !== null) initTouchDrag(cardEl, encBldg, parseInt(idx));
    });
};

window.allowDrop = (e) => { 
    const activeBoard = db.__BOARDS__.find(b => b.id === document.getElementById('activeKanbanBoard').value);
    if(activeBoard && activeBoard.archived) return; 
    e.preventDefault(); e.currentTarget.classList.add('drag-over'); 
};
window.dragLeave = (e) => { e.currentTarget.classList.remove('drag-over'); };
window.dragCard = (e, encBldg, idx) => { 
    const activeBoard = db.__BOARDS__.find(b => b.id === document.getElementById('activeKanbanBoard').value);
    if(activeBoard && activeBoard.archived) { e.preventDefault(); return; } 
    e.dataTransfer.setData("text/plain", `${encBldg}|${idx}`); e.dataTransfer.effectAllowed = "move"; 
};
window.dropCard = (e, stage) => {
    e.preventDefault(); e.currentTarget.classList.remove('drag-over');
    const data = e.dataTransfer.getData("text/plain");
    if(data) {
        const [encBldg, idx] = data.split('|'); const bldg = decodeURIComponent(encBldg);
        const activeBoardId = document.getElementById('activeKanbanBoard').value;
        db[bldg].apts[idx].boards[activeBoardId] = stage;
        saveDB(); showToast(`הועבר ל-${stage}`, 'info');
    }
};

// --- גרירה במגע (Touch Drag & Drop) ---
let touchDragData = null, touchGhost = null;

function initTouchDrag(cardEl, encBldg, idx) {
    cardEl.addEventListener('touchstart', (e) => {
        const activeBoard = db.__BOARDS__.find(b => b.id === document.getElementById('activeKanbanBoard').value);
        if(activeBoard && activeBoard.archived) return;

        touchDragData = { encBldg, idx };

        // יצירת "רוח רפאים" שזזה עם האצבע
        touchGhost = cardEl.cloneNode(true);
        touchGhost.style.cssText = `position:fixed; opacity:0.75; pointer-events:none; z-index:9999; width:${cardEl.offsetWidth}px; transform:rotate(2deg); box-shadow:0 8px 24px rgba(0,0,0,0.25);`;
        document.body.appendChild(touchGhost);
    }, { passive: true });

    cardEl.addEventListener('touchmove', (e) => {
        if(!touchDragData) return;
        e.preventDefault();
        const t = e.touches[0];
        touchGhost.style.left = (t.clientX - touchGhost.offsetWidth / 2) + 'px';
        touchGhost.style.top  = (t.clientY - 30) + 'px';

        // הדגשת העמודה שמתחת לאצבע
        document.querySelectorAll('.kanban-col').forEach(col => col.classList.remove('drag-over'));
        touchGhost.style.display = 'none';
        const elBelow = document.elementFromPoint(t.clientX, t.clientY);
        touchGhost.style.display = '';
        const col = elBelow && elBelow.closest('.kanban-col');
        if(col) col.classList.add('drag-over');
    }, { passive: false });

    cardEl.addEventListener('touchend', (e) => {
        if(!touchDragData) return;
        const t = e.changedTouches[0];

        // הסרת הדגשות
        document.querySelectorAll('.kanban-col').forEach(col => col.classList.remove('drag-over'));
        if(touchGhost) { touchGhost.remove(); touchGhost = null; }

        // זיהוי העמודה שעליה שוחררה הכרטיסייה
        const elBelow = document.elementFromPoint(t.clientX, t.clientY);
        const targetCol = elBelow && elBelow.closest('.kanban-col');
        if(targetCol && targetCol.dataset.stage) {
            const bldg = decodeURIComponent(touchDragData.encBldg);
            const activeBoardId = document.getElementById('activeKanbanBoard').value;
            db[bldg].apts[touchDragData.idx].boards[activeBoardId] = targetCol.dataset.stage;
            saveDB();
            renderKanbanView();
            showToast(`הועבר ל-${targetCol.dataset.stage}`, 'info');
        }
        touchDragData = null;
    });
}

window.toggleAllBulk = (cb) => { const cbs=document.querySelectorAll('.bulk-cb'); cbs.forEach(c=>c.checked=cb.checked); updateBulkBar(); };
window.updateBulkBar = () => { bulkSelection=[]; document.querySelectorAll('.bulk-cb:checked').forEach(c=>bulkSelection.push(c.value)); const bar=document.getElementById('bulkActionBar'); if(bulkSelection.length>0){bar.style.display='flex'; document.getElementById('bulkCount').innerText=`${bulkSelection.length} סומנו`;} else bar.style.display='none'; };
window.clearBulkSelection = () => { document.querySelectorAll('.bulk-cb').forEach(c=>c.checked=false); const sa=document.getElementById('bulkSelectAll'); if(sa) sa.checked=false; updateBulkBar(); };

window.bulkWhatsApp = () => { 
    if(bulkSelection.length === 0) return showToast("יש לסמן משפחות קודם!", "warning");
    const saved = [...bulkSelection];
    clearBulkSelection();
    document.getElementById('bulkActionBar').style.display = 'none';
    switchMainView('comm');
    bulkSelection = saved;
    switchCommTab('whatsapp');
};

window.bulkEmail = () => { 
    if(bulkSelection.length === 0) return showToast("יש לסמן משפחות קודם!", "warning");
    const saved = [...bulkSelection];
    clearBulkSelection();
    document.getElementById('bulkActionBar').style.display = 'none';
    switchMainView('comm');
    bulkSelection = saved;
    switchCommTab('email');
};

window.bulkPhone = () => {
    let p=[]; 
    bulkSelection.forEach(v=>{
        let [b,i]=v.split('|'); let a=db[b].apts[i]; 
        let phones = getAllPhones(a);
        if(phones.length > 0) p.push(phones[0].replace(/\D/g,'')); 
    }); 
    if(p.length>0) { 
        window.open(`tel:${p[0]}`, '_self'); 
        if(p.length > 1) showToast(`נפתח חייגן לנמען הראשון. רשימת החיוג תנוהל במרכז התקשורת בקרוב.`, 'warning');
        else showToast(`מחייג...`, 'success');
    } else {
        showToast(`לא נמצאו מספרים למשפחות שסומנו`, 'error');
    }
    clearBulkSelection(); 
};

window.bulkAddTagPrompt = async () => { 
    if(bulkSelection.length === 0) return showToast("יש לסמן משפחות קודם!", "warning");
    const t = await showCustomDialog({ title: 'תגית המונית', message: 'הקלד תגית להוספה למשפחות:', showInput: true });
    if(t) { 
        ensureAuthAndExecute(()=>{ 
            bulkSelection.forEach(v=>{let [b,i]=v.split('|'); let a=db[b].apts[i]; if(!a.tags)a.tags=[]; if(!a.tags.includes(t))a.tags.push(t); }); 
            if(!appSettings.tags.includes(t)) {appSettings.tags.push(t); localStorage.setItem('crm_prefs',JSON.stringify(appSettings)); saveDB(); populateFilterDropdowns();} 
            saveDB(); clearBulkSelection(); showToast("תגית נוספה! " + getRandomCompliment(),"success"); 
        }); 
    } 
};

window.bulkAddToBoardPrompt = async () => {
    if(bulkSelection.length === 0) return showToast("יש לסמן משפחות קודם!", "warning");
    const activeBoards = db.__BOARDS__.filter(b => !b.archived);
    if(activeBoards.length === 0) return showToast("אין פרויקטים פעילים במערכת", "warning");
    const opts = activeBoards.map((b, i) => `${i+1}. ${b.name}`).join('\n');
    const num = await showCustomDialog({ title: 'צירוף המוני לפרויקט', message: `לאיזה פרויקט לצרף את ${bulkSelection.length} המשפחות?\n${opts}`, showInput: true });
    if(!num || isNaN(num) || num < 1 || num > activeBoards.length) return;
    const board = activeBoards[num - 1];
    ensureAuthAndExecute(() => {
        bulkSelection.forEach(v => {
            let [b, i] = v.split('|');
            let a = db[b].apts[i];
            if(!a.boards) a.boards = {};
            if(!a.boards[board.id]) a.boards[board.id] = board.columns[0];
        });
        saveDB();
        clearBulkSelection();
        showToast(`${bulkSelection.length} משפחות צורפו ל"${board.name}"! ${getRandomCompliment()}`, "success");
    });
};

window.bulkDelete = async () => { 
    if(bulkSelection.length === 0) return showToast("יש לסמן משפחות קודם!", "warning");
    const proceed = await showCustomDialog({ title: 'מחיקה המונית', message: `למחוק ${bulkSelection.length} משפחות? פעולה בלתי הפיכה!`, showCancel: true });
    if(proceed) { 
        ensureAuthAndExecute(()=>{ 
            bulkSelection.sort((x,y)=>Number(y.split('|')[1])-Number(x.split('|')[1])).forEach(v=>{let [b,i]=v.split('|'); db[b].apts.splice(i,1);}); 
            saveDB(); clearBulkSelection(); showToast("נמחקו","success"); 
        }); 
    } 
};

window.bulkRoute = () => {
    if(bulkSelection.length === 0) return showToast("יש לסמן משפחות קודם!", "warning");
    let waypoints = [];
    bulkSelection.forEach(v => {
        let [b, i] = v.split('|');
        if(b !== NO_ADDRESS_KEY) { waypoints.push(encodeURIComponent(b)); }
    });
    if(waypoints.length === 0) { showToast("לא נבחרו משפחות עם כתובת תקינה!", "error"); return; }
    
    waypoints = [...new Set(waypoints)]; 
    if(waypoints.length > 10) { showToast("מגבלת גוגל מפות היא 10 יעדים. ניקח את ה-10 הראשונים.", "warning"); waypoints = waypoints.slice(0,10); }
    
    let origin = '';
    if(appSettings.homeLocation && appSettings.homeLocation.address) {
        origin = encodeURIComponent(appSettings.homeLocation.address);
    } else {
        origin = waypoints.shift();
    }
    
    let destination = waypoints.length > 0 ? waypoints.pop() : origin; 
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    
    if(waypoints.length > 0) {
        url += `&waypoints=${waypoints.join('|')}`;
    }
    
    window.open(url, '_blank');
    clearBulkSelection();
};

window.tableSort = { column: '', direction: 'asc' };

window.sortByColumn = (col) => {
    if(window.tableSort.column === col) {
        window.tableSort.direction = window.tableSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        window.tableSort.column = col;
        window.tableSort.direction = 'asc';
    }
    handleOmniSearch();
};

window.toggleTableColumnsMenu = (e) => {
    e.stopPropagation();
    const menu = document.getElementById('colChooserMenu');
    if(menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
};

window.toggleColumnVisibility = (colId) => {
    if(appSettings.visibleColumns.includes(colId)) {
        appSettings.visibleColumns = appSettings.visibleColumns.filter(c => c !== colId);
    } else {
        appSettings.visibleColumns.push(colId);
    }
    saveDB();
    renderListView(window.currentFilteredData);
};

window.applySmartView = (viewId) => {
    window.activeSmartView = viewId;
    handleOmniSearch();
};

window.applySmartSort = (sortType) => {
    window.customSmartSort = sortType;
    handleOmniSearch();
};

// ========== מנוע יצירת תצוגות חכמות ==========
window.openSmartViewsManager = () => {
    renderExistingSmartViews();
    const nameEl = document.getElementById('svName');
    if(nameEl) nameEl.value = '';
    updateSvRuleInput();
    document.getElementById('smartViewsManagerModal').style.display = 'flex';
};

window.renderExistingSmartViews = () => {
    const list = document.getElementById('svExistingRulesList');
    if(!list) return;
    const views = (appSettings.smartViews || []).filter(v => !['v_all','v_novisit','v_bday'].includes(v.id));
    if(views.length === 0) {
        list.innerHTML = '<div style="color:var(--text-muted); font-size:14px;">אין כללים מותאמים אישית.</div>';
        return;
    }
    list.innerHTML = views.map(v => `
        <div style="background:var(--bg-body); padding:10px 15px; border-radius:10px; margin-bottom:10px; border:1px solid var(--border-light); display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:600; font-size:14px;"><i class="fas ${escapeHTML(v.icon)}" style="color:var(--accent); margin-left:8px;"></i>${escapeHTML(v.name)}</div>
            <button class="btn-icon" style="color:var(--danger); border:none; padding:4px; box-shadow:none;" onclick="deleteSmartView('${v.id}')"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
};

window.updateSvRuleInput = () => {
    const typeEl = document.getElementById('svRuleType');
    const container = document.getElementById('svRuleValueContainer');
    if(!typeEl || !container) return;
    const type = typeEl.value;

    if(type === 'no_interaction') {
        container.innerHTML = `
            <label style="font-size:12px; font-weight:bold;">סוג קשר:</label>
            <select id="svParam1" class="inline-input" style="margin-bottom:10px;"><option value="כלשהו">כל קשר שהוא</option><option value="ביקור">רק ביקורים</option><option value="שיחה">רק שיחות</option></select>
            <label style="font-size:12px; font-weight:bold;">חודשים שעברו לפחות:</label>
            <input type="number" id="svParam2" class="inline-input" value="3" min="1">
        `;
    } else if(type === 'child_age') {
        container.innerHTML = '<label style="font-size:12px; font-weight:bold;">גיל הילד השנה:</label><input type="number" id="svParam1" class="inline-input" placeholder="למשל 13" min="0">';
    } else if(type === 'has_open_tasks') {
        container.innerHTML = '<div style="font-size:13px; color:var(--text-muted);">הכלל יאתר כל משפחה שיש לה משימה פתוחה.</div><input type="hidden" id="svParam1" value="true">';
    } else if(type === 'in_project') {
        const projOptions = (db.__BOARDS__ || []).filter(b=>!b.archived).map(b => `<option value="${b.id}">${escapeHTML(b.name)}</option>`).join('');
        container.innerHTML = `<label style="font-size:12px; font-weight:bold;">בחר פרויקט פעיל:</label><select id="svParam1" class="inline-input">${projOptions}</select>`;
    }
};

window.saveSmartView = () => {
    const name = document.getElementById('svName').value.trim();
    const type = document.getElementById('svRuleType').value;
    const p1El = document.getElementById('svParam1');
    const p2El = document.getElementById('svParam2');
    const p1 = p1El ? p1El.value : '';
    const p2 = p2El ? p2El.value : '';

    if(!name) return showToast('יש לתת שם לכלל החדש', 'warning');

    const newId = 'v_custom_' + Date.now();
    appSettings.smartViews.push({ id: newId, name, icon: document.getElementById('svIcon').value, rule: type, param1: p1, param2: p2 });
    saveDB();
    renderExistingSmartViews();
    renderChipFilters();
    showToast('כלל נשמר בהצלחה!', 'success');
};

window.deleteSmartView = (viewId) => {
    appSettings.smartViews = appSettings.smartViews.filter(v => v.id !== viewId);
    if(window.activeSmartView === viewId) window.activeSmartView = 'v_all';
    saveDB();
    renderExistingSmartViews();
    renderChipFilters();
    handleOmniSearch();
};

window.renderListView = (filteredRes = null) => {
    const inner = document.getElementById('list-inner');

    // הגדרת כל העמודות האפשריות במערכת
    const allTableCols = [
        { id: 'address', label: 'כתובת', sortable: true },
        { id: 'name', label: 'משפחה', sortable: true },
        { id: 'father', label: 'שם האב', sortable: true },
        { id: 'mother', label: 'שם האם', sortable: true },
        { id: 'phone', label: 'טלפונים', sortable: false },
        { id: 'email', label: 'מיילים', sortable: false },
        { id: 'style', label: 'סגנון', sortable: true },
        { id: 'boards', label: 'פרויקטים', sortable: false },
        { id: 'tags', label: 'תגיות', sortable: false },
        { id: 'children', label: 'כמות ילדים', sortable: false },
        { id: 'notes', label: 'הערות פנימיות', sortable: false },
        { id: 'lastContact', label: 'קשר אחרון', sortable: true, defaultSort: 'date' },
        ...(appSettings.customFields || []).map(f => ({ id: `custom_${f}`, label: f, sortable: true })),
        { id: 'actions', label: 'פעולות מהירות', sortable: false }
    ];

    const sortIcon = (col) => {
        if(window.tableSort.column !== col) return '<i class="fas fa-sort" style="color:var(--border-light); margin-right:5px; font-size:12px;"></i>';
        return window.tableSort.direction === 'asc'
            ? '<i class="fas fa-sort-up" style="margin-right:5px; color:var(--accent);"></i>'
            : '<i class="fas fa-sort-down" style="margin-right:5px; color:var(--accent);"></i>';
    };

    // בניית כפתור הגדרות עמודות והדרופדאון
    const columnsMenuHtml = `
        <div style="position:relative; display:inline-block;">
            <button class="btn btn-outline" style="width:auto; padding:8px 15px; background:var(--surface);" onclick="toggleTableColumnsMenu(event)">
                <i class="fas fa-columns"></i> הגדרות טבלה
            </button>
            <div id="colChooserMenu" class="column-chooser-dropdown">
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px; font-weight:700;">בחר עמודות להצגה:</div>
                <div style="max-height:300px; overflow-y:auto; padding-left:5px;">
                    ${allTableCols.map(col => `
                        <label class="col-toggle">
                            <input type="checkbox" ${appSettings.visibleColumns.includes(col.id) ? 'checked' : ''} onchange="toggleColumnVisibility('${col.id}')" style="width:16px;height:16px;accent-color:var(--accent);">
                            ${escapeHTML(col.label)}
                        </label>
                    `).join('')}
                </div>
            </div>
        </div>`;

    // בניית כותרות הטבלה (thead) דינמית
    let theadHtml = `<th style="width:30px;"><input type="checkbox" id="bulkSelectAll" onchange="toggleAllBulk(this)"></th>`;
    allTableCols.forEach(col => {
        if(appSettings.visibleColumns.includes(col.id)) {
            let sortHtml = col.sortable ? sortIcon(col.defaultSort || col.id) : '';
            let clickHtml = col.sortable ? `onclick="sortByColumn('${col.defaultSort || col.id}')" style="cursor:pointer; user-select:none; white-space:nowrap;"` : `style="white-space:nowrap;"`;
            theadHtml += `<th ${clickHtml}>${escapeHTML(col.label)} ${sortHtml}</th>`;
        }
    });

    // יצירת דרופדאון Smart Sort
    const smartSortHtml = `
        <select class="smart-sort-select" onchange="applySmartSort(this.value)">
            <option value="">מיון רגיל (לפי עמודות)</option>
            <option value="last_call" ${window.customSmartSort === 'last_call' ? 'selected' : ''}>מיין לפי: שיחה אחרונה</option>
            <option value="last_visit" ${window.customSmartSort === 'last_visit' ? 'selected' : ''}>מיין לפי: ביקור בית אחרון</option>
        </select>
    `;

    let html = `
        <div style="display:flex; justify-content:space-between; margin-bottom:15px; align-items:center; flex-wrap:wrap; gap:10px; width:100%;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h2 style="margin:0;"><i class="fas fa-list"></i> אינדקס קהילה</h2>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            ${smartSortHtml}
            ${columnsMenuHtml}
            <button class="btn btn-success" style="width:auto; padding:8px 15px;" onclick="exportTableToCSV()"><i class="fas fa-file-excel"></i> ייצוא לאקסל</button>
        </div>
    </div>
    <div style="width:100%; overflow-x:auto; padding-bottom:80px; padding-left: 2px; padding-right: 2px;">
    <table class="data-table"><thead><tr>${theadHtml}</tr></thead><tbody>`;

    let arr = filteredRes || [];
    if(!filteredRes) Object.keys(db).forEach(b=>{if(b!=='__BOARDS__' && b!=='__SETTINGS__' && b!=='meta' && db[b] && db[b].apts)db[b].apts.forEach((a,i)=>arr.push({bldg:b,idx:i,apt:a}))});

    // מיון משולב: מיון חכם בעדיפות, אחרת מיון לפי עמודה
    arr.sort((itemA, itemB) => {
        const a = itemA.apt, b = itemB.apt;

        if(window.customSmartSort) {
            const getLatestDate = (apt, type) => {
                const logs = (apt.interactions || []).filter(i => i.type === type);
                return logs.length > 0 ? new Date(Math.max(...logs.map(l => new Date(l.date)))) : new Date(0);
            };
            const typeMap = { 'last_call': 'שיחה', 'last_visit': 'ביקור' };
            const dateA = getLatestDate(a, typeMap[window.customSmartSort]);
            const dateB = getLatestDate(b, typeMap[window.customSmartSort]);
            return dateB - dateA;
        }

        if(window.tableSort && window.tableSort.column) {
            let valA = '', valB = '';
            const col = window.tableSort.column;

            if(col === 'name') { valA = a.name || ''; valB = b.name || ''; }
            else if(col === 'address') { valA = itemA.bldg === NO_ADDRESS_KEY ? '' : itemA.bldg; valB = itemB.bldg === NO_ADDRESS_KEY ? '' : itemB.bldg; }
            else if(col === 'date') {
                valA = (a.interactions && a.interactions.length > 0) ? [...a.interactions].sort((x,y)=>new Date(y.date)-new Date(x.date))[0].date : '';
                valB = (b.interactions && b.interactions.length > 0) ? [...b.interactions].sort((x,y)=>new Date(y.date)-new Date(x.date))[0].date : '';
            }
            else if(col === 'father') { valA = a.father || ''; valB = b.father || ''; }
            else if(col === 'mother') { valA = a.mother || ''; valB = b.mother || ''; }
            else if(col === 'style') { valA = a.style || ''; valB = b.style || ''; }
            else if(col.startsWith('custom_')) {
                let f = col.replace('custom_', '');
                valA = (a.customData && a.customData[f]) || '';
                valB = (b.customData && b.customData[f]) || '';
            }

            if(valA < valB) return window.tableSort.direction === 'asc' ? -1 : 1;
            if(valA > valB) return window.tableSort.direction === 'asc' ? 1 : -1;
        }
        return 0;
    });

    arr.forEach(r => {
        const enc=encodeURIComponent(r.bldg), bName=r.bldg===NO_ADDRESS_KEY?'ללא כתובת':r.bldg, a=r.apt;
        let lastDate='-'; if(a.interactions&&a.interactions.length>0) lastDate=[...a.interactions].sort((x,y)=>new Date(y.date)-new Date(x.date))[0].date;

        let boardsHtml = '-';
        if(a.boards && Object.keys(a.boards).length > 0) {
            boardsHtml = Object.entries(a.boards).map(([bid, status]) => {
                const bObj = db.__BOARDS__.find(x => x.id === bid);
                return bObj ? `<span class="board-badge">${escapeHTML(bObj.name)}: ${escapeHTML(status)}</span>` : '';
            }).join(' ');
        }

        let contactIcons = '';
        const phones = getAllPhones(a);
        const emails = getAllEmails(a);
        if(phones.length > 0) {
            let cleanPhone = phones[0].replace(/\D/g, '');
            let waPhone = cleanPhone.startsWith('0') ? '972' + cleanPhone.substring(1) : cleanPhone;
            contactIcons += `<a href="tel:${cleanPhone}" class="btn-icon" style="color:var(--success); border-color:var(--success); margin-left:5px; text-decoration:none;" onclick="event.stopPropagation()" title="חייג"><i class="fas fa-phone"></i></a>`;
            contactIcons += `<a href="https://wa.me/${waPhone}" target="_blank" class="btn-icon" style="color:#25D366; border-color:#25D366; margin-left:5px; text-decoration:none;" onclick="event.stopPropagation()" title="וואטסאפ"><i class="fab fa-whatsapp"></i></a>`;
        }
        if(emails.length > 0) {
            contactIcons += `<a href="mailto:${emails[0]}" class="btn-icon" style="color:#ea4335; border-color:#ea4335; text-decoration:none;" onclick="event.stopPropagation()" title="שלח מייל"><i class="fas fa-envelope"></i></a>`;
        }

        const safeName = escapeHTML(a.name || '(ללא שם)');
        const safeTags = (a.tags||[]).map(t => `<span class="tag-badge">${escapeHTML(t)}</span>`).join('');
        // badge צבעוני לסגנון — נשמר מהגרסה הקודמת
        const safeStyle = a.style
            ? `<span class="tag-badge" style="background:${getColorForString(a.style,'style')}20; color:${getColorForString(a.style,'style')}; border-color:${getColorForString(a.style,'style')}50;">${escapeHTML(a.style)}</span>`
            : '<span style="color:var(--text-muted);font-size:12px;">-</span>';

        // יצירת תאי השורה באופן דינמי
        let cellsHtml = `<td data-label="בחר" onclick="event.stopPropagation()"><input type="checkbox" class="bulk-cb" value="${r.bldg}|${r.idx}" onchange="updateBulkBar()"></td>`;

        allTableCols.forEach(col => {
            if(!appSettings.visibleColumns.includes(col.id)) return;

            let content = '-';
            if(col.id === 'address') content = `<span onclick="flyToBuildingFromTable('${enc}'); event.stopPropagation();" style="color:var(--accent);font-weight:600;cursor:pointer;"><i class="fas fa-map-marker-alt"></i> ${escapeHTML(bName)}</span>`;
            else if(col.id === 'name') content = `<b>${safeName}</b>`;
            else if(col.id === 'father') content = escapeHTML(a.father || '-');
            else if(col.id === 'mother') content = escapeHTML(a.mother || '-');
            else if(col.id === 'phone') content = escapeHTML(phones.join(', ') || '-');
            else if(col.id === 'email') content = escapeHTML(emails.join(', ') || '-');
            else if(col.id === 'style') content = safeStyle;
            else if(col.id === 'boards') content = boardsHtml;
            else if(col.id === 'tags') content = safeTags || '<span style="color:var(--text-muted);font-size:12px;">-</span>';
            else if(col.id === 'children') content = a.childrenList && a.childrenList.length > 0 ? String(a.childrenList.length) : '-';
            else if(col.id === 'notes') {
                const notesVal = a.notes || '';
                content = notesVal ? `<span style="font-size:13px; color:var(--text-main);">${escapeHTML(notesVal)}</span>` : '<i class="fas fa-minus" style="opacity:0.3;"></i>';
            }
            else if(col.id === 'lastContact') content = `<span class="status-dot" style="background:${getStatusColor(a)};"></span> ${lastDate}`;
            else if(col.id.startsWith('custom_')) {
                const fName = col.id.replace('custom_', '');
                const customObj = a.customData || a.customFields || {};
                const val = customObj[fName] || '';
                content = val ? `<span style="font-size:13px; color:var(--text-main);">${escapeHTML(val)}</span>` : '<i class="fas fa-minus" style="opacity:0.3;"></i>';
            }
            else if(col.id === 'actions') content = contactIcons || '-';

            cellsHtml += `<td data-label="${escapeHTML(col.label)}">${content}</td>`;
        });

        html += `<tr oncontextmenu="showContextMenu(event,'${enc}',${r.idx})" onclick="currentBldg='${r.bldg}'; openClientCard(${r.idx})">${cellsHtml}</tr>`;
    });
    inner.innerHTML = html + `</tbody></table></div>`;
};

window.exportTableToCSV = () => {
    // ייצוא רק של הרשומות המסוננות אם יש חיפוש או סינון פעיל
    let arr = window.currentFilteredData;
    const isFiltered = document.getElementById('smartSearch').value !== '' || currentFilters.style || currentFilters.tags || currentFilters.status || window.missingDataField;
    
    if (!arr || !isFiltered) {
        arr = [];
        Object.keys(db).forEach(b => {
            if(b === '__BOARDS__' || b === '__SETTINGS__' || b === 'meta') return; if(!db[b] || !db[b].apts) return;
            db[b].apts.forEach(a => arr.push({ bldg: b, apt: a }));
        });
    }

    if(arr.length === 0) { showToast('אין נתונים לייצוא', 'warning'); return; }

    const customFields = appSettings.customFields || [];
    const headers = ['כתובת', 'שם משפחה', 'אבא', 'אמא', 'טלפון ראשי', 'מייל', 'סגנון', 'תגיות', 'קשר אחרון', 'הערות', ...customFields];

    const escape = v => `"${String(v||'').replace(/"/g,'""')}"`;

    const rows = arr.map((row) => {
        const bldg = row.bldg;
        const a = row.apt;
        const phones = getAllPhones(a);
        const emails = getAllEmails(a);
        const lastDate = (a.interactions && a.interactions.length > 0)
            ? a.interactions.sort((x,y) => new Date(y.date)-new Date(x.date))[0].date
            : '';
        const customVals = customFields.map(f => escape(a.customData && a.customData[f] ? a.customData[f] : ''));
        return [
            escape(bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : bldg),
            escape(a.name),
            escape(a.father),
            escape(a.mother),
            escape(phones[0] || ''),
            escape(emails[0] || ''),
            escape(a.style),
            escape((a.tags||[]).join(', ')),
            escape(lastDate),
            escape(a.notes),
            ...customVals
        ].join(',');
    });

    const bom = '\uFEFF';
    const csv = bom + headers.map(escape).join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const aDoc = document.createElement('a');
    aDoc.href = url;
    aDoc.download = `קהילה_${new Date().toLocaleDateString('he-IL').replace(/\//g,'-')}.csv`;
    aDoc.click();
    URL.revokeObjectURL(url);
    showToast(`יוצאו ${arr.length} משפחות לאקסל`, 'success');
};

window.editGoal = async () => {
    let targetText = await showCustomDialog({ title: 'הגדרת יעד', message: 'מה המטרה שלך? (למשל שם רחוב, או תגית)', showInput: true, defaultValue: appSettings.goal.text });
    if(!targetText) return;
    let targetNum = await showCustomDialog({ title: 'הגדרת יעד', message: 'לכמה משפחות תרצה להגיע ביעד הזה?', showInput: true, defaultValue: appSettings.goal.target.toString() });
    if(targetNum && !isNaN(targetNum) && Number(targetNum) > 0) {
        appSettings.goal = { text: targetText, target: Number(targetNum) };
        localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
        saveDB();
        updateGoalTracker();
        showToast("היעד עודכן! יוצאים לדרך 🚀", "success");
    } else if(targetNum !== null) {
        showToast('יש להזין מספר חיובי תקין', 'warning');
    }
};

window.updateGoalTracker = () => {
    let count = 0;
    let q = appSettings.goal.text.toLowerCase();
    Object.keys(db).forEach(b => {
        if(b === '__BOARDS__' || b === '__SETTINGS__' || b === 'meta') return; if(!db[b] || !db[b].apts) return;
        db[b].apts.forEach(a => {
            let txt=`${b} ${a.name} ${(a.tags||[]).join(' ')}`.toLowerCase();
            if(txt.includes(q)) count++;
        });
    });
    
    let pct = Math.min(100, Math.round((count / appSettings.goal.target) * 100));
    document.getElementById('goalText').innerText = `יעד: ${appSettings.goal.target} משפחות (${appSettings.goal.text})`;
    document.getElementById('goalStats').innerText = `${count} מתוך ${appSettings.goal.target} (${pct}%)`;
    
    let bar = document.getElementById('goalProgressBar');
    bar.style.width = pct + '%';
    if(pct < 30) { bar.style.background = 'var(--danger)'; bar.style.boxShadow = 'none'; }
    else if(pct < 100) { bar.style.background = 'var(--warning)'; bar.style.boxShadow = 'none'; }
    else { bar.style.background = '#ffd700'; bar.style.boxShadow = '0 0 10px rgba(255,215,0,0.8)'; }
};

function refreshMap(filteredRes = null) {
    activeMarkers.forEach(m=>m.remove()); activeMarkers=[]; if(chabadHouseMarker) chabadHouseMarker.remove();
    let stats={}, total=0, urgent=0, alerts=[]; const today=new Date(), cMonth=today.getMonth();
    
    if (appSettings.homeLocation && appSettings.homeLocation.coords && appSettings.homeLocation.isChabad) {
        const el=document.createElement('div'); el.className='chabad-pin-wrapper';
        el.innerHTML=`<div class="chabad-pin-container"><div class="chabad-pin-circle"><div class="chabad-pin-image"></div></div><div class="chabad-pin-arrow"></div></div>`;
        chabadHouseMarker = new mapboxgl.Marker({element:el, anchor:'bottom'}).setLngLat(appSettings.homeLocation.coords).addTo(map);
        el.addEventListener('click', () => { 
            const ch=Object.keys(db).find(k=>db[k].info && db[k].info.coords && Math.abs(db[k].info.coords[0]-appSettings.homeLocation.coords[0])<0.001); 
            if(ch){currentBldg=ch;openBuildingModal();} 
        });
    }

    Object.keys(db).forEach(k => {
        if(k === '__BOARDS__' || k === '__SETTINGS__' || k === 'meta') return; if(!db[k] || !db[k].apts) return;
        let maxVal=0, showBldg=false;
        
        db[k].apts.forEach((a,i) => {
            total++; if(stats[a.style]!==undefined) stats[a.style]++; else {stats[a.style]=1; if(a.style && !appSettings.styles.includes(a.style)) appSettings.styles.push(a.style);}
            const c = getStatusColor(a); if (c === '#ef4444' || c === '#94a3b8') urgent++; const v = c === '#94a3b8' ? 0 : (c === '#10b981' ? 1 : (c === '#f59e0b' ? 2 : 3)); if (v > maxVal) maxVal = v;
            if(!filteredRes || filteredRes.find(r=>r.bldg===k && r.idx===i)) showBldg=true;

            (a.childrenList||[]).forEach(ch => { if(ch.dob && new Date(ch.dob).getMonth()===cMonth) alerts.push(`<div style="padding:4px 0; border-bottom:1px solid rgba(0,0,0,0.05);"><i class="fas fa-birthday-cake" style="color:var(--warning);"></i> ${ch.name} (משפ' ${a.name||''}) חוגג/ת</div>`); });
            
            (a.tasks||[]).forEach((t, tIdx) => { 
                if(!t.done) alerts.push(`<div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid rgba(0,0,0,0.05);"><span><i class="fas fa-tasks" style="color:var(--accent);"></i> משפ' ${a.name||''}: ${t.text}</span> <button title="סמן כבוצע" onclick="markTaskDoneFromDash('${encodeURIComponent(k)}', ${i}, ${tIdx})" style="background:var(--success); color:white; border:none; border-radius:4px; cursor:pointer; padding:2px 6px; transition:0.2s;"><i class="fas fa-check"></i></button></div>`); 
            });
        });

        if(showBldg && db[k].apts.length>0 && k!==NO_ADDRESS_KEY) {
            let coords=db[k].info.coords||k.split(',').map(Number);
            if(!isNaN(coords[0])) {
                
                const markerColors = ['#94a3b8','#10b981','#f59e0b','#ef4444'];
                let bgColor = markerColors[maxVal];
                if (markerColorMode === 'style') {
                    bgColor = getColorForString(db[k].apts[0].style, 'style');
                } else if (markerColorMode === 'tag') {
                    let firstTag = (db[k].apts[0].tags && db[k].apts[0].tags.length > 0) ? db[k].apts[0].tags[0] : null;
                    bgColor = getColorForString(firstTag, 'tag');
                }
                
                const el = document.createElement('div');
                el.style.backgroundColor = bgColor;
                el.style.width = '28px';
                el.style.height = '28px';
                el.style.borderRadius = '50%';
                el.style.display = 'flex';
                el.style.alignItems = 'center';
                el.style.justifyContent = 'center';
                el.style.color = 'white';
                el.style.fontWeight = 'bold';
                el.style.fontSize = '14px';
                el.style.border = '2px solid white';
                el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
                el.style.cursor = 'pointer';
                el.innerText = db[k].apts.length; 

                const isChabadBldg = appSettings.homeLocation && appSettings.homeLocation.isChabad && appSettings.homeLocation.coords &&
                    Math.abs(coords[0]-appSettings.homeLocation.coords[0])<0.0002 && Math.abs(coords[1]-appSettings.homeLocation.coords[1])<0.0002;
                const markerOffset = isChabadBldg ? [22, -10] : [0, 0];
                const marker = new mapboxgl.Marker({element: el, offset: markerOffset}).setLngLat(coords).addTo(map);
                
                el.addEventListener('click', (e) => {
                    e.stopPropagation(); 
                    currentBldg = k;
                    openBuildingModal();
                });

                activeMarkers.push(marker);
            }
        }
    });
    
    document.getElementById('kpiTotal').innerText=total; document.getElementById('kpiUrgent').innerText=urgent;
    const alDiv = document.getElementById('kpiAlerts'); alDiv.innerHTML='';
    if(alerts.length>0) alDiv.innerHTML = `<div style="background:var(--surface); border:1px solid var(--border-light); padding:10px; border-radius:8px; margin-bottom:10px; font-size:13px; font-weight:600;"><div style="color:var(--text-main); margin-bottom:5px;">התראות השבוע:</div><ul style="margin:0; padding:0; list-style:none; font-weight:normal;">${alerts.slice(0,6).join('')}${alerts.length>6?'<li style="padding-top:5px; color:var(--text-muted);">ועוד...</li>':''}</ul></div>`;
    if(chart) chart.destroy(); const chartColors = Object.keys(stats).map(s => getColorForString(s, 'style')); chart = new Chart(document.getElementById('styleChart'), { type:'doughnut', data:{labels:Object.keys(stats), datasets:[{data:Object.values(stats), borderWidth:0, backgroundColor:chartColors}]}, options:{plugins:{legend:{position:'left', labels:{color:document.body.classList.contains('dark-mode')?'#fff':'#000'}}}, cutout:'65%'} });
    
    updateGoalTracker();
    updateHomeButton();
}

window.markTaskDoneFromDash = (bldgEnc, aptIdx, taskIdx) => { 
    const bldg = decodeURIComponent(bldgEnc); 
    db[bldg].apts[aptIdx].tasks[taskIdx].done = true; 
    saveDB(); 
    showToast("המשימה הושלמה! " + getRandomCompliment(), "success"); 
};

window.toggleDarkMode=() => {document.body.classList.toggle('dark-mode');localStorage.setItem('darkMode',document.body.classList.contains('dark-mode'));document.getElementById('darkModeIcon').className=document.body.classList.contains('dark-mode')?'fas fa-sun':'fas fa-moon';if(chart)refreshMap();};
function toggleMobileMenu(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('sidebarOverlay').classList.toggle('open');}

window.openSettings=()=>{
    document.getElementById('setThemeColor').value=appSettings.themeColor; document.getElementById('setDefaultView').value=appSettings.defaultView;
    const chabadAddr = (appSettings.primaryLocation && appSettings.primaryLocation.address) 
        ? appSettings.primaryLocation.address 
        : (appSettings.homeLocation && appSettings.homeLocation.isChabad && appSettings.homeLocation.address) 
            ? appSettings.homeLocation.address 
            : 'לא הוגדר';
    document.getElementById('currentPrimaryAddress').innerText = chabadAddr;
    if(appSettings.homeLocation && !appSettings.homeLocation.isChabad) {
        document.getElementById('locTypeOther').checked = true;
    } else {
        document.getElementById('locTypePrimary').checked = true;
    }
    toggleHomeLocUI();
    const presetColors = ['#ef4444','#f97316','#f59e0b','#84cc16','#10b981','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#64748b'];
    const colorSwatches = (name, type) => {
        const cur = type==='style' ? (appSettings.styleColors[name]||'') : (appSettings.tagColors[name]||'');
        return presetColors.map(c=>`<span onclick="setItemColor('${type}','${name}','${c}')" title="${c}" style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${cur===c?'#000':'transparent'};margin:1px;"></span>`).join('');
    };
    document.getElementById('settingsTagsList').innerHTML = appSettings.tags.map((t,i) =>
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span class="tag-bubble" style="background:${getColorForString(t,'tag')};color:white;border-color:${getColorForString(t,'tag')};">${t}</span>
            <div style="display:flex;align-items:center;gap:2px;">${colorSwatches(t,'tag')}</div>
            <i class="fas fa-times" style="color:var(--danger);cursor:pointer;margin-right:4px;" onclick="appSettings.tags.splice(${i},1);delete appSettings.tagColors['${t}'];openSettings()"></i>
        </div>`).join('');
    document.getElementById('settingsCustomFieldsList').innerHTML=appSettings.customFields.map((f,i)=>`<span class="tag-bubble">${f} <i class="fas fa-times" style="color:var(--danger);" onclick="appSettings.customFields.splice(${i},1);openSettings()"></i></span>`).join('');
    document.getElementById('settingsStylesList').innerHTML = appSettings.styles.map((s,i) => {
        const col = getColorForString(s, 'style');
        const swatches = presetColors.map(c=>`<span onclick="setItemColor('style','${s}','${c}')" title="${c}" style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${col===c?'#1e293b':'transparent'};margin:1px;flex-shrink:0;"></span>`).join('');
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${col};flex-shrink:0;border:1px solid rgba(0,0,0,0.15);"></span>
            <span style="font-weight:600;font-size:13px;min-width:80px;">${s}</span>
            <div style="display:flex;align-items:center;gap:2px;flex-wrap:wrap;">${swatches}</div>
            <button class="btn-icon" style="padding:2px 6px;font-size:11px;" onclick="renameStyle(${i})" title="שנה שם"><i class="fas fa-pen"></i></button>
            <button class="btn-icon" style="padding:2px 6px;font-size:11px;color:var(--danger);" onclick="deleteStyle(${i})" title="מחק סגנון"><i class="fas fa-times"></i></button>
        </div>`;
    }).join('') + `<div style="display:flex;gap:8px;margin-top:8px;"><input type="text" id="newStyleInput" class="inline-input" placeholder="שם סגנון חדש..."><button class="btn btn-success" style="width:auto;" onclick="addNewStyle()">הוסף</button></div>`;
    document.getElementById('settingsModal').style.display='flex';
};
window.updateThemePreview=()=>{appSettings.themeColor=document.getElementById('setThemeColor').value; document.documentElement.style.setProperty('--accent',appSettings.themeColor); if(map.getLayer('3d-buildings'))map.setPaintProperty('3d-buildings','fill-extrusion-color',['case',['boolean',['feature-state','hover'],false],appSettings.themeColor,'#d1d5db']);};
window.addNewTag=async ()=>{const v=await showCustomDialog({title:'תגית חדשה', message:'שם התגית:', showInput:true}); if(v){ if(appSettings.tags.includes(v)){ showToast('תגית זו כבר קיימת', 'warning'); return; } appSettings.tags.push(v); saveDB(); localStorage.setItem('crm_prefs',JSON.stringify(appSettings)); openSettings(); }};
window.addNewCustomField=async ()=>{const v=await showCustomDialog({title:'שדה מותאם', message:'שם השדה:', showInput:true}); if(v){ if(appSettings.customFields.includes(v)){ showToast('שדה זה כבר קיים', 'warning'); return; } appSettings.customFields.push(v); saveDB(); localStorage.setItem('crm_prefs',JSON.stringify(appSettings)); openSettings(); }};

window.setItemColor = (type, name, color) => {
    if(type === 'style') appSettings.styleColors[name] = color;
    else appSettings.tagColors[name] = color;
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    openSettings();
    refreshMap();
};

window.renameStyle = async (idx) => {
    const oldName = appSettings.styles[idx];
    const newName = await showCustomDialog({ title: 'שינוי שם סגנון', message: 'שם חדש:', showInput: true, defaultValue: oldName, showCancel: true });
    if(!newName || newName === oldName) return;
    appSettings.styles[idx] = newName;
    // העבר צבע לשם החדש
    if(appSettings.styleColors[oldName]) { appSettings.styleColors[newName] = appSettings.styleColors[oldName]; delete appSettings.styleColors[oldName]; }
    // עדכן את כל המשפחות
    Object.keys(db).forEach(k => { if(k==='__BOARDS__' || k==='__SETTINGS__' || k==='meta') return; if(!db[k] || !db[k].apts) return; db[k].apts.forEach(a => { if(a.style===oldName) a.style=newName; }); });
    saveDB(); localStorage.setItem('crm_prefs', JSON.stringify(appSettings)); populateFilterDropdowns(); openSettings(); refreshMap();
};

window.deleteStyle = async (idx) => {
    const name = appSettings.styles[idx];
    const ok = await showCustomDialog({ title: 'מחיקת סגנון', message: `למחוק את הסגנון "${name}"? משפחות עם סגנון זה יישארו ללא סגנון.`, showCancel: true });
    if(!ok) return;
    appSettings.styles.splice(idx, 1);
    delete appSettings.styleColors[name];
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings)); saveDB(); populateFilterDropdowns(); openSettings(); refreshMap();
};

window.addNewStyle = () => {
    const v = document.getElementById('newStyleInput').value.trim();
    if(!v) return;
    if(appSettings.styles.includes(v)) { showToast('סגנון זה כבר קיים', 'warning'); return; }
    appSettings.styles.push(v);
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings)); saveDB(); populateFilterDropdowns(); openSettings(); refreshMap();
};

window.saveSettingsAndClose = () => {
    appSettings.defaultView = document.getElementById('setDefaultView').value;

    const isPrimary = document.getElementById('locTypePrimary').checked;
    if(isPrimary) {
        if(appSettings.primaryLocation) {
            appSettings.homeLocation = { coords: appSettings.primaryLocation.coords, address: appSettings.primaryLocation.address, isChabad: true };
        } else if(appSettings.homeLocation) {
            appSettings.homeLocation.isChabad = true;
            appSettings.primaryLocation = { coords: appSettings.homeLocation.coords, address: appSettings.homeLocation.address };
        }
        tempOtherLoc = null;
        otherGeocoder.clear();
    } else {
        if(tempOtherLoc) {
            appSettings.homeLocation = { coords: tempOtherLoc.coords, address: tempOtherLoc.address, isChabad: false };
        } else if(appSettings.homeLocation) {
            appSettings.homeLocation.isChabad = false;
        }
    }

    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    populateFilterDropdowns();
    document.getElementById('settingsModal').style.display = 'none';
    updateHomeButton();
    refreshMap();
    showToast('הגדרות נשמרו', 'success');
};

window.setDefaultLocation = () => {
    appSettings.center = [map.getCenter().lng, map.getCenter().lat];
    appSettings.zoom = map.getZoom();
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    showToast('נשמר מיקום מפה', 'success');
};

// --- פונקציות תקשורת: וואטסאפ ומייל ---

window.sendCommWhatsApp = async () => {
    const text = document.getElementById('waMessageText').value;
    if(!text) return showToast('יש להזין תוכן להודעה', 'warning');
    if(commRecipients.length === 0) return showToast('יש להוסיף נמענים קודם!', 'error');
    
    const validRecipients = commRecipients.filter(r => r.phone);
    if(validRecipients.length === 0) return showToast('לא נמצאו טלפונים — הוסף מספר טלפון לאיש הקשר', 'error');

    if(validRecipients.length > 1 || text.includes('[שם]')) {
        startCommQueue('whatsapp', '', text, validRecipients);
        commRecipients = [];
        renderRecipientsList('whatsapp');
        document.getElementById('waRecipientCount').innerText = 0;
    } else {
        const r = validRecipients[0];
        let cp = String(r.phone).replace(/\D/g,'');
        if(cp.startsWith('0')) cp = cp.substring(1);
        
        const link = `https://wa.me/972${cp}?text=${encodeURIComponent(text)}`;
        const newWin = window.open(link, '_blank');

        if (!newWin || newWin.closed || typeof newWin.closed == 'undefined') {
            showCustomDialog({
                title: 'שגיאת דפדפן',
                message: 'הדפדפן חוסם חלונות קופצים.\nאנא אשר פתיחת פופ-אפים מהאתר בשורת הכתובת למעלה.',
                showCancel: false
            });
        } else {
            showToast('פותח וואטסאפ...', 'success');
            commRecipients = [];
            renderRecipientsList('whatsapp');
            document.getElementById('waRecipientCount').innerText = 0;
        }
    }
};

window.sendCommEmail = async () => {
    const subjInput = document.getElementById('emSubject').value || 'הודעה מהקהילה';
    const textInput = document.getElementById('emMessageText').value;
    
    if(!textInput) return showToast('יש להזין תוכן למייל', 'warning');
    if(commRecipients.length === 0) return showToast('יש להוסיף נמענים קודם!', 'error');

    const validRecipients = commRecipients.filter(r => r.email);
    if(validRecipients.length === 0) return showToast('לא נמצאו מיילים — הוסף כתובת מייל לאיש הקשר', 'error');

    if(textInput.includes('[שם]') || subjInput.includes('[שם]')) {
        const proceed = await showChoiceDialog(
             'שליחה אישית',
             'האם להפעיל רצף שליחה אישי כדי להשתיל את שם המשפחה?',
             'כן, התחל רצף', 'לא, שלח המוני (BCC)'
        );
        if(!proceed) return;
        if(proceed === '1') {
            startCommQueue('email', subjInput, textInput, validRecipients);
            commRecipients = [];
            renderRecipientsList('email');
            document.getElementById('emRecipientCount').innerText = 0;
            return;
        }
    }

    const choice = await showChoiceDialog('בחירת פלטפורמה', 'איך תרצה לשלוח?', 'ג\'ימייל בדפדפן', 'תוכנה במחשב');
    if(!choice) return;

    const emails = validRecipients.map(r => r.email);
    const finalSubj = subjInput.replace(/\[\s*שם\s*\]/g, '');
    const finalText = textInput.replace(/\[\s*שם\s*\]/g, 'משפחה יקרה');

    if (choice === '1') {
        const link = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&bcc=${emails.join(',')}&su=${encodeURIComponent(finalSubj)}&body=${encodeURIComponent(finalText)}`;
        const newWin = window.open(link, '_blank');
        if (!newWin) {
            showCustomDialog({ title: 'שגיאת דפדפן', message: 'אנא אשר חלונות קופצים בדפדפן.', showCancel: false });
            return;
        }
    } else {
        window.location.href = `mailto:?bcc=${emails.join(',')}&subject=${encodeURIComponent(finalSubj)}&body=${encodeURIComponent(finalText)}`;
    }

    showToast('נפתחה תוכנת המייל', 'success');
    commRecipients = [];
    renderRecipientsList('email');
    document.getElementById('emRecipientCount').innerText = 0;
};

// --- מערכת ניהול תור (Queue) ודיאלוגים בחירה ---

function showChoiceDialog(title, message, btn1Text, btn2Text) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '100001';
        overlay.innerHTML = `
            <div class="modal-content modal-small" style="text-align:center;">
                <h3 style="color:var(--accent);">${title}</h3>
                <p>${message}</p>
                <div style="display:flex; gap:10px; justify-content:center;">
                    <button id="btn1" class="btn btn-primary" style="width:auto; padding:8px 15px;">${btn1Text}</button>
                    <button id="btn2" class="btn btn-success" style="width:auto; padding:8px 15px;">${btn2Text}</button>
                    <button id="btnC" class="btn btn-outline" style="width:auto; padding:8px 15px;">ביטול</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#btn1').onclick = () => { overlay.remove(); resolve('1'); };
        overlay.querySelector('#btn2').onclick = () => { overlay.remove(); resolve('2'); };
        overlay.querySelector('#btnC').onclick = () => { overlay.remove(); resolve(null); };
    });
}

function startCommQueue(type, subject, text, recipients) {
    window.commQueue = recipients;
    window.currentQueueIdx = 0;
    window.currentQueueType = type;
    window.currentQueueSubject = subject;
    window.currentQueueText = text;
    
    let qBox = document.getElementById('queueManagerBox');
    if(!qBox) {
        qBox = document.createElement('div');
        qBox.id = 'queueManagerBox';
        qBox.style.cssText = 'position:fixed; bottom:20px; right:20px; background:var(--surface); border:2px solid var(--accent); padding:15px; border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.3); z-index:100000; width:300px;';
        document.body.appendChild(qBox);
    }
    qBox.style.display = 'block';
    processNextInQueue();
}

function processNextInQueue() {
    const qBox = document.getElementById('queueManagerBox');
    if(window.currentQueueIdx >= window.commQueue.length) {
        qBox.innerHTML = '<h4 style="color:var(--success); margin:0 0 10px 0;">השליחה הושלמה!</h4><button class="btn btn-outline" onclick="this.parentElement.style.display=\'none\'">סגור</button>';
        return;
    }
    const r = window.commQueue[window.currentQueueIdx];
    const pText = window.currentQueueText.replace(/\[\s*שם\s*\]/g, r.name || '');
    qBox.innerHTML = `
        <h4 style="margin:0 0 10px 0; color:var(--accent);">תור שליחה אישית</h4>
        <p style="font-size:14px;">נמען ${window.currentQueueIdx + 1} מתוך ${window.commQueue.length}:<br><b>${r.name}</b></p>
        <div style="display:flex; gap:8px;">
            <button class="btn btn-success" style="padding:8px;" onclick="executeQueueAction('${r.name}', '${r.phone}', '${r.email}', \`${pText}\`)">פתח הודעה</button>
            <button class="btn btn-outline" style="padding:8px;" onclick="window.currentQueueIdx++; processNextInQueue()">דלג</button>
        </div>`;
}

function executeQueueAction(name, phone, email, text) {
    if(window.currentQueueType === 'whatsapp') {
        let cp = String(phone).replace(/\D/g,'');
        if(cp.startsWith('0')) cp = cp.substring(1);
        window.open(`https://wa.me/972${cp}?text=${encodeURIComponent(text)}`, '_blank');
    } else {
        const s = window.currentQueueSubject.replace(/\[\s*שם\s*\]/g, name);
        window.location.href = `mailto:${email}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(text)}`;
    }
    window.currentQueueIdx++;
    setTimeout(processNextInQueue, 600);
}

// ========== פונקציות חסרות ==========

function showToast(msg, type='info') {
    const c = document.getElementById('toast-container');
    if(!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icons = { success:'fa-check-circle', error:'fa-times-circle', warning:'fa-exclamation-triangle', info:'fa-info-circle' };
    t.innerHTML = `<i class="fas ${icons[type]||icons.info}"></i> ${msg}`;
    c.appendChild(t);
    setTimeout(() => { t.style.animation='fadeOut 0.3s ease-in forwards'; setTimeout(()=>t.remove(), 300); }, 3500);
}

// --- תבניות ---
let commRecipients = [];

window.renderTemplates = () => {
    const c = document.getElementById('templatesListContainer');
    if(!c) return;
    const templates = appSettings.templates || [];
    if(templates.length === 0) {
        c.innerHTML = '<div class="empty-state"><i class="fas fa-file-alt"></i><div>אין תבניות עדיין. צור תבנית חדשה!</div></div>';
        return;
    }
    c.innerHTML = templates.map((t, i) => `
        <div style="background:var(--bg-body); border:1px solid var(--border-light); border-radius:8px; padding:12px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <strong style="color:var(--accent);">${t.title}</strong>
                <div style="display:flex; gap:6px;">
                    <button class="btn-icon" onclick="editTemplate(${i})" title="ערוך"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon" style="color:var(--danger);" onclick="deleteTemplate(${i})" title="מחק"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div style="font-size:13px; color:var(--text-muted); white-space:pre-wrap;">${t.text}</div>
        </div>`).join('');
};

window.createNewTemplate = async () => {
    const title = await showCustomDialog({ title: 'תבנית חדשה', message: 'שם קצר לתבנית:', showInput: true, showCancel: true });
    if(!title) return;
    const text = await showCustomDialog({ title: 'תוכן התבנית', message: 'הקלד את תוכן ההודעה.\n(אפשר להשתמש ב-[שם] לשם המשפחה)', showInput: true, showCancel: true });
    if(!text) return;
    if(!appSettings.templates) appSettings.templates = [];
    appSettings.templates.push({ title, text });
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    renderTemplates();
    showToast('התבנית נשמרה', 'success');
};

window.editTemplate = async (idx) => {
    const t = appSettings.templates[idx];
    const title = await showCustomDialog({ title: 'עריכת שם תבנית', message: 'שם התבנית:', showInput: true, defaultValue: t.title, showCancel: true });
    if(!title) return;
    const text = await showCustomDialog({ title: 'עריכת תוכן תבנית', message: 'תוכן ההודעה:', showInput: true, defaultValue: t.text, showCancel: true });
    if(!text) return;
    appSettings.templates[idx] = { title, text };
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    renderTemplates();
    showToast('התבנית עודכנה', 'success');
};

window.deleteTemplate = async (idx) => {
    const proceed = await showCustomDialog({ title: 'מחיקת תבנית', message: 'האם למחוק תבנית זו?', showCancel: true });
    if(!proceed) return;
    appSettings.templates.splice(idx, 1);
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    renderTemplates();
    showToast('התבנית נמחקה', 'success');
};

// --- נמענים ---
window.renderCommSenders = (type) => {
    if(bulkSelection.length > 0) {
        commRecipients = [];
        bulkSelection.forEach(v => {
            let [b,i] = v.split('|'); let a = db[b].apts[i];
            commRecipients.push({ name: a.name||'ללא שם', phone: getAllPhones(a)[0]||'', email: getAllEmails(a)[0]||'', key: v });
        });
        bulkSelection = [];
    }
    const sel = document.getElementById(type === 'whatsapp' ? 'waTemplateSelect' : 'emTemplateSelect');
    if(sel) {
        sel.innerHTML = '<option value="">-- בחר תבנית או הקלד חופשי --</option>' +
            (appSettings.templates || []).map((t, i) => `<option value="${i}">${t.title}</option>`).join('');
    }
    renderRecipientsList(type);
};

window.renderRecipientsList = (type) => {
    const containerId = type === 'whatsapp' ? 'waRecipientsList' : 'emRecipientsList';
    const countId = type === 'whatsapp' ? 'waRecipientCount' : 'emRecipientCount';
    const container = document.getElementById(containerId);
    const countEl = document.getElementById(countId);
    if(countEl) countEl.innerText = commRecipients.length;
    if(!container) return;
    if(commRecipients.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">אין נמענים. הוסף ידנית או סמן משפחות ברשימה/מפה.</div>`;
        return;
    }
    const field = type === 'whatsapp' ? 'phone' : 'email';
    container.innerHTML = commRecipients.map((r,i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-body);border:1px solid var(--border-light);border-radius:6px;margin-bottom:4px;">
            <span style="flex:1;font-weight:600;font-size:13px;">${r.name}</span>
            <span style="font-size:12px;color:var(--text-muted);direction:ltr;">${r[field]||'<span style="color:var(--danger);">חסר</span>'}</span>
            <button class="btn-icon" style="color:var(--danger);padding:2px 6px;" onclick="removeRecipient(${i},'${type}')"><i class="fas fa-times"></i></button>
        </div>`).join('');
};

window.removeRecipient = (idx, type) => {
    commRecipients.splice(idx, 1);
    renderRecipientsList(type);
    const countEl = document.getElementById(type === 'whatsapp' ? 'waRecipientCount' : 'emRecipientCount');
    if(countEl) countEl.innerText = commRecipients.length;
};

window.addRecipientManually = async (type) => {
    const name = await showCustomDialog({ title: 'הוסף נמען', message: 'שם המשפחה:', showInput: true, showCancel: true });
    if(!name) return;
    const contact = await showCustomDialog({ title: 'הוסף נמען', message: type === 'whatsapp' ? 'מספר טלפון:' : 'כתובת מייל:', showInput: true, showCancel: true });
    if(!contact) return;
    commRecipients.push({ name, phone: type === 'whatsapp' ? contact : '', email: type === 'email' ? contact : '', key: '' });
    renderRecipientsList(type);
    const countEl = document.getElementById(type === 'whatsapp' ? 'waRecipientCount' : 'emRecipientCount');
    if(countEl) countEl.innerText = commRecipients.length;
};

window.addRecipientsFromDB = (type) => {
    const modal = document.getElementById('recipientPickerModal');
    const list = document.getElementById('recipientPickerList');
    if(!list) return;
    list.innerHTML = '';
    Object.keys(db).forEach(b => {
        if(b === '__BOARDS__' || b === '__SETTINGS__' || b === 'meta') return; if(!db[b] || !db[b].apts) return;
        db[b].apts.forEach((a, i) => {
            const contact = type === 'whatsapp' ? getAllPhones(a)[0] : getAllEmails(a)[0];
            if(!contact) return;
            const key = `${b}|${i}`;
            const already = commRecipients.find(r => r.key === key);
            list.innerHTML += `<div style="display:flex;align-items:center;gap:8px;padding:6px;border-bottom:1px solid var(--border-light);">
                <input type="checkbox" ${already?'checked':''} onchange="togglePickerRecipient(this,'${encodeURIComponent(b)}',${i},'${type}')" style="width:16px;height:16px;">
                <span style="flex:1;font-weight:600;">${a.name||'ללא שם'}</span>
                <span style="font-size:12px;color:var(--text-muted);direction:ltr;">${contact}</span>
            </div>`;
        });
    });
    if(modal) { modal.dataset.type = type; modal.style.display = 'flex'; }
};

window.togglePickerRecipient = (cb, encB, i, type) => {
    const b = decodeURIComponent(encB);
    const a = db[b].apts[i];
    const key = `${b}|${i}`;
    if(cb.checked) {
        if(!commRecipients.find(r => r.key === key)) {
            commRecipients.push({ name: a.name||'ללא שם', phone: getAllPhones(a)[0]||'', email: getAllEmails(a)[0]||'', key });
        }
    } else {
        commRecipients = commRecipients.filter(r => r.key !== key);
    }
    const countEl = document.getElementById(type === 'whatsapp' ? 'waRecipientCount' : 'emRecipientCount');
    if(countEl) countEl.innerText = commRecipients.length;
};

window.closeRecipientPicker = (type) => {
    const modal = document.getElementById('recipientPickerModal');
    if(modal) modal.style.display = 'none';
    renderRecipientsList(type);
};

window.previewWaTemplate = () => {
    const idx = document.getElementById('waTemplateSelect').value;
    if(idx !== '') document.getElementById('waMessageText').value = (appSettings.templates[idx]||{}).text || '';
};

window.previewEmTemplate = () => {
    const idx = document.getElementById('emTemplateSelect').value;
    if(idx !== '') document.getElementById('emMessageText').value = (appSettings.templates[idx]||{}).text || '';
};

// --- גיבוי וייבוא JSON ---
window.exportData = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `community_backup_${new Date().toLocaleDateString('he-IL').replace(/\//g,'-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('גיבוי הורד בהצלחה', 'success');
};

window.importData = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const parsed = JSON.parse(ev.target.result);

            // ולידציה: מבנה בסיסי
            if(typeof parsed !== 'object' || !parsed['__BOARDS__'] || !parsed.meta) {
                showToast('שגיאה: קובץ הגיבוי אינו תואם למבנה המערכת', 'error');
                return;
            }
            // ולידציה נוספת: חייב להיות לפחות מפתח בניין אמיתי אחד
            const hasRealData = Object.keys(parsed).some(k => k !== '__BOARDS__' && k !== '__SETTINGS__' && k !== 'meta');
            if(!hasRealData) {
                showToast('שגיאה: הקובץ לא מכיל נתוני קהילה', 'error');
                return;
            }

            const proceed = await showCustomDialog({ title: 'שחזור גיבוי', message: 'פעולה זו תדרוס את כל הנתונים הקיימים. להמשיך?', showCancel: true });
            if(!proceed) return;
            db = parsed;
            saveDB();
            handleOmniSearch();
            showToast('הנתונים שוחזרו בהצלחה', 'success');
        } catch(err) {
            showToast('קובץ לא תקין', 'error');
        }
    };
    reader.readAsText(file);
};

// --- ייבוא נתונים (CSV / Sheets) ---
let importRawData = [];
let importSource = '';

window.openImportModal = () => {
    importRawData = [];
    importSource = '';
    showImportStep('step1');
    const m = document.getElementById('importModal');
    if(m) m.style.display = 'flex';
    const su = document.getElementById('sheetsUrlInput');
    if(su) su.value = '';
};

window.closeImportModal = () => {
    const m = document.getElementById('importModal');
    if(m) m.style.display = 'none';
};

function showImportStep(step) {
    ['importStep1','importStepCSV','importStepSheets','importStepMapping','importStepPreview']
        .forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
    const map = { step1:'importStep1', csv:'importStepCSV', sheets:'importStepSheets', mapping:'importStepMapping', preview:'importStepPreview' };
    if(map[step]) { const el = document.getElementById(map[step]); if(el) el.style.display = 'block'; }
}

window.selectImportSource = (src) => { importSource = src; showImportStep(src); };
window.backToImportStep1 = () => showImportStep('step1');
window.backToImportSource = () => showImportStep(importSource);
window.backToImportMapping = () => showImportStep('mapping');

window.handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const text = ev.target.result;
        importRawData = parseCSV(text);
        if(importRawData.length < 2) { showToast('הקובץ ריק או לא תקין', 'error'); return; }
        buildMappingUI();
        showImportStep('mapping');
    };
    reader.readAsText(file, 'UTF-8');
};

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    return lines.map(line => {
        const cols = []; let cur = '', inQ = false;
        for(let i = 0; i < line.length; i++) {
            const c = line[i];
            if(c === '"') { inQ = !inQ; }
            else if(c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
            else { cur += c; }
        }
        cols.push(cur.trim());
        return cols;
    });
}

window.fetchGoogleSheet = async () => {
    const url = document.getElementById('sheetsUrlInput').value.trim();
    if(!url) { showToast('יש להדביק קישור לגיליון', 'warning'); return; }
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if(!match) { showToast('קישור לא תקין — ודא שזה קישור לגוגל שיטס', 'error'); return; }
    const sheetId = match[1];
    showToast('שואב נתונים מהגיליון...', 'info');
    try {
        const res = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:Z1000`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if(!res.ok) throw new Error('שגיאה');
        const data = await res.json();
        if(!data.values || data.values.length < 2) { showToast('הגיליון ריק או לא נגיש', 'error'); return; }
        importRawData = data.values;
        buildMappingUI();
        showImportStep('mapping');
        showToast(`נמצאו ${data.values.length - 1} שורות`, 'success');
    } catch(e) {
        showToast('שגיאה בגישה לגיליון. ודא שהגיליון משותף ושאתה מחובר לגוגל.', 'error');
    }
};

const SYSTEM_FIELDS = [
    { value: '', label: '-- דלג --' },
    { value: 'name', label: 'שם משפחה' },
    { value: 'phone', label: 'טלפון' },
    { value: 'email', label: 'מייל' },
    { value: 'address', label: 'כתובת' },
    { value: 'father', label: 'שם אב' },
    { value: 'mother', label: 'שם אם' },
    { value: 'style', label: 'סגנון' },
    { value: 'notes', label: 'הערות' },
    { value: 'tags', label: 'תגיות (מופרדות בפסיק)' },
];

function buildMappingUI() {
    const headers = importRawData[0];
    const countEl = document.getElementById('importRowCount');
    if(countEl) countEl.innerText = importRawData.length - 1;
    const autoMap = {
        'שם':'name','name':'name','משפחה':'name','family':'name',
        'טלפון':'phone','phone':'phone','mobile':'phone','נייד':'phone','Phone 1 - Value':'phone',
        'מייל':'email','email':'email','mail':'email','E-mail 1 - Value':'email',
        'כתובת':'address','address':'address','רחוב':'address',
        'אבא':'father','father':'father','אב':'father',
        'אמא':'mother','mother':'mother','אם':'mother',
        'סגנון':'style','style':'style','הערות':'notes','notes':'notes','תגיות':'tags','tags':'tags',
    };
    const customFieldOpts = (appSettings.customFields || []).map(f => `<option value="custom_${f}">${f} (שדה מותאם)</option>`).join('');
    const fieldOpts = SYSTEM_FIELDS.map(f => `<option value="${f.value}">${f.label}</option>`).join('') + customFieldOpts;
    const container = document.getElementById('importMappingFields');
    if(!container) return;
    container.innerHTML = headers.map((h, i) => {
        const sample = importRawData.slice(1, 4).map(r => r[i] || '').filter(Boolean).join(', ');
        const autoVal = autoMap[h] || autoMap[h.toLowerCase()] || '';
        const opts = fieldOpts.replace(`value="${autoVal}"`, `value="${autoVal}" selected`);
        return `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; align-items:center; margin-bottom:8px; padding:8px; background:var(--bg-body); border-radius:6px; border:1px solid var(--border-light);">
            <div><div style="font-weight:600; font-size:13px;">${h}</div><div style="font-size:11px; color:var(--text-muted);">דוגמה: ${sample||'(ריק)'}</div></div>
            <select class="filter-select" id="mapCol_${i}" style="font-size:12px;">${opts}</select>
        </div>`;
    }).join('');
}

window.runImportPreview = () => {
    const mapped = getMappedRows();
    if(mapped.length === 0) { showToast('אנא מפה לפחות שדה אחד', 'warning'); return; }
    const duplicates = [];
    mapped.forEach((row, i) => {
        if(!row.name && !row.phone) return;
        Object.keys(db).forEach(b => {
            if(b === '__BOARDS__' || b === '__SETTINGS__' || b === 'meta') return; if(!db[b] || !db[b].apts) return;
            db[b].apts.forEach(a => {
                const sameName = row.name && a.name && a.name.trim() === row.name.trim();
                const samePhone = row.phone && getAllPhones(a).some(p => p.replace(/\D/g,'') === row.phone.replace(/\D/g,''));
                if(sameName || samePhone) duplicates.push(i);
            });
        });
    });
    const dupWarn = document.getElementById('importDuplicateWarning');
    if(dupWarn) {
        if(duplicates.length > 0) {
            dupWarn.style.display = 'block';
            dupWarn.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:var(--warning);"></i> נמצאו <strong>${duplicates.length}</strong> רשומות שעשויות להיות כפולות.`;
        } else { dupWarn.style.display = 'none'; }
    }
    const previewEl = document.getElementById('importPreviewTable');
    if(previewEl) {
        previewEl.innerHTML = `<table class="data-table" style="font-size:12px;">
            <thead><tr><th>שם</th><th>טלפון</th><th>מייל</th><th>כתובת</th><th>סטטוס</th></tr></thead>
            <tbody>${mapped.slice(0,20).map((r,i)=>`<tr style="${duplicates.includes(i)?'background:rgba(245,158,11,0.1);':''}">
                <td>${r.name||'-'}</td><td>${r.phone||'-'}</td><td>${r.email||'-'}</td><td>${r.address||'ללא כתובת'}</td>
                <td>${duplicates.includes(i)?'<span style="color:var(--warning);">⚠️ כפול?</span>':'<span style="color:var(--success);">✓ חדש</span>'}</td>
            </tr>`).join('')}</tbody></table>
            ${mapped.length>20?`<div style="text-align:center;padding:8px;color:var(--text-muted);font-size:12px;">ועוד ${mapped.length-20} רשומות...</div>`:''}`;
    }
    showImportStep('preview');
};

function getMappedRows() {
    const headers = importRawData[0];
    const colMap = {};
    headers.forEach((h, i) => {
        const sel = document.getElementById(`mapCol_${i}`);
        if(sel && sel.value) colMap[i] = sel.value;
    });
    return importRawData.slice(1).map(row => {
        const obj = {};
        Object.entries(colMap).forEach(([i, field]) => { const val=(row[i]||'').trim(); if(val) obj[field]=val; });
        return obj;
    }).filter(r => Object.keys(r).length > 0);
}

window.executeImport = async () => {
    const mapped = getMappedRows();
    let imported = 0, skipped = 0, updated = 0;
    for(const row of mapped) {
        let existingBldg = null, existingIdx = null;
        Object.keys(db).forEach(b => {
            if(b==='__BOARDS__'||b==='__SETTINGS__') return;
            db[b].apts.forEach((a,i) => {
                const sameName = row.name && a.name && a.name.trim()===row.name.trim();
                const samePhone = row.phone && getAllPhones(a).some(p=>p.replace(/\D/g,'')===row.phone.replace(/\D/g,''));
                if((sameName||samePhone) && !existingBldg) { existingBldg=b; existingIdx=i; }
            });
        });
        if(existingBldg !== null) {
            const choice = await showChoiceDialog('רשומה קיימת', `"${row.name||row.phone}" כבר קיימת במערכת. מה לעשות?`, 'עדכן אותה', 'דלג עליה');
            if(choice === '1') {
                const a = db[existingBldg].apts[existingIdx];
                if(row.phone && !getAllPhones(a).includes(row.phone)) a.phone = row.phone;
                if(row.email && !getAllEmails(a).includes(row.email)) a.email = row.email;
                if(row.notes) a.notes = (a.notes?a.notes+'\n':'')+row.notes;
                if(row.style) a.style = row.style;
                if(row.tags) { if(!a.tags)a.tags=[]; row.tags.split(',').map(t=>t.trim()).forEach(t=>{if(t&&!a.tags.includes(t))a.tags.push(t);}); }
                updated++;
            } else { skipped++; }
            continue;
        }
        const bldgKey = row.address && row.address.trim() ? row.address.trim() : NO_ADDRESS_KEY;
        if(!db[bldgKey]) db[bldgKey] = { info:{code:'',rep:'',notes:'',coords:null}, apts:[] };
        const newApt = {
            name:row.name||'', father:row.father||'', mother:row.mother||'',
            phone:row.phone||'', email:row.email||'',
            style:row.style||appSettings.styles[0]||'',
            notes:row.notes||'',
            tags:row.tags?row.tags.split(',').map(t=>t.trim()).filter(Boolean):[],
            boards:{}, childrenList:[], interactions:[], donations:[], tasks:[], customData:{}
        };
        Object.entries(row).forEach(([k,v])=>{ if(k.startsWith('custom_')) newApt.customData[k.replace('custom_','')]=v; });
        db[bldgKey].apts.push(newApt);
        imported++;
    }
    saveDB();
    closeImportModal();
    document.getElementById('settingsModal').style.display = 'none';
    handleOmniSearch();
    showToast(`ייבוא הושלם! ${imported} חדשים, ${updated} עודכנו, ${skipped} דולגו`, 'success');
};

// ========== שיפורים נוספים ==========

// 10. escape HTML לאבטחה
function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

// 11. טקסט סנכרון חכם
function getLastSyncText() {
    const t = db.meta && db.meta.lastModified;
    if(!t) return 'לא סונכרן';
    const diff = Math.floor((Date.now() - t) / 1000);
    if(diff < 60) return `עודכן לפני ${diff} שניות`;
    if(diff < 3600) return `עודכן לפני ${Math.floor(diff/60)} דקות`;
    return `עודכן לפני ${Math.floor(diff/3600)} שעות`;
}
setInterval(() => {
    const el = document.getElementById('sync-text');
    if(el && el.innerText !== 'שומר...' && el.innerText !== 'שואב...') {
        el.innerText = getLastSyncText();
    }
}, 5000);

// סנכרון אוטומטי כל 30 שניות — רק אם המשתמש לא באמצע עריכה והטוקן בתוקף
setInterval(() => {
    const session = JSON.parse(localStorage.getItem('gdrive_session'));
    const isTokenValid = session && session.expiresAt > (new Date().getTime() + 60000);
    if(accessToken && !isDirty && isTokenValid) {
        syncWithDrive();
    }
}, 30000);

// ========== Smart Tasks & Mentions Engine ==========
if(!db.meta.generalTasks) db.meta.generalTasks = [];
window.currentTaskMentions = [];
let mentionSearchIndex = 0;
let gtInput = null; // יאותחל לאחר טעינת ה-DOM

function initTasksEngine() {
    gtInput = document.getElementById('globalTaskInput');
    if(!gtInput) return;

    gtInput.addEventListener('input', (e) => {
        const val = e.target.value;
        const words = val.split(' ');
        const lastWord = words[words.length - 1];

        if(lastWord.startsWith('@') && lastWord.length > 1) {
            const query = lastWord.substring(1).toLowerCase();
            renderMentionSuggestions(query);
        } else {
            document.getElementById('mentionDropdown').style.display = 'none';
        }
    });

    gtInput.addEventListener('keydown', (e) => {
        const dd = document.getElementById('mentionDropdown');
        if(dd.style.display === 'block') {
            const items = dd.querySelectorAll('.mention-item');
            if(e.key === 'ArrowDown') { e.preventDefault(); mentionSearchIndex = Math.min(mentionSearchIndex + 1, items.length - 1); updateMentionSelection(items); }
            if(e.key === 'ArrowUp') { e.preventDefault(); mentionSearchIndex = Math.max(mentionSearchIndex - 1, 0); updateMentionSelection(items); }
            if(e.key === 'Enter' && items[mentionSearchIndex]) { e.preventDefault(); items[mentionSearchIndex].click(); }
        }
    });
}

// קריאה לאתחול לאחר switchMainView (הטאסק קונטיינר רק אז מרונדר)
const _origSwitchMainView = window.switchMainView;
window.switchMainView = function(viewName) {
    _origSwitchMainView(viewName);
    if(viewName === 'tasks') initTasksEngine();
};

function renderMentionSuggestions(query) {
    const dd = document.getElementById('mentionDropdown');
    if(!dd) return;

    // זיהוי מצב חיפוש ילדים: המשתמש הקליד "ילד ..." או "ילד:"
    const childMode = query.startsWith('ילד');
    const childQuery = childMode ? query.replace(/^ילד[:\s]*/, '').trim() : '';

    let results = [];
    Object.keys(db).forEach(b => {
        if(b==='__BOARDS__' || b==='__SETTINGS__' || b==='meta') return;
        if(!db[b] || !db[b].apts) return;
        db[b].apts.forEach((a, i) => {
            if(childMode) {
                // חיפוש בילדים בלבד
                (a.childrenList || []).forEach((c, ci) => {
                    if(c.name && c.name.toLowerCase().includes(childQuery)) {
                        results.push({ bldg: b, idx: i, name: a.name, matchName: c.name, role: 'ילד', icon: 'fa-child' });
                    }
                });
            } else {
                // ברירת מחדל: שם משפחה, שם אב, שם אם
                const familyMatch = a.name && a.name.toLowerCase().includes(query);
                const fatherMatch = a.father && a.father.toLowerCase().includes(query);
                const motherMatch = a.mother && a.mother.toLowerCase().includes(query);
                if(familyMatch) {
                    results.push({ bldg: b, idx: i, name: a.name, matchName: a.name, role: 'משפחה', icon: 'fa-users' });
                } else if(fatherMatch) {
                    results.push({ bldg: b, idx: i, name: a.name, matchName: a.father, role: 'אב', icon: 'fa-user' });
                } else if(motherMatch) {
                    results.push({ bldg: b, idx: i, name: a.name, matchName: a.mother, role: 'אם', icon: 'fa-user' });
                }
            }
        });
    });

    if(results.length > 0) {
        dd.innerHTML = results.slice(0, 10).map((r, i) => `
            <div class="mention-item ${i===0?'active':''}" onclick="addMention('${encodeURIComponent(r.bldg)}', ${r.idx}, '${escapeHTML(r.name)}')">
                <span><i class="fas ${r.icon}" style="color:var(--text-muted); margin-left:8px;"></i>
                    ${r.matchName !== r.name ? `<span style="opacity:0.6; font-size:12px;">(${escapeHTML(r.role)})</span> ${escapeHTML(r.matchName)} — ` : ''}
                    משפחת ${escapeHTML(r.name)}
                </span>
                <span class="cp-hint">${r.bldg===NO_ADDRESS_KEY?'ללא כתובת':escapeHTML(r.bldg)}</span>
            </div>
        `).join('');
        dd.style.display = 'block';
        mentionSearchIndex = 0;
    } else {
        dd.style.display = 'none';
    }
}

function updateMentionSelection(items) {
    items.forEach(el => el.classList.remove('active'));
    if(items[mentionSearchIndex]) {
        items[mentionSearchIndex].classList.add('active');
        items[mentionSearchIndex].scrollIntoView({ block: 'nearest' });
    }
}

window.addMention = (bEnc, idx, name) => {
    const bldg = decodeURIComponent(bEnc);
    if(!window.currentTaskMentions.find(m => m.bldg === bldg && m.idx === idx)) {
        window.currentTaskMentions.push({ bldg, idx, name });
    }
    if(gtInput) {
        const words = gtInput.value.split(' ');
        words.pop();
        gtInput.value = words.join(' ') + (words.length > 0 ? ' ' : '');
        gtInput.focus();
    }
    const dd = document.getElementById('mentionDropdown');
    if(dd) dd.style.display = 'none';
    renderTaskTags();
};

function renderTaskTags() {
    const c = document.getElementById('taskTagsContainer');
    if(!c) return;
    c.innerHTML = window.currentTaskMentions.map((m, i) => `
        <span class="task-tag"><i class="fas fa-user-check"></i> עבור ${escapeHTML(m.name)} <i class="fas fa-times" onclick="window.currentTaskMentions.splice(${i},1); renderTaskTags();" title="הסר שיוך"></i></span>
    `).join('');
}

window.saveGlobalTask = () => {
    if(!gtInput) gtInput = document.getElementById('globalTaskInput');
    const text = gtInput ? gtInput.value.trim() : '';
    const dateEl = document.getElementById('globalTaskDate');
    const date = dateEl ? dateEl.value : '';
    if(!text) return showToast('נא להזין את תוכן המשימה קודם', 'warning');

    const taskObj = { text, date, done: false };

    if(window.currentTaskMentions.length > 0) {
        window.currentTaskMentions.forEach(m => {
            if(!db[m.bldg].apts[m.idx].tasks) db[m.bldg].apts[m.idx].tasks = [];
            db[m.bldg].apts[m.idx].tasks.push({...taskObj});
        });
        showToast(`המשימה פוצלה ונוספה ל-${window.currentTaskMentions.length} כרטיסי משפחה!`, 'success');
    } else {
        if(!db.meta.generalTasks) db.meta.generalTasks = [];
        db.meta.generalTasks.push(taskObj);
        showToast('המשימה נשמרה כמשימה כללית ללא שיוך.', 'success');
    }

    if(gtInput) gtInput.value = '';
    window.currentTaskMentions = [];
    renderTaskTags();
    saveDB();
    renderGlobalTasks();
};

window.renderGlobalTasks = () => {
    const c = document.getElementById('globalTasksList');
    if(!c) return;

    let allTasks = [];

    (db.meta.generalTasks || []).forEach((t, i) => {
        if(!t.done) allTasks.push({ ...t, isGeneral: true, idx: i });
    });

    Object.keys(db).forEach(b => {
        if(b==='__BOARDS__' || b==='__SETTINGS__' || b==='meta') return;
        if(!db[b] || !db[b].apts) return;
        db[b].apts.forEach((a, i) => {
            (a.tasks || []).forEach((t, tIdx) => {
                if(!t.done) allTasks.push({ ...t, isGeneral: false, bldg: b, aptIdx: i, taskIdx: tIdx, familyName: a.name });
            });
        });
    });

    allTasks.sort((x, y) => new Date(x.date || '2099-01-01') - new Date(y.date || '2099-01-01'));

    if(allTasks.length === 0) {
        c.innerHTML = '<div class="empty-state modern-empty"><i class="fas fa-glass-cheers" style="font-size:45px;"></i><h4>אין משימות פתוחות!</h4><p>איזה אלוף! הכל נקי ומסודר.</p></div>';
        return;
    }

    c.innerHTML = allTasks.map(t => {
        let clickFn = t.isGeneral
            ? `completeGlobalTask(true, null, null, ${t.idx}, this)`
            : `completeGlobalTask(false, '${encodeURIComponent(t.bldg)}', ${t.aptIdx}, ${t.taskIdx}, this)`;

        let badge = t.isGeneral
            ? `<span class="tag-badge" style="background:var(--border-light); color:var(--text-muted); cursor:default;"><i class="fas fa-globe"></i> משימה כללית</span>`
            : `<span class="tag-badge" style="cursor:pointer;" onclick="currentBldg='${t.bldg}'; openClientCard(${t.aptIdx})"><i class="fas fa-user-circle"></i> ${escapeHTML(t.familyName)} (פתח כרטיס)</span>`;

        let isPastDue = t.date && new Date(t.date) < new Date(new Date().setHours(0,0,0,0));
        let dateColor = isPastDue ? 'var(--danger)' : 'var(--text-muted)';

        return `
        <div class="global-task-row">
            <div style="display:flex; align-items:flex-start; gap:15px; flex:1;">
                <button class="btn-icon" style="background:transparent; border:2px solid var(--border-light); color:transparent; padding:8px 12px; transition:0.2s;" onmouseover="this.style.color='var(--success)';this.style.borderColor='var(--success)';" onmouseout="this.style.color='transparent';this.style.borderColor='var(--border-light)';" onclick="${clickFn}" title="סמן כמבוצע"><i class="fas fa-check"></i></button>
                <div>
                    <div style="font-weight:700; font-size:16px; margin-bottom:6px; color:var(--text-main);">${escapeHTML(t.text)}</div>
                    <div style="display:flex; gap:10px; align-items:center; font-size:13px; flex-wrap:wrap;">
                        ${badge}
                        <span style="color:${dateColor}; font-weight:${isPastDue?'bold':'normal'};"><i class="far fa-calendar-alt"></i> ${t.date || 'ללא תאריך יעד'} ${isPastDue?'(באיחור)':''}</span>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
};

window.completeGlobalTask = (isGeneral, bEnc, aptIdx, tIdx, btnEl) => {
    if(btnEl) {
        btnEl.disabled = true;
        btnEl.closest('.global-task-row').classList.add('task-done-anim');
        btnEl.style.color = 'var(--success)';
        btnEl.style.background = 'rgba(16,185,129,0.1)';
        btnEl.style.borderColor = 'var(--success)';
    }
    setTimeout(() => {
        if(isGeneral) {
            db.meta.generalTasks[tIdx].done = true;
        } else {
            const bldg = decodeURIComponent(bEnc);
            db[bldg].apts[aptIdx].tasks[tIdx].done = true;
        }
        saveDB();
        showToast('המשימה הושלמה וירדה מהדאשבורד!', 'success');
        renderGlobalTasks();
    }, 500);
};
