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
const SCOPES = 'email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/contacts.readonly';
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

// ── Google OAuth — Redirect Flow (no popup, works with COOP headers) ──
// Instead of opening a popup, we redirect the page to Google's auth endpoint.
// Google redirects back with the token in the URL hash (#access_token=...).

window.handleGoogleLogin = function() {
    localStorage.removeItem('gdrive_session');
    accessToken = null;

    const redirectUri = encodeURIComponent(location.origin + location.pathname);
    const scope      = encodeURIComponent(SCOPES);
    const url = [
        'https://accounts.google.com/o/oauth2/v2/auth',
        '?client_id=' + CLIENT_ID,
        '&redirect_uri=' + redirectUri,
        '&response_type=token',
        '&scope=' + scope,
        '&prompt=select_account',
        '&include_granted_scopes=true'
    ].join('');

    // Save current db to localStorage before leaving so no data is lost
    try { localStorage.setItem('community_data_final', JSON.stringify(db)); } catch(e) {}
    location.href = url;
};

// ── On page load: check if Google redirected back with a token in the hash ──
function checkOAuthRedirect() {
    const hash = location.hash;
    if (!hash || !hash.includes('access_token')) return false;

    // Parse the hash fragment
    const params = {};
    hash.slice(1).split('&').forEach(part => {
        const [k, v] = part.split('=');
        params[k] = decodeURIComponent(v || '');
    });

    if (params.access_token) {
        const expiresIn = parseInt(params.expires_in || '3500', 10);
        accessToken = params.access_token;
        const expiresAt = Date.now() + expiresIn * 1000;
        localStorage.setItem('gdrive_session', JSON.stringify({ token: accessToken, expiresAt }));
        // Clean the token from the URL so it is not visible / bookmarked
        history.replaceState(null, '', location.pathname);
        scheduleTokenRefresh();
        return true;
    }
    return false;
}

window.onload = () => {
    let lastLogin = localStorage.getItem('last_login_date');
    let todayStr = new Date().toISOString().split('T')[0];
    let welcomeDiv = document.getElementById('welcomeMessage');

    // שם השליחות לברכה מותאמת אישית
    const prefs = JSON.parse(localStorage.getItem('crm_prefs') || '{}');
    const missionName = prefs.missionName || '';
    const greetingName = missionName ? `${missionName}` : 'למערכת';

    if(lastLogin === todayStr) {
        welcomeDiv.innerHTML = missionName
            ? `ברוך הבא, <strong>${missionName}</strong>! ממשיכים את המומנטום 🚀`
            : `איזה כיף שחזרת! ממשיכים את המומנטום 🚀`;
    } else if(lastLogin) {
        welcomeDiv.innerHTML = missionName
            ? `ברוך שובך, <strong>${missionName}</strong>! בוא נראה מה תעשה היום 🔥`
            : `ברוך שובך! פעם קודמת היית אש, בוא נראה מה תעשה היום 🔥`;
    } else {
        welcomeDiv.innerHTML = missionName
            ? `ברוך הבא, <strong>${missionName}</strong>! כאן מתחילים להפוך את העולם 🌍`
            : `ברוך הבא למערכת! כאן מתחילים להפוך את העולם 🌍`;
    }
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
    // Set initial body view class for CSS targeting
    document.body.classList.add('view-' + currentMainView);
    if(localStorage.getItem('darkMode')==='true') { document.body.classList.add('dark-mode'); document.getElementById('darkModeIcon').className='fas fa-sun'; }
    populateFilterDropdowns();
    // debounce לחיפוש — מונע ריצות מיותרות
    function debounce(fn, delay = 300) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
    }
    document.getElementById('smartSearch').addEventListener('input', debounce(handleOmniSearch));

    // Check if Google just redirected back with a token in the URL hash
    const redirectedWithToken = checkOAuthRedirect();

    const session = JSON.parse(localStorage.getItem('gdrive_session'));
    if (session && session.token && session.expiresAt > new Date().getTime()) {
        accessToken = session.token;
        if (!redirectedWithToken) scheduleTokenRefresh();
        document.getElementById('auth-overlay').style.display='none';
        document.getElementById('splash-screen').style.display='flex';
        syncWithDrive();
    } else {
        document.getElementById('google-btn').innerHTML = `<button class="btn btn-primary" style="padding:12px 20px; font-size:16px;" onclick="handleGoogleLogin()"><i class="fab fa-google"></i> התחבר לענן</button>`;
        setTimeout(() => {
            document.getElementById('splash-screen').style.opacity='0';
            setTimeout(() => {
                document.getElementById('splash-screen').style.display='none';
                document.getElementById('auth-overlay').style.display='flex';
            }, 800);
        }, 1500);
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

// ════════════════════════════════════════════════════════
// ── Onboarding Multi-Step & Territory System ──
// ════════════════════════════════════════════════════════

let tempTerritoryPolygon = null; // GeoJSON polygon coords array
let tempTerritorySource = 'onboarding'; // 'onboarding' | 'settings'
let tmMap = null; // mini map inside territory editor
let tmPoints = []; // array of [lng,lat]
let tmMode = 'draw'; // 'draw' | 'erase' | 'move'
let territoryGeocoder = null; // geocoder for territory city search
let settingsTerritoryGeocoder = null;

// Go to step 2 of onboarding
window.obGoStep2 = () => {
    if(!tempObLoc) { showToast('יש לבחור מיקום מרכזי תחילה', 'warning'); return; }
    // Save step 1
    appSettings.homeLocation = { coords: tempObLoc.coords, address: tempObLoc.address, isChabad: document.getElementById('onboardingIsChabad').checked };
    document.getElementById('obStep1').style.display = 'none';
    document.getElementById('obStep2').style.display = 'block';
    document.getElementById('obTab1').style.borderBottomColor = 'var(--text-muted)';
    document.getElementById('obTab1').style.color = 'var(--text-muted)';
    document.getElementById('obTab2').style.borderBottomColor = 'var(--accent)';
    document.getElementById('obTab2').style.color = 'var(--accent)';
    // Init territory geocoder for onboarding if not done
    if(!territoryGeocoder) {
        territoryGeocoder = new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl: mapboxgl, placeholder: 'חפש עיר או יישוב...', countries: 'il', language: 'he', marker: false, flyTo: false, types: 'place,locality,neighborhood,district' });
        const c = document.getElementById('obTerritoryGeocoderContainer');
        if(c) c.appendChild(territoryGeocoder.onAdd(map));
        territoryGeocoder.on('result', async (e) => {
            await fetchCityBoundary(e.result, 'onboarding');
        });
    }
};

window.obGoStep1 = () => {
    document.getElementById('obStep2').style.display = 'none';
    document.getElementById('obStep1').style.display = 'block';
    document.getElementById('obTab2').style.borderBottomColor = 'transparent';
    document.getElementById('obTab2').style.color = 'var(--text-muted)';
    document.getElementById('obTab1').style.borderBottomColor = 'var(--accent)';
    document.getElementById('obTab1').style.color = 'var(--accent)';
};

window.skipOnboarding = () => {
    if(tempObLoc) {
        appSettings.homeLocation = { coords: tempObLoc.coords, address: tempObLoc.address, isChabad: document.getElementById('onboardingIsChabad') ? document.getElementById('onboardingIsChabad').checked : true };
        localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
        saveDB();
    }
    document.getElementById('onboardingModal').style.display = 'none';
    updateHomeButton();
    refreshMap();
    showToast('ניתן להגדיר אזור שליחות בכל עת דרך ההגדרות', 'info');
};

window.saveFullOnboarding = () => {
    // Save home location
    if(tempObLoc) {
        appSettings.homeLocation = { coords: tempObLoc.coords, address: tempObLoc.address, isChabad: document.getElementById('onboardingIsChabad').checked };
    }
    // Save mission name
    const mname = document.getElementById('obMissionName').value.trim();
    if(mname) appSettings.missionName = mname;
    // Save territory
    if(tempTerritoryPolygon) {
        const obDrawModeEl = document.querySelector('input[name="obDrawMode"]:checked');
        appSettings.territory = {
            polygon: tempTerritoryPolygon,
            displayMode: 'border',
            drawMode: obDrawModeEl ? obDrawModeEl.value : 'city'
        };
    }
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    document.getElementById('onboardingModal').style.display = 'none';
    updateHomeButton();
    renderTerritoryOnMap();
    refreshMap();
    showToast('הגדרות השליחות נשמרו! 🚀', 'success');
    // אוטומטית — התחל סריקת דירות ברקע
    if(appSettings.territory?.polygon) {
        setTimeout(() => startTerritoryUnitsScan(), 1500);
    }
};

let _drawModeDebounce = null;
window.obUpdateDrawMode = (mode) => {
    if(!mode) {
        const checked = document.querySelector('input[name="obDrawMode"]:checked');
        mode = checked ? checked.value : 'city';
    }
    clearTimeout(_drawModeDebounce);
    _drawModeDebounce = setTimeout(() => {
        const radio = document.querySelector(`input[name="obDrawMode"][value="${mode}"]`);
        if(radio) radio.checked = true;
        const cityDiv = document.getElementById('obCitySearchMode');
        const manualDiv = document.getElementById('obManualDrawMode');
        if(cityDiv) cityDiv.style.display = mode === 'city' ? 'block' : 'none';
        if(manualDiv) manualDiv.style.display = mode === 'manual' ? 'block' : 'none';
    }, 20);
};

let _setDrawModeDebounce = null;
window.setUpdateDrawMode = (mode) => {
    if(!mode) {
        const checked = document.querySelector('input[name="setDrawMode"]:checked');
        mode = checked ? checked.value : 'city';
    }
    clearTimeout(_setDrawModeDebounce);
    _setDrawModeDebounce = setTimeout(() => {
        const radio = document.querySelector(`input[name="setDrawMode"][value="${mode}"]`);
        if(radio) radio.checked = true;
        const cityDiv = document.getElementById('setCitySearchMode');
        const manualDiv = document.getElementById('setManualDrawMode');
        if(cityDiv) cityDiv.style.display = mode === 'city' ? 'block' : 'none';
        if(manualDiv) manualDiv.style.display = mode === 'manual' ? 'block' : 'none';
    }, 20);
};

// Fetch city/place boundary from Nominatim (OpenStreetMap)
async function fetchCityBoundary(result, source) {
    try {
        showToast('מחפש גבולות...', 'info');
        // Try to get OSM polygon via Nominatim
        const name = result.text || result.place_name;
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&country=israel&format=json&polygon_geojson=1&limit=3`, {
            headers: { 'Accept-Language': 'he' }
        });
        const data = await resp.json();
        // Find one with a polygon
        const item = data.find(d => d.geojson && (d.geojson.type === 'Polygon' || d.geojson.type === 'MultiPolygon'));
        if(item) {
            let coords;
            if(item.geojson.type === 'Polygon') coords = item.geojson.coordinates[0];
            else coords = item.geojson.coordinates[0][0]; // outer ring of first polygon
            tempTerritoryPolygon = coords;
            const areaKm2 = computePolygonAreaKm2(coords);
            showTerritoryInfo(name, areaKm2, source);
            showToast(`גבולות ${name} נטענו ✓`, 'success');
        } else {
            showToast('לא נמצא פוליגון לאזור זה. נסה ציור ידני.', 'warning');
        }
    } catch(e) {
        showToast('שגיאה בטעינת גבולות', 'error');
    }
}

function computePolygonAreaKm2(coords) {
    // Shoelace formula with approximate lat/lng to km
    if(!coords || coords.length < 3) return 0;
    let area = 0;
    const n = coords.length;
    for(let i = 0; i < n; i++) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[(i+1) % n];
        area += x1 * y2 - x2 * y1;
    }
    // Convert from degrees² to km² (rough: 1 deg lat ≈ 111 km, 1 deg lng ≈ 111*cos(lat) km)
    const avgLat = coords.reduce((s,c) => s + c[1], 0) / coords.length;
    const lngFactor = Math.cos(avgLat * Math.PI / 180);
    const areaKm2 = Math.abs(area) / 2 * 111 * 111 * lngFactor;
    return areaKm2;
}

function showTerritoryInfo(name, areaKm2, source) {
    if(source === 'onboarding') {
        const infoEl = document.getElementById('obTerritoryInfo');
        if(infoEl) {
            infoEl.style.display = 'block';
            document.getElementById('obTerritoryName').innerText = name;
            document.getElementById('obTerritoryArea').innerText = areaKm2 < 1 ? (areaKm2 * 100).toFixed(1) + ' דונם' : areaKm2.toFixed(2);
        }
    } else {
        const infoEl = document.getElementById('settingsTerritoryInfo');
        if(infoEl) {
            infoEl.style.display = 'block';
            document.getElementById('settingsTerritoryName').innerText = name;
            document.getElementById('settingsTerritoryArea').innerText = areaKm2 < 1 ? (areaKm2 * 100).toFixed(1) + ' דונם' : areaKm2.toFixed(2);
        }
        document.getElementById('shlichutAreaBadge').style.display = 'inline';
    }
}

// ── Territory Map Editor (manual drawing) ──
window.openTerritoryMapEditor = (source) => {
    tempTerritorySource = source || 'onboarding';
    tmPoints = tempTerritoryPolygon ? [...tempTerritoryPolygon] : [];
    tmMode = 'draw';

    // הצג מודל קודם — חשוב! Mapbox צריך גודל אמיתי של ה-container
    document.getElementById('territoryMapEditorModal').style.display = 'flex';

    // עדכן כפתורי מצב
    tmSetMode('draw');

    setTimeout(() => {
        if(tmMap) {
            // מפה קיימת — רק resize ועדכן שכבות
            tmMap.resize();
            updateTmLayer();
            // עדכן מרכז אם יש נקודות
            if(tmPoints.length > 0) {
                const cx = tmPoints.reduce((s,p)=>s+p[0],0)/tmPoints.length;
                const cy = tmPoints.reduce((s,p)=>s+p[1],0)/tmPoints.length;
                tmMap.flyTo({ center:[cx,cy], zoom:14, duration:600 });
            }
            return;
        }
        // מפה חדשה
        const center = (tmPoints.length > 0)
            ? [tmPoints.reduce((s,p)=>s+p[0],0)/tmPoints.length, tmPoints.reduce((s,p)=>s+p[1],0)/tmPoints.length]
            : (appSettings.homeLocation?.coords || appSettings.center || [35.2, 31.8]);

        tmMap = new mapboxgl.Map({
            container: 'territoryEditorMap',
            style: 'mapbox://styles/mapbox/streets-v12',
            center, zoom: 14,
            language: 'he'
        });

        tmMap.on('load', () => {
            tmMap.addSource('tm-poly', { type: 'geojson', data: buildTmGeoJSON() });
            tmMap.addLayer({ id: 'tm-fill', type: 'fill', source: 'tm-poly', paint: { 'fill-color': '#10b981', 'fill-opacity': 0.12 } });
            tmMap.addLayer({ id: 'tm-line', type: 'line', source: 'tm-poly', paint: { 'line-color': '#10b981', 'line-width': 2.5, 'line-dasharray': [4,2] } });
            tmMap.addSource('tm-pts', { type: 'geojson', data: buildTmPointsGeoJSON() });
            tmMap.addLayer({ id: 'tm-pts-layer', type: 'circle', source: 'tm-pts', paint: {
                'circle-radius': ['case', ['boolean', ['feature-state','dragging'], false], 11, 8],
                'circle-color': ['case', ['boolean', ['feature-state','dragging'], false], '#f59e0b', '#10b981'],
                'circle-stroke-width': 2.5,
                'circle-stroke-color': 'white',
                'circle-pitch-alignment': 'map'
            }});

            // ── מצב גרירה ──
            let draggingIdx = null;

            // לחיצה על נקודה — התחל גרירה במצב 'move'
            tmMap.on('mousedown', 'tm-pts-layer', (e) => {
                if(tmMode !== 'move') return;
                e.preventDefault();
                draggingIdx = e.features[0].properties.idx;
                tmMap.getCanvas().style.cursor = 'grabbing';
                // disable map drag while we drag a point
                tmMap.dragPan.disable();
                // highlight
                tmMap.setFeatureState({ source:'tm-pts', id: draggingIdx }, { dragging: true });
            });

            // זוז עם העכבר — עדכן מיקום הנקודה
            tmMap.on('mousemove', (e) => {
                if(tmMode !== 'move' || draggingIdx === null) return;
                tmPoints[draggingIdx] = [e.lngLat.lng, e.lngLat.lat];
                updateTmLayer();
            });

            // שחרור — סיים גרירה
            const endDrag = () => {
                if(draggingIdx === null) return;
                tmMap.setFeatureState({ source:'tm-pts', id: draggingIdx }, { dragging: false });
                draggingIdx = null;
                tmMap.dragPan.enable();
                tmMap.getCanvas().style.cursor = 'grab';
                updateTmLayer();
            };
            tmMap.on('mouseup', endDrag);
            tmMap.on('mouseleave', endDrag); // safety net

            // ── לחיצה על המפה (לא על נקודה) — הוסף נקודה במצב ציור ──
            tmMap.on('click', (e) => {
                if(tmMode !== 'draw') return;
                const feat = tmMap.queryRenderedFeatures(e.point, { layers: ['tm-pts-layer'] });
                if(feat.length > 0) return; // לחיצה על נקודה קיימת — התעלם
                if(draggingIdx !== null) return; // היינו בגרירה
                tmPoints.push([e.lngLat.lng, e.lngLat.lat]);
                updateTmLayer();
            });

            // ── לחיצה על נקודה קיימת ──
            tmMap.on('click', 'tm-pts-layer', (e) => {
                e.stopPropagation && e.stopPropagation();
                if(tmMode === 'erase') {
                    const idx = e.features[0].properties.idx;
                    tmPoints.splice(idx, 1);
                    updateTmLayer();
                }
            });

            // ── קרסורים ──
            tmMap.on('mouseenter', 'tm-pts-layer', () => {
                if(tmMode === 'erase') tmMap.getCanvas().style.cursor = 'pointer';
                else if(tmMode === 'move') tmMap.getCanvas().style.cursor = 'grab';
                else tmMap.getCanvas().style.cursor = 'default';
            });
            tmMap.on('mouseleave', 'tm-pts-layer', () => {
                if(draggingIdx !== null) return;
                tmMap.getCanvas().style.cursor = tmMode === 'draw' ? 'crosshair' : (tmMode === 'move' ? 'grab' : '');
            });

            updateTmLayer();
        });

        tmMap.on('error', (e) => {
            console.warn('TmMap error:', e);
        });
    }, 150); // 150ms — מספיק ל-flex display להתפרס לפני Mapbox init
};

function buildTmGeoJSON() {
    if(tmPoints.length < 3) return { type: 'FeatureCollection', features: [] };
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...tmPoints, tmPoints[0]]] } }] };
}

function buildTmPointsGeoJSON() {
    return {
        type: 'FeatureCollection',
        features: tmPoints.map((p, i) => ({
            type: 'Feature',
            id: i, // חשוב! נדרש עבור setFeatureState (גרירה)
            properties: { idx: i },
            geometry: { type: 'Point', coordinates: p }
        }))
    };
}

function updateTmLayer() {
    if(!tmMap || !tmMap.getSource('tm-poly')) return;
    tmMap.getSource('tm-poly').setData(buildTmGeoJSON());
    tmMap.getSource('tm-pts').setData(buildTmPointsGeoJSON());
    document.getElementById('tmPointCount').innerText = tmPoints.length;
    // Update area
    if(tmPoints.length >= 3) {
        const areaKm2 = computePolygonAreaKm2([...tmPoints, tmPoints[0]]);
        document.getElementById('tmEditorArea').innerText = areaKm2 < 1 ? (areaKm2 * 100).toFixed(1) + ' דונם' : areaKm2.toFixed(2);
    } else {
        document.getElementById('tmEditorArea').innerText = '—';
    }
    document.getElementById('tmEditorStatus').innerText = tmPoints.length < 3 ? `הוסף לפחות 3 נקודות (${tmPoints.length} עד כה)` : `${tmPoints.length} נקודות — ניתן לאשר`;
}

window.tmSetMode = (mode) => {
    tmMode = mode;
    const btnDraw  = document.getElementById('tmBtnDraw');
    const btnErase = document.getElementById('tmBtnErase');
    const btnMove  = document.getElementById('tmBtnMove');

    // Reset all
    [btnDraw, btnErase, btnMove].forEach(b => {
        if(!b) return;
        b.style.background = 'var(--surface)';
        b.style.color = 'var(--text-main)';
        b.style.borderColor = 'var(--border-light)';
    });

    // Activate current
    if(mode === 'draw' && btnDraw) {
        btnDraw.style.background = '#10b981';
        btnDraw.style.color = 'white';
        btnDraw.style.borderColor = '#10b981';
    } else if(mode === 'erase' && btnErase) {
        btnErase.style.background = '#ef4444';
        btnErase.style.color = 'white';
        btnErase.style.borderColor = '#ef4444';
    } else if(mode === 'move' && btnMove) {
        btnMove.style.background = '#f59e0b';
        btnMove.style.color = 'white';
        btnMove.style.borderColor = '#f59e0b';
    }

    // עדכן קרסור מפה
    if(tmMap) {
        tmMap.getCanvas().style.cursor = mode === 'draw' ? 'crosshair' : (mode === 'move' ? 'grab' : '');
    }
};

window.tmClearAll = () => { tmPoints = []; updateTmLayer(); };

window.closeTerritoryEditor = () => {
    document.getElementById('territoryMapEditorModal').style.display = 'none';
    // נאפס את המפה כדי שבפתיחה הבאה היא תתאתחל נכון עם המיקום הנכון
    if(tmMap) {
        try { tmMap.remove(); } catch(e) {}
        tmMap = null;
    }
};

window.confirmTerritoryDrawing = () => {
    if(tmPoints.length < 3) { showToast('יש לסמן לפחות 3 נקודות', 'warning'); return; }
    tempTerritoryPolygon = [...tmPoints, tmPoints[0]];
    const areaKm2 = computePolygonAreaKm2(tempTerritoryPolygon);
    showTerritoryInfo('ציור ידני', areaKm2, tempTerritorySource);
    document.getElementById('territoryMapEditorModal').style.display = 'none';
    // Update draw status in onboarding
    const st = document.getElementById('obDrawStatus');
    if(st) st.innerText = `✓ ${tmPoints.length} נקודות סומנו, שטח: ${areaKm2 < 1 ? (areaKm2*100).toFixed(1)+' דונם' : areaKm2.toFixed(2)+' קמ"ר'}`;
    showToast('תיחום נשמר ✓', 'success');
};

// ── Territory rendering on main map ──
function renderTerritoryOnMap() {
    if(!appSettings.territory || !appSettings.territory.polygon) {
        // Remove layers if exist
        ['territory-fill','territory-line'].forEach(id => { try { if(map.getLayer(id)) map.removeLayer(id); } catch(e){} });
        ['territory-source'].forEach(id => { try { if(map.getSource(id)) map.removeSource(id); } catch(e){} });
        return;
    }
    const coords = appSettings.territory.polygon;
    const displayMode = appSettings.territory.displayMode || 'border';
    const geoData = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };

    if(!map.getSource('territory-source')) {
        map.addSource('territory-source', { type: 'geojson', data: geoData });
        map.addLayer({ id: 'territory-fill', type: 'fill', source: 'territory-source', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0 } }, 'waterway-label');
        map.addLayer({ id: 'territory-line', type: 'line', source: 'territory-source', paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [5,3] } }, 'waterway-label');
    } else {
        map.getSource('territory-source').setData(geoData);
    }
    // Apply display mode
    applyTerritoryDisplayMode(displayMode);
}

function applyTerritoryDisplayMode(mode) {
    if(!map.getLayer('territory-fill')) return;
    if(mode === 'fill') {
        map.setPaintProperty('territory-fill', 'fill-opacity', 0.07);
        map.setPaintProperty('territory-line', 'line-opacity', 1);
        map.setPaintProperty('territory-line', 'line-width', 2);
    } else if(mode === 'border') {
        map.setPaintProperty('territory-fill', 'fill-opacity', 0);
        map.setPaintProperty('territory-line', 'line-opacity', 0.7);
        map.setPaintProperty('territory-line', 'line-width', 2.5);
        map.setPaintProperty('territory-line', 'line-dasharray', [5,3]);
    } else { // none
        map.setPaintProperty('territory-fill', 'fill-opacity', 0);
        map.setPaintProperty('territory-line', 'line-opacity', 0);
    }
}

window.updateTerritoryDisplay = () => {
    const mode = document.querySelector('input[name="territoryDisplayMode"]:checked').value;
    if(!appSettings.territory) appSettings.territory = {};
    appSettings.territory.displayMode = mode;
    applyTerritoryDisplayMode(mode);
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
};

window.clearTerritory = async () => {
    const ok = await showCustomDialog({ title: 'נקה תיחום', message: 'למחוק את אזור השליחות המתוחם?', showCancel: true });
    if(!ok) return;
    appSettings.territory = null;
    tempTerritoryPolygon = null;
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    document.getElementById('settingsTerritoryInfo').style.display = 'none';
    document.getElementById('shlichutAreaBadge').style.display = 'none';
    renderTerritoryOnMap();
    showToast('תיחום נמחק', 'info');
};

// Initialize territory geocoder in settings modal
function initSettingsTerritoryGeocoder() {
    const c = document.getElementById('settingsTerritoryGeocoderContainer');
    if(!c || c.children.length > 0) return;
    settingsTerritoryGeocoder = new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl: mapboxgl, placeholder: 'חפש עיר או יישוב...', countries: 'il', language: 'he', marker: false, flyTo: false, types: 'place,locality,neighborhood,district' });
    c.appendChild(settingsTerritoryGeocoder.onAdd(map));
    settingsTerritoryGeocoder.on('result', async (e) => {
        await fetchCityBoundary(e.result, 'settings');
        if(tempTerritoryPolygon) appSettings.territory = { polygon: tempTerritoryPolygon, displayMode: appSettings.territory?.displayMode || 'border' };
        renderTerritoryOnMap();
    });
}

// ══════════════════════════════════════════════════════════════════════
// ██  מנוע דירות — GIS עירוני + תצוגת מפת קומות + כיסוי שליחות  ██
// ══════════════════════════════════════════════════════════════════════

// ── מילון ערים ─────────────────────────────────────────────────────
const CITIES_GIS_CONFIG = {
    jerusalem: {
        name: 'ירושלים',
        apiType: 'ARCGIS',
        baseUrl: 'https://gisviewer.jerusalem.muni.il/arcgis/rest/services/BaseLayers/MapServer',
        layerId: '30',
        sr: 2039,
        fields: {
            objectId: 'OBJECTID',
            units:    'NUM_APTS_C',   // מספר דירות
            street:   'StreetName1',  // שם רחוב
            num:      'BLDG_NUM',     // מספר בית
            floors:   'NUM_FLOORS',   // מספר קומות (בונוס!)
            entrances:'NUM_ENTR',     // מספר כניסות (בונוס!)
            usage:    'BLDG_CH'       // שימוש במבנה (מגורים/מסחר/...)
        }
    },
    tel_aviv: {
        name: 'תל אביב',
        apiType: 'ARCGIS',
        baseUrl: 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer',
        layerId: '5',
        sr: 2039,
        fields: { objectId:'OID', units:'T_DIROT', street:'STREET_NAME', num:'HOUSE_NUMBER' }
    },
    haifa: {
        name: 'חיפה',
        apiType: 'ARCGIS',
        baseUrl: 'https://gis.haifa.muni.il/arcgis/rest/services/Haifa/BuildingsService/MapServer',
        layerId: '0',
        sr: 2039,
        fields: { objectId:'OBJECTID', units:'DIROT', street:'STREET_NAME', num:'HOUSE_NUM' }
    }
};

// ── מצב מודול ──────────────────────────────────────────────────────
let unitsEngineState = {
    lastScan: null,         // timestamp
    scannedBldgCount: 0,
    detectedCityId: null
};

// ── סטטוסי מקור ──
const UNIT_SRC = {
    CITY:     { label:'נתוני עירייה', color:'#94a3b8', text:'#475569', icon:'🏛️' },
    ESTIMATE: { label:'הערכה',        color:'#f59e0b', text:'#92400e', icon:'🟡' },
    VERIFIED: { label:'מאומת',        color:'#10b981', text:'#065f46', icon:'✅' }
};

// ── המרת קואורדינטות ITM ↔ WGS84 — נוסחת Transverse Mercator מדויקת ──
// ITM = Israel Transverse Mercator (EPSG:2039), GRS80 ellipsoid
// דיוק: < 1 מטר בכל שטח ישראל (אומת ב-round-trip test עם נתוני ירושלים אמיתיים)
const _ITM = {
    a:   6378137.0,
    f:   1/298.257222101,
    k0:  1.0000067,
    lat0: 31.7343936111 * Math.PI/180,
    lng0: 35.2045169444 * Math.PI/180,
    E0:  219529.584,
    N0:  626907.390    // False Northing הנכון — לא 2885516!
};
function _itmMeridArc(latR) {
    const {a,f} = _ITM;
    const b=a*(1-f), e2=1-(b*b)/(a*a), e4=e2*e2, e6=e2*e2*e2;
    return a*((1-e2/4-3*e4/64-5*e6/256)*latR-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*latR)+(15*e4/256+45*e6/1024)*Math.sin(4*latR)-(35*e6/3072)*Math.sin(6*latR));
}
function wgs84ToItm(lng, lat) {
    const {a,f,k0,lat0,lng0,E0,N0}=_ITM, b=a*(1-f), e2=1-(b*b)/(a*a), ep2=e2/(1-e2);
    const latR=lat*Math.PI/180, lngR=lng*Math.PI/180;
    const N=a/Math.sqrt(1-e2*Math.sin(latR)**2), T=Math.tan(latR)**2;
    const C=ep2*Math.cos(latR)**2, A=Math.cos(latR)*(lngR-lng0);
    const M=_itmMeridArc(latR), M0=_itmMeridArc(lat0);
    const x=E0+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T**2+72*C-58*ep2)*A**5/120);
    const y=N0+k0*(M-M0+N*Math.tan(latR)*(A**2/2+(5-T+9*C+4*C**2)*A**4/24+(61-58*T+T**2+600*C-330*ep2)*A**6/720));
    return {x, y};
}
function itmToWgs84(E, N) {
    const {a,f,k0,lat0,lng0,E0,N0}=_ITM, b=a*(1-f), e2=1-(b*b)/(a*a), ep2=e2/(1-e2);
    const e4=e2*e2, e6=e2*e2*e2;
    const M0=_itmMeridArc(lat0), M=M0+(N-N0)/k0;
    const mu=M/(a*(1-e2/4-3*e4/64-5*e6/256));
    const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
    const lat1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
    const N1=a/Math.sqrt(1-e2*Math.sin(lat1)**2), T1=Math.tan(lat1)**2;
    const C1=ep2*Math.cos(lat1)**2, R1=a*(1-e2)/Math.pow(1-e2*Math.sin(lat1)**2,1.5);
    const D=(E-E0)/(N1*k0);
    const latR=lat1-(N1*Math.tan(lat1)/R1)*(D**2/2-(5+3*T1+10*C1-4*C1**2-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1**2-252*ep2-3*C1**2)*D**6/720);
    const lngR=lng0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1**2+8*ep2+24*T1**2)*D**5/120)/Math.cos(lat1);
    return [lngR*180/Math.PI, latR*180/Math.PI];
}

// ── המר פוליגון WGS84 → bbox ITM (מדויק עם wgs84ToItm) ─────────
function polygonToITMBbox(polygon) {
    const pts = polygon.map(([lng,lat]) => wgs84ToItm(lng, lat));
    return {
        xmin: Math.min(...pts.map(p=>p.x)) - 100,
        ymin: Math.min(...pts.map(p=>p.y)) - 100,
        xmax: Math.max(...pts.map(p=>p.x)) + 100,
        ymax: Math.max(...pts.map(p=>p.y)) + 100
    };
}

// ── זיהוי עיר לפי מרכז פוליגון ─────────────────────────────────
async function detectCityFromPolygon(polygon) {
    if(!polygon || polygon.length < 3) return null;
    const cx = polygon.reduce((s,c)=>s+c[0],0)/polygon.length;
    const cy = polygon.reduce((s,c)=>s+c[1],0)/polygon.length;
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${cy}&lon=${cx}&format=json&accept-language=he`);
        const d = await r.json();
        const city = (d.address?.city || d.address?.town || d.address?.village || '').toLowerCase();
        if(city.includes('ירושלים') || city.includes('jerusalem')) return 'jerusalem';
        if(city.includes('תל אביב') || city.includes('tel aviv')) return 'tel_aviv';
        if(city.includes('חיפה') || city.includes('haifa')) return 'haifa';
        return null;
    } catch(e) { return null; }
}

async function fetchBuildingsFromArcGIS(cityId, polygon) {
    const cfg = CITIES_GIS_CONFIG[cityId];
    if(!cfg || cfg.apiType !== 'ARCGIS') return null;
    const bbox = polygonToITMBbox(polygon);
    const geometry = JSON.stringify({ xmin:bbox.xmin, ymin:bbox.ymin, xmax:bbox.xmax, ymax:bbox.ymax, spatialReference:{wkid:cfg.sr} });
    const f = cfg.fields;

    // כלול את כל השדות הידועים — כולל bonuses כמו קומות וכניסות
    const outFields = [f.objectId, f.units, f.street, f.num, f.floors, f.entrances, f.usage].filter(Boolean).join(',');

    const url = new URL(`${cfg.baseUrl}/${cfg.layerId}/query`);
    url.searchParams.set('f','json');
    url.searchParams.set('geometryType','esriGeometryEnvelope');
    url.searchParams.set('spatialRel','esriSpatialRelIntersects');
    url.searchParams.set('inSR', String(cfg.sr));
    url.searchParams.set('outSR', String(cfg.sr));
    url.searchParams.set('geometry', geometry);
    url.searchParams.set('outFields', outFields);
    url.searchParams.set('returnGeometry','true');

    console.log(`[GIS] ${cfg.name} → ${url.toString().slice(0,120)}...`);

    try {
        const resp = await fetch(url.toString());
        if(!resp.ok) throw new Error('HTTP '+resp.status);
        const data = await resp.json();

        // דיבוג — הצג מה חזר
        if(data.error) {
            console.warn(`[GIS] ${cfg.name} server error:`, data.error);
            return null;
        }
        console.log(`[GIS] ${cfg.name} → ${data.features?.length || 0} features returned`);
        if(!data.features || data.features.length === 0) return null;

        const results = {};
        for(const feat of data.features) {
            const a = feat.attributes;
            const street = a[f.street] || '';
            // BLDG_NUM יכול להיות מספר — המר למחרוזת
            const num = String(a[f.num] ?? '').trim();
            if(!street || !num || num === '0') continue;

            // ── חלץ מרכז מגיאומטריה אמיתית ──
            let itmX = null, itmY = null;
            const geom = feat.geometry;
            if(geom) {
                if(geom.x !== undefined && geom.y !== undefined) {
                    itmX = geom.x; itmY = geom.y;
                } else if(geom.rings?.length > 0) {
                    // פוליגון — מרכז הטבעת החיצונית
                    const ring = geom.rings[0];
                    itmX = ring.reduce((s,p)=>s+p[0],0)/ring.length;
                    itmY = ring.reduce((s,p)=>s+p[1],0)/ring.length;
                } else if(geom.points?.length > 0) {
                    itmX = geom.points[0][0]; itmY = geom.points[0][1];
                } else if(geom.paths?.length > 0) {
                    const path = geom.paths[0], mid = Math.floor(path.length/2);
                    itmX = path[mid][0]; itmY = path[mid][1];
                }
            }

            // המרת ITM → WGS84
            let coords = null;
            if(itmX !== null && itmY !== null) {
                try { coords = itmToWgs84(itmX, itmY); } catch(e) {
                    console.warn('[GIS] ITM conversion failed:', itmX, itmY, e.message);
                }
            }

            // סינון מדויק לפי פוליגון
            if(coords && !pointInPolygon(coords, polygon)) continue;

            const key = `${street} ${num}`.trim();
            const units    = parseInt(a[f.units])     || 0;
            const floors   = parseInt(a[f.floors])    || 0;
            const entrances= parseInt(a[f.entrances]) || 0;
            const usage    = a[f.usage]?.trim()       || '';

            results[key] = { units, street, num, coords, source: cityId, floors, entrances, usage };
        }
        console.log(`[GIS] ${cfg.name} → ${Object.keys(results).length} buildings matched polygon`);
        return Object.keys(results).length > 0 ? results : null;
    } catch(e) {
        console.warn(`[GIS] ArcGIS fetch failed for ${cityId}:`, e.message);
        return null;
    }
}

// ── שלוף מ-Overpass (fallback) ─────────────────────────────────
async function fetchBuildingsFromOverpass(polygon) {
    const lngs = polygon.map(c=>c[0]), lats = polygon.map(c=>c[1]);
    const bbox = `${Math.min(...lats)-0.001},${Math.min(...lngs)-0.001},${Math.max(...lats)+0.001},${Math.max(...lngs)+0.001}`;
    const query = `[out:json][timeout:30];(way["building"]["addr:housenumber"](${bbox});relation["building"]["addr:housenumber"](${bbox}););out tags center;`;
    try {
        const r = await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:'data='+encodeURIComponent(query)});
        if(!r.ok) throw new Error('Overpass '+r.status);
        const data = await r.json();
        const results = {};
        for(const el of data.elements) {
            const t = el.tags||{};
            const street = t['addr:street']||t['addr:place']||'';
            const num    = t['addr:housenumber']||'';
            if(!street||!num) continue;
            let center;
            if(el.center) center=[el.center.lon,el.center.lat];
            else if(el.lat&&el.lon) center=[el.lon,el.lat];
            else continue;
            if(!pointInPolygon(center,polygon)) continue;
            const key = `${street} ${num}`;
            let units = parseInt(t['building:flats'])||0;
            if(!units){ const fl=parseInt(t['building:levels']||t['levels'])||0; if(fl>0) units=fl*3; }
            results[key]={ units, street, num, coords:center, source:'osm' };
        }
        return results;
    } catch(e){ console.warn('Overpass failed:',e); return null; }
}

// ── Point-in-polygon ───────────────────────────────────────────
function pointInPolygon([px,py], polygon) {
    let inside=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
        const [xi,yi]=polygon[i],[xj,yj]=polygon[j];
        if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi)) inside=!inside;
    }
    return inside;
}

// ── haversine מרחק ──────────────────────────────────────────────
function haversineM([lng1,lat1],[lng2,lat2]){
    const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ── חפש בניין קרוב ב-db ───────────────────────────────────────
// ── התאמה חכמה של שמות רחוב (מקוצר ↔ מלא) ────────────────────
function findFuzzyBuildingMatch(gisStreet, gisNum) {
    if(!gisStreet || !gisNum) return null;
    const numStr = String(gisNum).trim();
    // חלק את שם הרחוב ל-"מילים" — GIS נותן שם מלא
    const gisWords = gisStreet.trim().split(/\s+/);

    for(const dbKey of Object.keys(db)) {
        if(dbKey==='__BOARDS__'||dbKey==='meta'||dbKey===NO_ADDRESS_KEY||dbKey==='__SETTINGS__') continue;
        // חלץ מספר ורחוב מ-dbKey (פורמט: "שם רחוב מספר")
        const dbParts = dbKey.trim().split(/\s+/);
        const dbNum = dbParts[dbParts.length-1];
        if(dbNum !== numStr) continue; // מספר בית לא תואם — דלג

        const dbStreetWords = dbParts.slice(0, -1);
        // בדוק שכל מילות הDB קיימות בשם ה-GIS (המלא)
        // "שמואל תמיר" ⊆ "שמואל תמיר כצנלסון" → match
        const allWordsMatch = dbStreetWords.every(w => gisWords.includes(w));
        if(allWordsMatch && dbStreetWords.length > 0) return dbKey;
    }
    return null;
}

function findClosestDbBuilding(coords, maxM=60) {
    let best=null,bestD=Infinity;
    for(const k of Object.keys(db)){
        if(k==='__BOARDS__'||k==='meta'||k===NO_ADDRESS_KEY||k==='__SETTINGS__') continue;
        const c=db[k]?.info?.coords; if(!c) continue;
        const d=haversineM(coords,c); if(d<maxM&&d<bestD){bestD=d;best=k;}
    }
    return best;
}

// ── החל נתוני GIS על db — לא דורס VERIFIED/ESTIMATE ───────────
function applyGISUnits(bldgKey, gisUnits, sourceId, extra) {
    if(!db[bldgKey]) return;
    const existing = db[bldgKey].info?.units;
    if(existing?.source==='VERIFIED') return; // אמת — לא נגע
    if(existing?.source==='ESTIMATE' && (!gisUnits||gisUnits<=0)) return; // הערכה שלנו טובה יותר
    const prev = db[bldgKey].info.units || {};
    db[bldgKey].info.units = {
        ...prev,
        source: gisUnits>0 ? 'CITY' : (existing?.source||'CITY'),
        count: gisUnits>0 ? gisUnits : (prev.count||0),
        cityCount: gisUnits,
        citySource: sourceId,
        cityUpdatedAt: Date.now(),
        // שדות בונוס מירושלים
        ...(extra?.floors    ? { floors: extra.floors }       : {}),
        ...(extra?.entrances ? { entrances: extra.entrances } : {}),
        ...(extra?.usage     ? { usage: extra.usage }         : {})
    };
}

// ── עדכן הערכה מינימלית ממספר דירה שהוזן ────────────────────
function ensureMinimumUnits(bldgKey, aptNum) {
    const n=parseInt(aptNum); if(isNaN(n)||n<1) return;
    const ex=db[bldgKey]?.info?.units;
    if(ex?.source==='VERIFIED') return;
    const cur=ex?.count||0;
    if(n>cur) {
        db[bldgKey].info.units = { ...(ex||{}), source:'ESTIMATE', count:n };
    }
}

// ── סריקה ראשית ─────────────────────────────────────────────────
async function startTerritoryUnitsScan() {
    const btn=document.getElementById('btnScanUnits');
    const statusEl=document.getElementById('unitsScanStatus');
    const summaryEl=document.getElementById('unitsScanSummary');
    const summaryText=document.getElementById('unitsScanSummaryText');
    if(btn){btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> סורק...';}
    if(statusEl) statusEl.innerText='מזהה עיר...';

    const polygon=appSettings.territory?.polygon;
    if(!polygon){
        showToast('הגדר תיחום אזור תחילה','warning');
        if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-sync-alt"></i> סרוק דירות';}
        return;
    }

    // זיהוי עיר
    const cityId = await detectCityFromPolygon(polygon);
    unitsEngineState.detectedCityId = cityId;
    const cityName = cityId ? CITIES_GIS_CONFIG[cityId]?.name : 'Overpass OSM';
    if(statusEl) statusEl.innerText = `שולף נתונים מ-${cityName}...`;

    let gisData = null;
    if(cityId && CITIES_GIS_CONFIG[cityId]) {
        gisData = await fetchBuildingsFromArcGIS(cityId, polygon);
    }
    if(!gisData) {
        if(statusEl) statusEl.innerText='Overpass OSM (fallback)...';
        gisData = await fetchBuildingsFromOverpass(polygon);
    }

    if(!gisData || Object.keys(gisData).length===0) {
        showToast('לא נמצאו נתוני בניינים לאזור זה','warning');
        if(statusEl) statusEl.innerText='לא נמצאו נתונים לאזור זה';
        if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-sync-alt"></i> סרוק דירות';}
        return;
    }

    // החל נתונים
    // דיבוג — השווה מפתחות GIS מול db
    const dbKeys = Object.keys(db).filter(k=>k!=='__BOARDS__'&&k!=='meta'&&k!==NO_ADDRESS_KEY&&k!=='__SETTINGS__');
    const gisKeys = Object.keys(gisData);
    console.log('[GIS] db-keys:', dbKeys.slice(0,5));
    console.log('[GIS] gis-keys:', gisKeys.slice(0,5));

    let matched=0, newBuildings=0, fuzzyMatched=0, coordMatched=0;
    for(const [gisKey, gisInfo] of Object.entries(gisData)) {
        // נסה התאמה ישירה
        if(db[gisKey]) {
            applyGISUnits(gisKey, gisInfo.units, gisInfo.source, gisInfo);
            // עדכן קואורדינטות רק אם אין כבר קואורדינטות מדויקות (מ-geocoding)
            if(gisInfo.coords && !db[gisKey].info.coords) db[gisKey].info.coords = gisInfo.coords;
            matched++; continue;
        }
        // התאמה חכמה
        const fuzzyMatch = findFuzzyBuildingMatch(gisInfo.street, gisInfo.num);
        if(fuzzyMatch) {
            applyGISUnits(fuzzyMatch, gisInfo.units, gisInfo.source, gisInfo);
            // עדכן קואורדינטות רק אם אין
            if(gisInfo.coords && !db[fuzzyMatch].info.coords) db[fuzzyMatch].info.coords = gisInfo.coords;
            fuzzyMatched++; matched++; continue;
        }
        // התאמה לפי קואורדינטות
        if(gisInfo.coords) {
            const closest=findClosestDbBuilding(gisInfo.coords,60);
            if(closest){ applyGISUnits(closest,gisInfo.units,gisInfo.source,gisInfo); coordMatched++; matched++; continue; }
        }
        newBuildings++;
    }
    console.log(`[GIS] match breakdown: direct=${matched-fuzzyMatched-coordMatched}, fuzzy=${fuzzyMatched}, coords=${coordMatched}, unmatched=${newBuildings}`);

    // שמור נתונים גולמיים — ללא קואורדינטות מלאות כדי לא לפוצץ localStorage
    const lightCache = {};
    for(const [k,v] of Object.entries(gisData)) {
        lightCache[k] = { units: v.units, street: v.street, num: v.num, source: v.source,
            floors: v.floors, entrances: v.entrances, usage: v.usage,
            coords: v.coords }; // coords בלבד (2 מספרים) — בלי rings
    }
    try {
        appSettings.territory.gisCache = { data: lightCache, source: cityId||'osm', ts: Date.now() };
        appSettings.territory.unitsLastSync = Date.now();
        localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    } catch(e) {
        // localStorage מלא — שמור בלי cache אבל עם timestamp
        console.warn('[GIS] localStorage full, saving without cache:', e.message);
        delete appSettings.territory.gisCache;
        appSettings.territory.unitsLastSync = Date.now();
        localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    }
    unitsEngineState.lastScan = Date.now();
    unitsEngineState.scannedBldgCount = Object.keys(gisData).length;
    saveDB();
    updateCoverageStats();
    updateTerritoryStatsDisplay();
    // עדכן שכבת בניינים על המפה
    try { renderGISBuildingLayer(); } catch(e) {}

    const stats = computeTerritoryStats();
    const msg = `${Object.keys(gisData).length} בניינים מה-GIS — ${matched} תואמו`;
    const statsMsg = stats.totalUnits > 0
        ? `נמצאו ${stats.totalBuildings} בניינים · ${stats.totalUnits} דירות בתחום השליחות!`
        : msg;
    if(statusEl) statusEl.innerText = `עודכן: ${msg}`;
    if(summaryEl){ summaryEl.style.display='block'; summaryText.innerText = statsMsg; }
    showToast(`🏘️ ${statsMsg}`, 'success');
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-sync-alt"></i> סרוק דירות';}
}
window.startTerritoryUnitsScan = startTerritoryUnitsScan;

// ── כיסוי שליחות ─────────────────────────────────────────────
function computeCoverageStats() {
    let totalUnits=0,families=0,verifiedBldgs=0;
    for(const k of Object.keys(db)){
        if(k==='__BOARDS__'||k==='meta'||k===NO_ADDRESS_KEY||k==='__SETTINGS__') continue;
        const bldg=db[k]; if(!bldg?.apts) continue;
        families+=bldg.apts.length;
        const u=bldg.info?.units;
        if(u?.count>0){ totalUnits+=u.count; if(u.source==='VERIFIED') verifiedBldgs++; }
    }
    return { totalUnits, families, verifiedBldgs, pct:totalUnits>0?Math.min(100,Math.round(families/totalUnits*100)):0 };
}

function updateCoverageStats() {
    const s=computeCoverageStats();
    const card=document.getElementById('coverageCard'); if(!card) return;
    if(s.totalUnits===0){card.style.display='none';return;}
    card.style.display='block';
    document.getElementById('coveragePctBig').innerText=s.pct+'%';
    document.getElementById('coverageBarMain').style.width=s.pct+'%';
    document.getElementById('coverageFamilies').innerText=s.families;
    document.getElementById('coverageTotalUnits').innerText=s.totalUnits;
    const vr=document.getElementById('coverageVerifiedRow');
    if(s.verifiedBldgs>0){vr.style.display='block';document.getElementById('coverageVerifiedCount').innerText=s.verifiedBldgs;}
    else vr.style.display='none';
}

// ── מפת קומות — render ─────────────────────────────────────────

/*
  לוגיקת תצוגה:
  1. אם לכל הדירות הרשומות יש מספר — סדרן בקומות (4 דירות לקומה כברירת מחדל)
  2. אם יש נתוני עירייה (count) — צור רשת קומות + סמן הרשומות
  3. דירות ללא מספר — שורה נפרדת "ללא מספר דירה"
  4. גרירה: אפשר לגרור דירה רשומה לשנות קומה (= לשנות apt.num)
*/

let draggedAptIdx = null; // index ב-db[currentBldg].apts

function renderFloorPlan(bldgKey) {
    const bldg = db[bldgKey]; if(!bldg) return;
    const ui = bldg.info?.units;
    const totalUnits = ui?.count || 0;
    const source = ui?.source || null;

    // ── Header stats ──
    document.getElementById('floorsRegistered').innerText = bldg.apts.length;
    if(totalUnits>0) {
        const src=UNIT_SRC[source]||UNIT_SRC.CITY;
        document.getElementById('floorsTotalUnits').innerText=totalUnits;
        document.getElementById('floorsTotalUnits').style.color=src.text;
        const badge=document.getElementById('floorsSourceBadge');
        badge.style.display='inline'; badge.innerText=src.icon+' '+src.label;
        badge.style.background=src.color+'25'; badge.style.color=src.text;
        badge.style.border=`1px solid ${src.color}80`;
    } else {
        document.getElementById('floorsTotalUnits').innerText='?';
    }
    // Coverage bar
    if(totalUnits>0){
        const pct=Math.min(100,Math.round(bldg.apts.length/totalUnits*100));
        document.getElementById('floorsCovBar').style.width=pct+'%';
    }

    // ── Separate apts with/without num ──
    const withNum=[], withoutNum=[];
    bldg.apts.forEach((a,i)=>{
        const n=parseInt(a.num);
        if(!isNaN(n)&&n>0) withNum.push({apt:a,idx:i,num:n});
        else withoutNum.push({apt:a,idx:i});
    });

    // ── Determine grid size ──
    const maxNum=Math.max(totalUnits, ...(withNum.map(x=>x.num)), 0);
    const COLS=4; // דירות לקומה
    const numFloors=maxNum>0?Math.ceil(maxNum/COLS):0;

    const container=document.getElementById('floorPlanContainer');
    let html='';

    // ── Floor rows (top = highest) ──
    if(numFloors>0){
        for(let fl=numFloors;fl>=1;fl--){
            const firstUnit=(fl-1)*COLS+1;
            html+=`<div class="floor-row" data-floor="${fl}" 
                style="display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:8px;background:var(--bg-body);border:1px dashed var(--border-light);transition:background 0.15s;"
                ondragover="floorDragOver(event,${fl})" ondrop="floorDrop(event,${fl})" ondragleave="this.style.background=''">
                <div style="font-size:10px;color:var(--text-muted);font-weight:700;min-width:32px;text-align:center;flex-shrink:0;">קומה<br>${fl}</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;flex:1;">`;
            for(let u=firstUnit;u<firstUnit+COLS;u++){
                if(u>maxNum&&!withNum.some(x=>x.num===u)) continue;
                const aptEntry=withNum.find(x=>x.num===u);
                html+=renderUnitCell(u,aptEntry||null,bldgKey);
            }
            html+=`</div></div>`;
        }
    }

    // ── No-number apts ──
    if(withoutNum.length>0){
        html+=`<div class="floor-row" style="display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:8px;background:rgba(245,158,11,0.05);border:1px dashed #f59e0b80;">
            <div style="font-size:10px;color:#b45309;font-weight:700;min-width:32px;text-align:center;flex-shrink:0;">ללא<br>מספר</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;flex:1;">`;
        withoutNum.forEach(({apt,idx})=>{
            html+=`<div class="unit-cell unit-no-num" 
                draggable="true"
                ondragstart="unitDragStart(event,${idx})"
                ondragend="unitDragEnd(event)"
                onclick="openClientCard(${idx})"
                title="${escapeHTML(apt.name||'(ללא שם)')}"
                style="width:54px;height:38px;border-radius:6px;border:1.5px solid #f59e0b;background:rgba(245,158,11,0.12);display:flex;align-items:center;justify-content:center;cursor:grab;flex-direction:column;position:relative;overflow:hidden;transition:transform 0.15s,box-shadow 0.15s;"
                onmouseenter="this.style.transform='scale(1.08)';this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
                onmouseleave="this.style.transform='';this.style.boxShadow=''">
                <div style="font-size:9px;font-weight:700;color:#92400e;line-height:1.2;text-align:center;max-width:50px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(apt.name||'—')}</div>
                <div style="width:8px;height:2px;background:#f59e0b;border-radius:2px;margin-top:2px;"></div>
            </div>`;
        });
        html+=`</div></div>`;
    }

    if(!html){
        html=`<div style="text-align:center;padding:30px;color:var(--text-muted);">
            <i class="fas fa-building" style="font-size:30px;opacity:0.3;display:block;margin-bottom:8px;"></i>
            אין משפחות רשומות.<br>
            <button onclick="quickAddAptModal()" class="btn btn-outline" style="width:auto;margin-top:10px;padding:6px 14px;font-size:13px;">+ הוסף משפחה</button>
        </div>`;
    }
    container.innerHTML=html;
}

function renderUnitCell(unitNum, aptEntry, bldgKey) {
    if(aptEntry) {
        const {apt,idx}=aptEntry;
        const col=getStatusColor(apt);
        return `<div class="unit-cell unit-occupied"
            draggable="true"
            ondragstart="unitDragStart(event,${idx})"
            ondragend="unitDragEnd(event)"
            onclick="openClientCard(${idx})"
            title="דירה ${unitNum}: ${escapeHTML(apt.name||'(ללא שם)')}"
            style="width:54px;height:38px;border-radius:6px;border:1.5px solid ${col};background:${col}22;display:flex;align-items:center;justify-content:center;cursor:grab;flex-direction:column;transition:transform 0.15s,box-shadow 0.15s;position:relative;"
            onmouseenter="this.style.transform='scale(1.1)';this.style.boxShadow='0 4px 12px rgba(0,0,0,0.18)'"
            onmouseleave="this.style.transform='';this.style.boxShadow=''">
            <div style="font-size:9px;font-weight:700;color:${col};line-height:1;">${unitNum}</div>
            <div style="font-size:8px;color:${col};opacity:0.85;max-width:50px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;">${escapeHTML((apt.name||'').split(' ')[0]||'')}</div>
            <div style="position:absolute;top:2px;left:2px;width:6px;height:6px;border-radius:50%;background:${col};"></div>
        </div>`;
    } else {
        return `<div class="unit-cell unit-empty"
            ondragover="event.preventDefault()"
            ondrop="emptyUnitDrop(event,${unitNum})"
            onclick="addFamilyToUnit(${unitNum})"
            title="דירה ${unitNum} — ריקה (לחץ להוספת משפחה)"
            style="width:54px;height:38px;border-radius:6px;border:1.5px solid var(--border-light);background:var(--bg-body);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);font-size:11px;font-weight:600;transition:background 0.15s,border-color 0.15s;"
            onmouseenter="this.style.background='rgba(59,130,246,0.06)';this.style.borderColor='var(--accent)'"
            onmouseleave="this.style.background='var(--bg-body)';this.style.borderColor='var(--border-light)'">
            ${unitNum}
        </div>`;
    }
}

// ── Drag & Drop ────────────────────────────────────────────────
window.unitDragStart = (e, aptIdx) => {
    draggedAptIdx=aptIdx;
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',String(aptIdx));
    setTimeout(()=>e.target.style.opacity='0.4',0);
};
window.unitDragEnd = (e) => {
    e.target.style.opacity='';
    draggedAptIdx=null;
    document.querySelectorAll('.floor-row').forEach(r=>r.style.background='');
};
window.floorDragOver = (e, floor) => {
    e.preventDefault();
    e.currentTarget.style.background='rgba(59,130,246,0.08)';
};
window.floorDrop = (e, floor) => {
    e.preventDefault();
    e.currentTarget.style.background='';
    if(draggedAptIdx===null) return;
    const apt=db[currentBldg].apts[draggedAptIdx];
    if(!apt) return;
    // Assign first available unit in that floor
    const COLS=4;
    const firstUnit=(floor-1)*COLS+1;
    const usedNums=new Set(db[currentBldg].apts.map(a=>parseInt(a.num)).filter(n=>!isNaN(n)));
    let newNum=firstUnit;
    while(usedNums.has(newNum)&&newNum<firstUnit+COLS) newNum++;
    apt.num=String(newNum);
    ensureMinimumUnits(currentBldg,apt.num);
    saveDB();
    renderFloorPlan(currentBldg);
    updateCoverageStats();
};
window.emptyUnitDrop = (e, unitNum) => {
    e.preventDefault();
    if(draggedAptIdx===null) return;
    const apt=db[currentBldg].apts[draggedAptIdx];
    if(!apt) return;
    const wasNum=apt.num;
    apt.num=String(unitNum);
    ensureMinimumUnits(currentBldg,apt.num);
    saveDB(); renderFloorPlan(currentBldg); updateCoverageStats();
};
window.addFamilyToUnit = (unitNum) => {
    showCustomDialog({title:`הוסף משפחה לדירה ${unitNum}`,message:'לפתוח כרטיס חדש?',showCancel:true}).then(ok=>{
        if(!ok) return;
        db[currentBldg].apts.push({num:String(unitNum),name:'',style:appSettings.styles[0],boards:{},tags:[],childrenList:[],interactions:[],donations:[],tasks:[],customFields:{}});
        ensureMinimumUnits(currentBldg,unitNum);
        isCreatingNew=true;
        document.getElementById('buildingModal').style.display='none';
        openClientCard(db[currentBldg].apts.length-1);
    });
};

// ── עורך מספר דירות ───────────────────────────────────────────
window.openUnitsEditor = () => {
    const ui=db[currentBldg]?.info?.units;
    document.getElementById('unitsEditorBldgName').innerText=currentBldg;
    const src=ui?UNIT_SRC[ui.source]:null;
    document.getElementById('unitsEditorCurrentInfo').innerHTML=ui
        ?`מקור: <strong style="color:${src?.text||'#64748b'}">${src?.icon||''} ${src?.label||ui.source}</strong> — <strong>${ui.count}</strong> דירות${ui.cityCount?`<br><small>נתוני עירייה: ${ui.cityCount}</small>`:''}` 
        :'אין נתונים — לא ידוע מספר הדירות';
    document.getElementById('unitsEditorInput').value=ui?.count||'';
    document.getElementById('unitsEditorModal').style.display='flex';
    setTimeout(()=>document.getElementById('unitsEditorInput').focus(),80);
};
window.saveManualUnitsCount = () => {
    const v=parseInt(document.getElementById('unitsEditorInput').value);
    if(isNaN(v)||v<1){showToast('הזן מספר תקין','warning');return;}
    const ex=db[currentBldg]?.info?.units||{};
    if(!db[currentBldg].info) db[currentBldg].info={};
    db[currentBldg].info.units={...ex,source:'VERIFIED',count:v,verifiedAt:Date.now()};
    saveDB();
    document.getElementById('unitsEditorModal').style.display='none';
    renderFloorPlan(currentBldg);
    updateCoverageStats();
    showToast(`✓ ${v} דירות אומתו לבניין`,'success');
};

// ── toggle sections בהגדרות (במקום details/summary שגורם לבאג) ──
window.toggleSettingsSection = (bodyId, chevronId) => {
    const body = document.getElementById(bodyId);
    const chevron = document.getElementById(chevronId);
    if(!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if(chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
};

// ── toggle תצוגת בניין: רשימה / קומות ──────────────────────────
let _currentBldgView = 'list'; // 'list' | 'floors'
window.setBldgView = (view) => {
    _currentBldgView = view;
    const listContainer   = document.getElementById('bldgViewListContainer');
    const floorsContainer = document.getElementById('bldgViewFloorsContainer');
    const btnList   = document.getElementById('bldgViewList');
    const btnFloors = document.getElementById('bldgViewFloors');
    if(!listContainer) return;
    if(view === 'list') {
        listContainer.style.display   = 'block';
        floorsContainer.style.display = 'none';
        btnList.style.background   = 'var(--accent)'; btnList.style.color   = 'white';
        btnFloors.style.background = 'transparent';   btnFloors.style.color = 'var(--text-muted)';
    } else {
        listContainer.style.display   = 'none';
        floorsContainer.style.display = 'block';
        btnList.style.background   = 'transparent'; btnList.style.color   = 'var(--text-muted)';
        btnFloors.style.background = 'var(--accent)'; btnFloors.style.color = 'white';
        renderFloorPlan(currentBldg);
    }
};

// ── שמירת סוג בניין (מגורים / מסחרי / לא רלוונטי) ──────────────
window.saveBldgRelevance = (value) => {
    if(!db[currentBldg]) return;
    db[currentBldg].info.relevance = value;
    saveDB();
    renderGISBuildingLayer(); // עדכן צבע על המפה
    showToast(value==='irrelevant'?'סומן כלא רלוונטי':value==='commercial'?'סומן כמסחרי':'סומן כמגורים','success');
};

// ── שכבת GIS על המפה — צביעת בניינים לפי סטטוס ─────────────────
function renderGISBuildingLayer() {
    if(!map || !map.isStyleLoaded()) return;

    const features = [];
    const gisCache = appSettings.territory?.gisCache?.data || {};

    // ── שלב 1: כל הבניינים מה-GIS cache (אפילו בלי כרטיס ב-db) ──
    for(const [gisKey, gisInfo] of Object.entries(gisCache)) {
        if(!gisInfo.coords) continue;
        // בדוק אם יש כרטיס ב-db (התאמה ישירה או fuzzy)
        const dbKey = db[gisKey] ? gisKey : findFuzzyBuildingMatch(gisInfo.street, gisInfo.num);
        const bldg = dbKey ? db[dbKey] : null;
        const units = bldg?.info?.units;
        const relevance = bldg?.info?.relevance || 'residential';
        const families = bldg?.apts?.length || 0;

        let status;
        if(!bldg) {
            status = 'gis-only'; // בניין שה-GIS מכיר אבל אין לו כרטיס עדיין
        } else if(relevance === 'irrelevant') status = 'irrelevant';
        else if(relevance === 'commercial') status = 'commercial';
        else if(units?.source === 'VERIFIED') status = 'verified';
        else if(units?.source === 'CITY') status = 'city';
        else if(units?.source === 'ESTIMATE') status = 'estimate';
        else status = 'registered'; // יש כרטיס אבל בלי נתוני GIS

        features.push({
            type: 'Feature',
            properties: {
                key: dbKey || gisKey,
                gisKey,
                status,
                units: gisInfo.units || units?.count || 0,
                families,
                hasCard: !!bldg
            },
            geometry: { type: 'Point', coordinates: gisInfo.coords }
        });
    }

    // ── שלב 2: בניינים ב-db עם קואורדינטות שאולי לא ב-GIS ──
    for(const [key, bldg] of Object.entries(db)) {
        if(key==='__BOARDS__'||key==='meta'||key===NO_ADDRESS_KEY||key==='__SETTINGS__') continue;
        const coords = bldg.info?.coords;
        if(!coords) continue;
        // בדוק שלא כבר הוספנו אותו מה-GIS
        const alreadyAdded = features.some(f => f.properties.key === key);
        if(alreadyAdded) continue;
        const units = bldg.info?.units;
        const relevance = bldg.info?.relevance || 'residential';
        let status = relevance === 'irrelevant' ? 'irrelevant'
            : relevance === 'commercial' ? 'commercial'
            : units?.source === 'VERIFIED' ? 'verified'
            : units?.source === 'CITY' ? 'city'
            : units?.source === 'ESTIMATE' ? 'estimate'
            : 'registered';
        features.push({
            type: 'Feature',
            properties: { key, gisKey: key, status, units: units?.count||0, families: bldg.apts?.length||0, hasCard: true },
            geometry: { type: 'Point', coordinates: coords }
        });
    }

    const geojson = { type: 'FeatureCollection', features };
    const sourceId = 'gis-buildings-source';

    if(map.getSource(sourceId)) {
        map.getSource(sourceId).setData(geojson);
        return;
    }

    map.addSource(sourceId, { type: 'geojson', data: geojson });

    // שכבת עיגול
    map.addLayer({
        id: 'gis-buildings-layer', type: 'circle', source: sourceId,
        paint: {
            'circle-radius': ['case', ['get','hasCard'], 10, 7],
            'circle-color': [
                'match', ['get','status'],
                'verified',   '#10b981', // ירוק — מאומת ידנית
                'city',       '#6b7280', // אפור — נתוני עירייה
                'estimate',   '#f59e0b', // צהוב — הערכה
                'irrelevant', '#ef4444', // אדום — לא רלוונטי
                'commercial', '#8b5cf6', // סגול — מסחרי
                'registered', '#3b82f6', // כחול — רשום ללא GIS
                '#d1d5db'                // בהיר — GIS בלבד, ללא כרטיס
            ],
            'circle-opacity': ['case', ['get','hasCard'], 0.9, 0.5],
            'circle-stroke-width': ['case', ['get','hasCard'], 2, 1],
            'circle-stroke-color': 'white',
            'circle-pitch-alignment': 'map'
        }
    }, 'waterway-label');

    // מספר דירות / משפחות בתוך העיגול
    map.addLayer({
        id: 'gis-buildings-label', type: 'symbol', source: sourceId,
        layout: {
            'text-field': ['case',
                ['>', ['get','families'], 0], ['to-string',['get','families']],
                ['>', ['get','units'], 0], ['to-string',['get','units']],
                ''
            ],
            'text-size': 9,
            'text-font': ['Open Sans Bold','Arial Unicode MS Bold'],
            'text-anchor': 'center'
        },
        paint: { 'text-color': 'white' }
    });

    map.on('mouseenter', 'gis-buildings-layer', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        // הצג tooltip עם מידע על הבניין
        const props = e.features[0].properties;
        const units = props.units > 0 ? `${props.units} דירות` : '';
        const families = props.families > 0 ? `${props.families} משפחות` : '';
        const info = [units, families].filter(Boolean).join(' · ');
        if(info) {
            hoverPopup && hoverPopup.remove();
            new mapboxgl.Popup({ closeButton:false, closeOnClick:false, offset:12 })
                .setLngLat(e.features[0].geometry.coordinates)
                .setHTML(`<div style="font-size:12px;font-weight:600;">${props.gisKey||props.key}<br><span style="color:#64748b;">${info}</span></div>`)
                .addTo(map);
        }
    });
    map.on('mouseleave', 'gis-buildings-layer', () => {
        map.getCanvas().style.cursor = '';
        hoverPopup && hoverPopup.remove();
    });
}

// ── סטטיסטיקת שליחות (בניינים + דירות) ─────────────────────────
function computeTerritoryStats() {
    let totalBuildings = 0, totalUnits = 0, verifiedUnits = 0;
    for(const [k,v] of Object.entries(db)) {
        if(k==='__BOARDS__'||k==='meta'||k===NO_ADDRESS_KEY||k==='__SETTINGS__') continue;
        if(v?.info?.relevance === 'irrelevant') continue;
        totalBuildings++;
        const u = v.info?.units;
        if(u?.count > 0) {
            totalUnits += u.count;
            if(u.source === 'VERIFIED') verifiedUnits += u.count;
        }
    }
    return { totalBuildings, totalUnits, verifiedUnits };
}

function updateTerritoryStatsDisplay() {
    const stats = computeTerritoryStats();
    // עדכן בהגדרות
    const statsEl = document.getElementById('settingsTerritoryStats');
    if(statsEl && stats.totalBuildings > 0) {
        statsEl.style.display = 'block';
        statsEl.innerHTML = `
            <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:8px;">
                <div style="text-align:center;">
                    <div style="font-size:22px; font-weight:900; color:var(--accent);">${stats.totalBuildings}</div>
                    <div style="font-size:11px; color:var(--text-muted);">בניינים</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:22px; font-weight:900; color:#10b981;">${stats.totalUnits}</div>
                    <div style="font-size:11px; color:var(--text-muted);">דירות בתחום</div>
                </div>
                ${stats.verifiedUnits > 0 ? `<div style="text-align:center;">
                    <div style="font-size:22px; font-weight:900; color:#6366f1;">${stats.verifiedUnits}</div>
                    <div style="font-size:11px; color:var(--text-muted);">מאומתות</div>
                </div>` : ''}
            </div>`;
    }
    // עדכן אחרי סריקה ב-toast
    return stats;
}

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
    if(proceed) { localStorage.removeItem('gdrive_session'); location.reload(); } 
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
        // Token still good — just run
        cb();
    } else {
        // Token expired/missing — save pending action and redirect to Google
        showToast('מחדש חיבור לענן...', 'warning');
        try { localStorage.setItem('community_data_final', JSON.stringify(db)); } catch(e) {}
        // Redirect to Google auth — on return, syncWithDrive will restore data
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
    renderGISBuildingLayer();
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

// ── Auto-refresh token before it expires ──
function scheduleTokenRefresh() {
    const session = JSON.parse(localStorage.getItem('gdrive_session') || 'null');
    if (!session) return;
    const msUntilExpiry = session.expiresAt - Date.now();
    // Warn user 3 minutes before expiry so they can save work
    const warnIn = Math.max(msUntilExpiry - 180000, 10000);
    setTimeout(() => {
        if (!accessToken) return;
        setSyncStatus('error', 'עוד מעט יפוג — שמור!');
        showToast('חיבור Google יפוג בעוד 3 דקות — שמור עבודה ורענן את העמוד', 'warning');
    }, warnIn);
    // Hard expiry — clear token and show re-auth
    const expireIn = Math.max(msUntilExpiry, 10000);
    setTimeout(() => {
        localStorage.removeItem('gdrive_session');
        accessToken = null;
        setSyncStatus('error', 'פג תוקף');
        const row = document.querySelector('.gdrive-sync-row');
        if (row) row.innerHTML = '<button class="btn btn-primary" style="width:100%;font-size:14px;" onclick="handleGoogleLogin()"><i class="fab fa-google" style="margin-left:6px;"></i>התחבר מחדש לענן</button>';
    }, expireIn);
}

async function syncWithDrive(forcePull = false) {
    setSyncStatus('wait', 'שואב...');
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='community_data_final.json'&spaces=drive`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                // Token expired or revoked — stop all retries, clear session, show re-auth
                localStorage.removeItem('gdrive_session');
                accessToken = null;
                setSyncStatus('error', 'פג תוקף — יש להתחבר מחדש');
                // Make sure splash is hidden
                const splash = document.getElementById('splash-screen');
                if (splash) { splash.style.opacity = '0'; setTimeout(() => { splash.style.display = 'none'; }, 600); }
                // Show re-auth button in sidebar (non-blocking)
                showToast('חיבור Google פג — לחץ "התחבר מחדש" בתפריט', 'warning');
                setSyncStatus('error', 'לחץ התחבר מחדש');
                // Update sync button in sidebar to a prominent re-auth button
                const syncRow = document.querySelector('.gdrive-sync-row');
                if (syncRow) {
                    syncRow.innerHTML = '<button class="btn btn-primary" style="width:100%;font-size:14px;" onclick="handleGoogleLogin()"><i class="fab fa-google" style="margin-left:6px;"></i>התחבר מחדש לענן</button>';
                }
                return; // STOP — do not throw, do not retry
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
            const create = await fetch('https://www.googleapis.com/drive/v3/files', { method:'POST', headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'}, body:JSON.stringify({name:'community_data_final.json',mimeType:'application/json'}) });
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
    if (_fieldUpdatesSessionHandled) return; // כבר הוצג בסשן זה — לא מציג שוב
    try {
        const q = encodeURIComponent("name contains 'mobile_update_' and trashed = false");
        const listRes = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,createdTime)&orderBy=createdTime`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!listRes.ok) return;
        const { files } = await listRes.json();
        if (!files || files.length === 0) return;

        // מזהי events שכבר עובדו בעבר
        if (!appSettings.appliedEventIds) appSettings.appliedEventIds = {};

        // טען את תוכן כל הקבצים
        pendingFieldUpdateFiles = [];
        for (const file of files) {
            try {
                const contentRes = await fetch(
                    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                if (!contentRes.ok) continue;
                const payload = await contentRes.json();

                // סנן events שכבר עובדו
                const allEvents = payload.events || [];
                const newEvents = allEvents.filter(ev => {
                    const evId = ev.id || `${ev.type}_${ev.bldg}_${ev.aptName}_${ev.timestamp}`;
                    return !appSettings.appliedEventIds[evId];
                });

                // אם כל ה-events בקובץ כבר עובדו — מחק את הקובץ מ-Drive
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

        if (pendingFieldUpdateFiles.length === 0) return;

        const totalEvents = pendingFieldUpdateFiles.reduce((s, f) => s + f.events.length, 0);
        showFieldUpdatesDialog(pendingFieldUpdateFiles, totalEvents);

    } catch (e) {
        console.error('mergeOutboxUpdates error:', e);
    }
}

// ── הצגת חלון עדכונים מהשטח ──
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
        case 'add_general_task': return { icon:'fa-thumbtack', color:'var(--warning)', desc:`משימה כללית חדשה` };
        default:               return { icon:'fa-sync',    color:'var(--text-muted)', desc:`עדכון — ${nameLabel}` };
    }
}

function getEventDetails(ev) {
    let lines = [];
    if (ev.type === 'visit_log' && ev.payload) {
        if (ev.payload.note) lines.push(`📝 ${escapeHTML(ev.payload.note)}`);
        if (ev.payload.result) lines.push(`תוצאה: ${escapeHTML(ev.payload.result)}`);
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

    // מחק מ-Drive קבצים שכל ה-events שלהם עובדו (נבחרו או היו כבר מעובדים)
    const fullyAppliedFiles = pendingFieldUpdateFiles.filter(f => {
        const fileEvents = allEvents.filter(ev => ev._fileId === f.fileId);
        return fileEvents.every((ev, localIdx) => {
            const globalIdx = allEvents.indexOf(ev);
            return selectedIndices.has(globalIdx);
        });
    });

    for (const file of fullyAppliedFiles) {
        await trashDriveFile(file.fileId);
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

/**
 * מחיל event בודד מאפליקציית השטח על ה-db.
 * סכמת event:
 * {
 *   type: 'task_done' | 'task_undone' | 'visit_log' | 'call_log' | 'stage_change' | 'quick_status' | 'edit_family' | 'delete_family' | 'add_family_task' | 'contact_update' | 'new_family',
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
    if (!ev || !ev.type || !ev.bldg) return false;
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
            const task = (apt.tasks || []).find(t => t.text === ev.payload?.taskText && !t.done);
            if (task) { task.done = true; task.doneAt = ts; }
            break;
        }
        case 'task_undone': {
            const task = typeof ev.taskIdx === 'number' ? (apt.tasks || [])[ev.taskIdx] : null;
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
            // מזג את כל השדות מה-payload, מלבד שדות מערך (tasks, interactions, etc.)
            if (ev.payload) {
                const protectedKeys = ['tasks','interactions','history','donations','boards','tags','childrenList','customFields'];
                Object.keys(ev.payload).forEach(k => {
                    if (!protectedKeys.includes(k)) apt[k] = ev.payload[k];
                });
            }
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
        case 'add_general_task': {
            if (!db.meta.generalTasks) db.meta.generalTasks = [];
            db.meta.generalTasks.push({
                text: ev.payload?.text || '',
                date: ev.payload?.date || '',
                done: false
            });
            apt.updatedAt = Date.now();
            return true; // יציאה מוקדמת — אין apt לעדכן
        }
        default:
            console.warn('applyOutboxEvent: unknown type', ev.type);
            return false;
    }

    apt.updatedAt = Date.now();
    return true;
}

// ── Wrapper for manual sync button — re-auths if token expired ──
window.manualSync = async function() {
    const session = JSON.parse(localStorage.getItem('gdrive_session') || 'null');
    const tokenValid = session && session.token && session.expiresAt > Date.now();
    if (!tokenValid || !accessToken) {
        // Token expired — redirect to Google login (no popup)
        showToast('מחדש חיבור...', 'info');
        window.handleGoogleLogin();
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
    // desktop tabs (null-safe)
    document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
    const dtab = document.getElementById('tab-' + viewName);
    if (dtab) dtab.classList.add('active');

    // body view class — CSS uses this to show/hide elements per view
    document.body.classList.remove('view-map','view-table','view-kanban','view-tasks','view-comm');
    document.body.classList.add('view-' + viewName);

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
};;

// ── Haptic ──
window.haptic = function(type) {
    if (!navigator.vibrate) return;
    ({light:()=>navigator.vibrate(28), medium:()=>navigator.vibrate(50),
      success:()=>navigator.vibrate([25,35,25]), error:()=>navigator.vibrate([55,30,55])
    }[type] || (()=>navigator.vibrate(28)))();
};


// ── FAB Speed Dial removed (mobile only) ──

// ── Desktop FAB ──────────────────────────────────────────────
window.toggleDesktopFab = function() {
    const fab    = document.getElementById('desktopFab');
    const dial   = document.getElementById('desktopFabDial');
    const backdrop = document.getElementById('desktopFabBackdrop');
    const isOpen = dial.classList.contains('open');
    if (isOpen) {
        closeDesktopFab();
    } else {
        dial.classList.add('open');
        fab.classList.add('open');
        backdrop.style.display = 'block';
    }
};

window.closeDesktopFab = function() {
    document.getElementById('desktopFab').classList.remove('open');
    document.getElementById('desktopFabDial').classList.remove('open');
    document.getElementById('desktopFabBackdrop').style.display = 'none';
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

    // GIS status in info tab
    const gisStatusEl = document.getElementById('bldgGisStatus');
    if(gisStatusEl) {
        const u = b.info?.units;
        if(u) {
            const src = UNIT_SRC[u.source] || {};
            gisStatusEl.innerHTML = `${src.icon||''} ${src.label||u.source} — <strong>${u.count||0}</strong> דירות${u.floors?` · <strong>${u.floors}</strong> קומות`:''}${u.entrances?` · <strong>${u.entrances}</strong> כניסות`:''}${u.usage&&u.usage.trim()?` · ${u.usage.trim()}`:''}`;
        } else { gisStatusEl.innerText = 'לא נסרק עדיין'; }
    }
    // Relevance radio
    const rel = b.info?.relevance || 'residential';
    const relRadio = document.querySelector(`input[name="bldgRelevance"][value="${rel}"]`);
    if(relRadio) relRadio.checked = true;

    // Reset to list view
    setBldgView('list');
    switchBldgTab('apts'); document.getElementById('buildingModal').style.display='flex';
    renderFloorPlan(currentBldg);
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
    if(a.num) ensureMinimumUnits(currentBldg, a.num);
    isDirty=false; isCreatingNew=false; saveDB(); if(window.haptic) haptic('success'); document.getElementById('clientModal').style.display='none'; showToast("עודכן בהצלחה! " + getRandomCompliment(), "success");
    updateCoverageStats();
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
         actionsSpan.innerHTML = `<button class="btn-icon" onclick="editCurrentBoard()"><i class="fas fa-cog"></i> ערוך עמודות</button> <span class="tag-badge" style="background:#e2e8f0; color:#64748b; border:none; margin-right:10px;"><i class="fas fa-lock"></i> מוגן</span>`;
    } else if(activeBoard.archived) {
         actionsSpan.innerHTML = `<span class="tag-badge" style="background:rgba(239,68,68,0.1); color:var(--danger); border:none; margin-left:10px;"><i class="fas fa-archive"></i> בארכיון</span><button class="btn-icon" onclick="toggleBoardArchive('${activeBoard.id}')" title="שחזר פרויקט"><i class="fas fa-unlock"></i> שחזר</button><button class="btn-icon" style="color:var(--danger);" onclick="deleteBoard('${activeBoard.id}')" title="מחק פרויקט"><i class="fas fa-trash"></i></button>`;
    } else {
         actionsSpan.innerHTML = `<button class="btn-icon" onclick="editCurrentBoard()"><i class="fas fa-cog"></i> ערוך עמודות</button><button class="btn-icon" onclick="toggleBoardArchive('${activeBoard.id}')" title="נעל והעבר לארכיון"><i class="fas fa-archive"></i> לארכיון</button><button class="btn-icon" style="color:var(--danger);" onclick="deleteBoard('${activeBoard.id}')" title="מחק פרויקט"><i class="fas fa-trash"></i></button>`;
    }

    const c = document.getElementById('kanban-board-scroll');
    c.innerHTML = '';
    if(!activeBoard) return;

    let arr = filteredRes || [];
    if(!filteredRes) Object.keys(db).forEach(b=>{ if(b!=='__BOARDS__' && b!=='__SETTINGS__' && b!=='meta' && db[b] && db[b].apts) db[b].apts.forEach((a,i)=>arr.push({bldg:b,idx:i,apt:a})) });

    // ── DESKTOP: original columns ──
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

    c.querySelectorAll('.kanban-card').forEach(cardEl => {
        const encBldg = cardEl.getAttribute('data-enc-bldg');
        const idx = cardEl.getAttribute('data-idx');
        if(encBldg !== null && idx !== null) initTouchDrag(cardEl, encBldg, parseInt(idx));
    });
};

// Stage picker for mobile kanban
window.openStagePicker = function(encBldg, idx, boardId, currentStage) {
    const bldg = decodeURIComponent(encBldg);
    const board = db.__BOARDS__.find(b => b.id === boardId);
    if (!board) return;

    const list = document.getElementById('stagePickerList');
    const modal = document.getElementById('stagePickerModal');
    if (!list || !modal) return;

    list.innerHTML = board.columns.map(stage => `
        <button class="stage-picker-btn ${stage === currentStage ? 'current' : ''}"
            onclick="moveToStage('${encBldg}', ${idx}, '${boardId}', '${escapeHTML(stage)}')">
            ${stage === currentStage ? '<i class="fas fa-check" style="margin-left:8px; color:var(--accent);"></i>' : ''}
            ${escapeHTML(stage)}
        </button>
    `).join('');

    modal.style.display = 'flex';
};

window.moveToStage = function(encBldg, idx, boardId, stage) {
    const bldg = decodeURIComponent(encBldg);
    if (!db[bldg] || !db[bldg].apts[idx]) return;
    if (!db[bldg].apts[idx].boards) db[bldg].apts[idx].boards = {};
    db[bldg].apts[idx].boards[boardId] = stage;
    saveDB();
    showToast('הועבר ל-' + stage, 'success');
    if (window.haptic) haptic('medium');
    document.getElementById('stagePickerModal').style.display = 'none';
    renderKanbanView();
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

    let arr = filteredRes || [];
    if (!filteredRes) {
        Object.keys(db).forEach(b => {
            if (b === '__BOARDS__' || b === '__SETTINGS__' || b === 'meta') return;
            if (!db[b] || !db[b].apts) return;
            db[b].apts.forEach((a, i) => arr.push({ bldg: b, idx: i, apt: a }));
        });
    }

    // sort
    arr.sort((itemA, itemB) => {
        const a = itemA.apt, b = itemB.apt;
        if (window.customSmartSort) {
            const getLatestDate = (apt, type) => {
                const logs = (apt.interactions || []).filter(i => i.type === type);
                return logs.length > 0 ? new Date(Math.max(...logs.map(l => new Date(l.date)))) : new Date(0);
            };
            const typeMap = { 'last_call': 'שיחה', 'last_visit': 'ביקור' };
            return getLatestDate(b, typeMap[window.customSmartSort]) - getLatestDate(a, typeMap[window.customSmartSort]);
        }
        if (window.tableSort && window.tableSort.column) {
            let valA = '', valB = '';
            const col = window.tableSort.column;
            if (col === 'name') { valA = a.name || ''; valB = b.name || ''; }
            else if (col === 'address') { valA = itemA.bldg === NO_ADDRESS_KEY ? '' : itemA.bldg; valB = itemB.bldg === NO_ADDRESS_KEY ? '' : itemB.bldg; }
            else if (col === 'date') {
                valA = (a.interactions && a.interactions.length > 0) ? [...a.interactions].sort((x,y)=>new Date(y.date)-new Date(x.date))[0].date : '';
                valB = (b.interactions && b.interactions.length > 0) ? [...b.interactions].sort((x,y)=>new Date(y.date)-new Date(x.date))[0].date : '';
            }
            else if (col === 'father') { valA = a.father || ''; valB = b.father || ''; }
            else if (col === 'mother') { valA = a.mother || ''; valB = b.mother || ''; }
            else if (col === 'style') { valA = a.style || ''; valB = b.style || ''; }
            if (valA < valB) return window.tableSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return window.tableSort.direction === 'asc' ? 1 : -1;
        }
        return 0;
    });

    // ── DESKTOP: original table view ──
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

    let theadHtml = `<th style="width:30px;"><input type="checkbox" id="bulkSelectAll" onchange="toggleAllBulk(this)"></th>`;
    allTableCols.forEach(col => {
        if(appSettings.visibleColumns.includes(col.id)) {
            let sortHtml = col.sortable ? sortIcon(col.defaultSort || col.id) : '';
            let clickHtml = col.sortable ? `onclick="sortByColumn('${col.defaultSort || col.id}')" style="cursor:pointer; user-select:none; white-space:nowrap;"` : `style="white-space:nowrap;"`;
            theadHtml += `<th ${clickHtml}>${escapeHTML(col.label)} ${sortHtml}</th>`;
        }
    });

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
        const safeStyle = a.style
            ? `<span class="tag-badge" style="background:${getColorForString(a.style,'style')}20; color:${getColorForString(a.style,'style')}; border-color:${getColorForString(a.style,'style')}50;">${escapeHTML(a.style)}</span>`
            : '<span style="color:var(--text-muted);font-size:12px;">-</span>';

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
// toggleMobileMenu removed — desktop-only sidebar is always visible

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

    // ── Initialize shlichut area section ──
    if(appSettings.missionName) {
        const mn = document.getElementById('settingsMissionName');
        if(mn) mn.value = appSettings.missionName;
    }
    // Show territory info if exists
    const terInfoEl = document.getElementById('settingsTerritoryInfo');
    const badge = document.getElementById('shlichutAreaBadge');
    if(appSettings.territory && appSettings.territory.polygon) {
        const areaKm2 = computePolygonAreaKm2(appSettings.territory.polygon);
        if(terInfoEl) terInfoEl.style.display = 'block';
        const tn = document.getElementById('settingsTerritoryName');
        const ta = document.getElementById('settingsTerritoryArea');
        if(tn) tn.innerText = appSettings.missionName || 'אזור מתוחם';
        if(ta) ta.innerText = areaKm2 < 1 ? (areaKm2*100).toFixed(1)+' דונם' : areaKm2.toFixed(2);
        if(badge) badge.style.display = 'inline';
        tempTerritoryPolygon = appSettings.territory.polygon;
        // פתח את ה-details אוטומטית כשיש נתונים
        const shDetails = document.getElementById('shlichutAreaDetails');
        if(shDetails) shDetails.open = true;
        // Set display mode radio
        const dispMode = appSettings.territory.displayMode || 'border';
        const radio = document.querySelector(`input[name="territoryDisplayMode"][value="${dispMode}"]`);
        if(radio) radio.checked = true;
        // ← שחזר את אופן הציור (עיר / ידני)
        const savedDrawMode = appSettings.territory.drawMode || 'city';
        setUpdateDrawMode(savedDrawMode);
    } else {
        if(terInfoEl) terInfoEl.style.display = 'none';
        if(badge) badge.style.display = 'none';
    }
    // Init geocoder for settings territory search
    setTimeout(() => initSettingsTerritoryGeocoder(), 100);
    // עדכן סטטיסטיקת שליחות
    updateTerritoryStatsDisplay();

    // Show last scan info
    const scanStatusEl = document.getElementById('unitsScanStatus');
    const scanSummaryEl = document.getElementById('unitsScanSummary');
    if(scanStatusEl) {
        const lastSync = appSettings.territory?.unitsLastSync;
        if(lastSync) {
            const when = new Date(lastSync);
            const dateStr = when.toLocaleDateString('he-IL') + ' ' + when.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
            const count = appSettings.territory?.gisCache ? Object.keys(appSettings.territory.gisCache.data||{}).length : 0;
            const src = appSettings.territory?.gisCache?.source;
            const srcName = src && CITIES_GIS_CONFIG[src] ? CITIES_GIS_CONFIG[src].name : (src==='osm'?'Overpass OSM':'—');
            scanStatusEl.innerText = `סריקה אחרונה: ${dateStr} — ${count} בניינים מ-${srcName}`;
            if(scanSummaryEl && count>0) {
                scanSummaryEl.style.display='block';
                document.getElementById('unitsScanSummaryText').innerText=`${count} בניינים נסרקו`;
            }
        } else {
            scanStatusEl.innerText = 'טרם בוצעה סריקה';
        }
    }
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

    // Save mission name and territory
    const mname = document.getElementById('settingsMissionName');
    if(mname && mname.value.trim()) appSettings.missionName = mname.value.trim();
    if(tempTerritoryPolygon) {
        const dispMode = document.querySelector('input[name="territoryDisplayMode"]:checked');
        const drawModeEl = document.querySelector('input[name="setDrawMode"]:checked');
        appSettings.territory = {
            polygon: tempTerritoryPolygon,
            displayMode: dispMode ? dispMode.value : 'border',
            drawMode: drawModeEl ? drawModeEl.value : 'city'  // ← שמור איך צויר
        };
    }

    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    populateFilterDropdowns();
    document.getElementById('settingsModal').style.display = 'none';
    updateHomeButton();
    renderTerritoryOnMap();
    updateCoverageStats();
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
    } else if (!accessToken) {
        clearInterval(window._autoSyncInterval);
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

// סגירת דרופדאון התיוגים (@) אם לוחצים מחוץ לאזור
document.addEventListener('click', (e) => {
    const mentionDd = document.getElementById('mentionDropdown');
    if (mentionDd && mentionDd.style.display === 'block') {
        const taskInput = document.getElementById('globalTaskInput');
        if (e.target !== taskInput && !mentionDd.contains(e.target)) {
            mentionDd.style.display = 'none';
        }
    }
});

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


// ════════════════════════════════════════════════════════
// ── Google Contacts Integration ──
// סריקת אנשי קשר, התאמה חכמה, ייבוא והשלמת פרטים
// ════════════════════════════════════════════════════════

let _allContacts = [];       // רשימה מלאה שנשמרת לאחר טעינה
let _contactMatches = [];    // התאמות שנמצאו

// ── טעינת כל אנשי הקשר מ-Google People API ──
async function loadGoogleContacts() {
    if (!accessToken) { showToast('יש להתחבר לחשבון Google קודם', 'warning'); return []; }
    setSyncStatus('wait', 'טוען אנשי קשר...');
    let allPeople = [], nextPageToken = null;
    try {
        do {
            const url = new URL('https://people.googleapis.com/v1/people/me/connections');
            url.searchParams.set('personFields', 'names,phoneNumbers,emailAddresses');
            url.searchParams.set('pageSize', '1000');
            if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) {
                if (res.status === 403) {
                    showToast('יש לאשר גישה לאנשי קשר — התחבר מחדש', 'warning');
                    // אפס session כדי לאלץ login מחדש עם scope חדש
                    localStorage.removeItem('gdrive_session');
                    window.handleGoogleLogin();
                    return [];
                }
                throw new Error('Contacts API error: ' + res.status);
            }
            const data = await res.json();
            if (data.connections) allPeople.push(...data.connections);
            nextPageToken = data.nextPageToken || null;
        } while (nextPageToken);

        setSyncStatus('ok', 'מסונכרן');
        return allPeople;
    } catch(e) {
        console.error('loadGoogleContacts error:', e);
        setSyncStatus('error', 'שגיאה');
        return [];
    }
}

// ── המרת רשומת People API לאובייקט פשוט ──
function parseContact(person) {
    const names = person.names || [];
    const phones = (person.phoneNumbers || []).map(p => p.value?.replace(/\D/g,'').replace(/^972/, '0') || '').filter(Boolean);
    const emails = (person.emailAddresses || []).map(e => e.value || '').filter(Boolean);
    const displayName = names[0]?.displayName || '';
    const familyName  = names[0]?.familyName  || '';
    const givenName   = names[0]?.givenName   || '';
    return { displayName, familyName, givenName, phones, emails };
}

// ── התאמה חכמה: מצא לכל איש קשר משפחה תואמת במערכת ──
function matchContactsToFamilies(contacts) {
    const matches   = []; // התאמות למשפחות קיימות
    const newFams   = []; // אנשי קשר שאין להם זוג במערכת

    // בנה אינדקס מהיר: שם_משפחה → { bldg, aptIdx, apt }
    const familyIndex = {};
    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg].apts || []).forEach((apt, aptIdx) => {
            const key = (apt.name || '').trim().toLowerCase();
            if (!key) return;
            if (!familyIndex[key]) familyIndex[key] = [];
            familyIndex[key].push({ bldg, aptIdx, apt });
        });
    });

    contacts.forEach(person => {
        const c = parseContact(person);
        if (!c.familyName && !c.displayName) return;
        if (!c.phones.length && !c.emails.length) return; // אין מה להוסיף

        const searchKey = (c.familyName || c.displayName).trim().toLowerCase();
        const found = familyIndex[searchKey];

        if (found && found.length > 0) {
            // התאמה נמצאה — בדוק אילו שדות חסרים
            found.forEach(({ bldg, aptIdx, apt }) => {
                const missing = [];
                if (!apt.fatherPhone && !apt.motherPhone && c.phones[0])
                    missing.push({ field: 'phone', value: c.phones[0], label: 'טלפון 1' });
                if (c.phones[1] && !apt.fatherPhone)
                    missing.push({ field: 'fatherPhone', value: c.phones[1], label: 'טלפון אב' });
                if (!apt.fatherEmail && !apt.motherEmail && c.emails[0])
                    missing.push({ field: 'fatherEmail', value: c.emails[0], label: 'מייל' });

                if (missing.length > 0) {
                    matches.push({ type: 'complete', bldg, aptIdx, apt, contact: c, missing });
                }
            });
        } else {
            // לא נמצא — הצע להוסיף כמשפחה חדשה
            newFams.push({ type: 'new', contact: c });
        }
    });

    return { matches, newFams };
}

// ── פתיחת חלון סנכרון אנשי קשר ──
window.openContactsSync = async function() {
    showToast('סורק אנשי קשר מגוגל...', 'info');
    const raw = await loadGoogleContacts();
    if (!raw.length) return;

    _allContacts = raw.map(parseContact).filter(c => c.phones.length || c.emails.length);
    const { matches, newFams } = matchContactsToFamilies(raw);
    _contactMatches = matches;

    renderContactsSyncModal(matches, newFams);
};

function renderContactsSyncModal(matches, newFams) {
    const total = matches.length + newFams.length;
    if (total === 0) {
        showToast('לא נמצאו עדכונים חדשים מאנשי הקשר 👌', 'success');
        return;
    }

    document.getElementById('contacts-sync-count').innerText =
        `${matches.length} השלמות · ${newFams.length} משפחות חדשות`;

    const list = document.getElementById('contacts-sync-list');

    // --- השלמות ---
    const completeSections = matches.map((m, mi) => {
        const fields = m.missing.map((f, fi) => `
            <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:var(--surface); border-radius:8px; margin-bottom:6px;">
                <input type="checkbox" class="csync-cb" data-mi="${mi}" data-fi="${fi}" checked
                    style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;">
                <div style="flex:1;">
                    <div style="font-size:12px;color:var(--text-muted);">${escapeHTML(f.label)}</div>
                    <div style="font-weight:700;font-size:14px;" dir="ltr">${escapeHTML(f.value)}</div>
                </div>
            </div>`).join('');

        return `
        <div style="background:var(--bg-body);border:1px solid var(--border-light);border-radius:14px;padding:14px;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                <div style="width:36px;height:36px;border-radius:50%;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-user-check" style="color:var(--success);"></i>
                </div>
                <div>
                    <div style="font-weight:700;font-size:15px;">משפחת ${escapeHTML(m.apt.name)}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${escapeHTML(m.bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : m.bldg)} · מאיש קשר: ${escapeHTML(m.contact.displayName)}</div>
                </div>
            </div>
            ${fields}
        </div>`;
    }).join('');

    // --- משפחות חדשות ---
    const newSections = newFams.map((n, ni) => `
        <div style="background:var(--bg-body);border:1px solid rgba(59,130,246,0.3);border-radius:14px;padding:14px;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <input type="checkbox" class="csync-new-cb" data-ni="${ni}"
                    style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;">
                <div style="width:36px;height:36px;border-radius:50%;background:rgba(59,130,246,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-user-plus" style="color:var(--accent);"></i>
                </div>
                <div style="flex:1;">
                    <div style="font-weight:700;font-size:15px;">${escapeHTML(n.contact.displayName)}</div>
                    <div style="font-size:12px;color:var(--text-muted);">
                        ${n.contact.phones[0] ? `<i class="fas fa-phone"></i> ${escapeHTML(n.contact.phones[0])}` : ''}
                        ${n.contact.emails[0] ? `&nbsp; <i class="fas fa-envelope"></i> ${escapeHTML(n.contact.emails[0])}` : ''}
                    </div>
                </div>
                <span style="font-size:11px;background:rgba(59,130,246,0.1);color:var(--accent);padding:3px 8px;border-radius:20px;font-weight:700;">חדש</span>
            </div>
        </div>`).join('');

    list.innerHTML = `
        ${matches.length > 0 ? `
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">
            <i class="fas fa-magic" style="color:var(--success);margin-left:5px;"></i>השלמת פרטים חסרים (${matches.length})
        </div>
        ${completeSections}` : ''}

        ${newFams.length > 0 ? `
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:14px 0 10px 0;">
            <i class="fas fa-user-plus" style="color:var(--accent);margin-left:5px;"></i>משפחות חדשות לייבוא (${newFams.length})
        </div>
        ${newSections}` : ''}`;

    // שמור refs לשימוש בעת אישור
    window._csyncMatches = matches;
    window._csyncNewFams = newFams;

    document.getElementById('contacts-sync-modal').style.display = 'flex';
}

// ── החלת עדכונים שנבחרו ──
window.applyContactsSync = function() {
    let applied = 0;

    // השלמות
    document.querySelectorAll('.csync-cb:checked').forEach(cb => {
        const mi = +cb.dataset.mi, fi = +cb.dataset.fi;
        const m = window._csyncMatches[mi];
        if (!m) return;
        const field = m.missing[fi];
        if (!field) return;
        const apt = db[m.bldg].apts[m.aptIdx];
        if (!apt) return;

        // שמור לשדה הנכון
        if (field.field === 'phone')       { apt.fatherPhone = apt.fatherPhone || field.value; apt.phone = apt.phone || field.value; }
        else if (field.field === 'fatherPhone') apt.fatherPhone = field.value;
        else if (field.field === 'motherPhone') apt.motherPhone = field.value;
        else if (field.field === 'fatherEmail') apt.fatherEmail = field.value;
        else if (field.field === 'motherEmail') apt.motherEmail = field.value;
        else apt[field.field] = field.value;

        apt.updatedAt = Date.now();
        applied++;
    });

    // משפחות חדשות
    document.querySelectorAll('.csync-new-cb:checked').forEach(cb => {
        const ni = +cb.dataset.ni;
        const n = window._csyncNewFams[ni];
        if (!n) return;
        const c = n.contact;
        const key = NO_ADDRESS_KEY;
        if (!db[key]) db[key] = { info: { code:'', rep:'', notes:'', coords:null }, apts: [] };
        db[key].apts.push({
            name: c.familyName || c.displayName,
            father: c.givenName || '',
            fatherName: c.givenName || '',
            mother: '', motherName: '',
            fatherPhone: c.phones[0] || '',
            motherPhone: c.phones[1] || '',
            fatherEmail: c.emails[0] || '',
            phone: c.phones[0] || '',
            num: '', style: '', notes: 'יובא מאנשי קשר גוגל',
            tags: [], boards: {}, childrenList: [],
            interactions: [], donations: [], tasks: [], customData: {},
            status: 'חדש', updatedAt: Date.now()
        });
        applied++;
    });

    if (applied > 0) {
        saveDB();
        refreshMap();
        handleOmniSearch();
        showToast(`✅ ${applied} עדכונים יושמו בהצלחה!`, 'success');
    }
    document.getElementById('contacts-sync-modal').style.display = 'none';
};

window.closeContactsSync = function() {
    document.getElementById('contacts-sync-modal').style.display = 'none';
};
