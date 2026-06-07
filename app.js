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
const SCOPES = 'email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/gmail.send';
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

// ── Default scoring rules ──────────────────────────────────
if(!appSettings.scoringRules) {
    appSettings.scoringRules = {
        thresholds: { green: 60, orange: 25 },
        channels: [
            { key: 'visit',    label: 'ביקור בית',      points: 50, ttlDays: 90 },
            { key: 'phone',    label: 'שיחת טלפון',     points: 30, ttlDays: 60 },
            { key: 'whatsapp', label: 'WhatsApp',        points: 20, ttlDays: 30 },
            { key: 'sms',      label: 'SMS',             points: 20, ttlDays: 30 },
            { key: 'email',    label: 'מייל',            points: 10, ttlDays: 30 },
        ]
    };
}
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
document.addEventListener('DOMContentLoaded', () => {
    if (typeof _initInteractionTypes === 'function') _initInteractionTypes();
    if (!appSettings.campaigns) appSettings.campaigns = [];
});
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

// ── Google OAuth via GIS tokenClient — supports fully silent background refresh ──
window.tokenClient = null;

function _initTokenClient() {
    if (typeof google === 'undefined' || window.tokenClient) return;
    window.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
            if (resp.error) {
                console.warn('GIS auth error:', resp.error);
                accessToken = null;
                const splash = document.getElementById('splash-screen');
                if (splash) { splash.style.opacity = '0'; setTimeout(() => { splash.style.display = 'none'; }, 600); }
                document.getElementById('auth-overlay').style.display = 'flex';
                return;
            }
            const expiresIn = parseInt(resp.expires_in || 3600, 10);
            accessToken = resp.access_token;
            const expiresAt = Date.now() + expiresIn * 1000;
            localStorage.setItem('gdrive_session', JSON.stringify({ token: accessToken, expiresAt }));
            localStorage.setItem('crm_logged_in', 'true');
            document.getElementById('auth-overlay').style.display = 'none';
            document.getElementById('splash-screen').style.display = 'flex';
            scheduleTokenRefresh();
            // Execute pending callback (e.g., from ensureAuthAndExecute or manualSync)
            if (window._pendingAuthCallback) {
                const cb = window._pendingAuthCallback;
                window._pendingAuthCallback = null;
                cb();
            } else {
                syncWithDrive();
            }
        }
    });
}

window.handleGoogleLogin = function() {
    _initTokenClient();
    if (!window.tokenClient) {
        showToast('ספריית Google טרם נטענה — נסה שוב', 'warning');
        return;
    }
    try { localStorage.setItem('community_data_final', JSON.stringify(db)); } catch(e) {}
    window.tokenClient.requestAccessToken({ prompt: 'consent' });
};

// No longer used — kept for backward compatibility only
function checkOAuthRedirect() { return false; }

window.onload = () => {
    let lastLogin = localStorage.getItem('last_login_date');
    let todayStr = new Date().toISOString().split('T')[0];
    let welcomeDiv = document.getElementById('welcomeMessage');

    // שם השליחות לברכה מותאמת אישית
    const prefs = JSON.parse(localStorage.getItem('crm_prefs') || '{}');
    const _rawName = prefs.missionName || '';
    const missionName = _rawName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    if(welcomeDiv) {
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
    const _savedDensity = appSettings.tableDensity;
    if (_savedDensity && _savedDensity !== 'normal') document.body.classList.add('density-' + _savedDensity);
    populateFilterDropdowns();
    // debounce לחיפוש — מונע ריצות מיותרות
    function debounce(fn, delay = 300) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
    }
    document.getElementById('smartSearch').addEventListener('input', debounce(handleOmniSearch));

    _initTokenClient();

    const session = JSON.parse(localStorage.getItem('gdrive_session'));
    const tokenValid = session && session.token && session.expiresAt > Date.now() + 60000;

    if (tokenValid) {
        // Valid cached token — use immediately
        accessToken = session.token;
        scheduleTokenRefresh();
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('splash-screen').style.display = 'flex';
        syncWithDrive();
    } else if (localStorage.getItem('crm_logged_in') === 'true') {
        // Token expired but user has logged in before — try silent GIS refresh
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('splash-screen').style.display = 'flex';
        if (window.tokenClient) {
            window.tokenClient.requestAccessToken({ prompt: '' });
        } else {
            // GIS SDK may not be loaded yet — retry after a moment
            setTimeout(() => {
                _initTokenClient();
                if (window.tokenClient) {
                    window.tokenClient.requestAccessToken({ prompt: '' });
                } else {
                    document.getElementById('splash-screen').style.opacity = '0';
                    setTimeout(() => {
                        document.getElementById('splash-screen').style.display = 'none';
                        document.getElementById('auth-overlay').style.display = 'flex';
                    }, 600);
                }
            }, 1500);
        }
    } else {
        // First-time user — show login screen
        document.getElementById('google-btn').innerHTML = `<button class="btn btn-primary" style="padding:12px 20px; font-size:16px;" onclick="handleGoogleLogin()"><i class="fab fa-google"></i> התחבר לענן</button>`;
        setTimeout(() => {
            document.getElementById('splash-screen').style.opacity = '0';
            setTimeout(() => {
                document.getElementById('splash-screen').style.display = 'none';
                document.getElementById('auth-overlay').style.display = 'flex';
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
    try {
        if(!coords || coords.length < 3) return 0;
        const poly = turf.polygon([coords]);
        return turf.area(poly) / 1_000_000;
    } catch(e) { return 0; }
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
// ══════════════════════════════════════════════════════════
// מסך תיחום מלא — משתנים
// ══════════════════════════════════════════════════════════
let tmCurrentTab = 'draw'; // draw | buildings | classify
let tmManualBuildings = {}; // { featureKey: { added: true/false, coords, category } }
let tmCategories = [
    {
        id: 'residential', name: 'מגורים', color: '#3b82f6', hasCard: true,
        emoji: '🏠', isDefault: true, cardType: 'residential',
        subCategories: [
            { id: 'residential_apt',   name: 'דירת מגורים',  color: '#3b82f6' },
            { id: 'residential_house', name: 'בית פרטי',     color: '#60a5fa' },
            { id: 'residential_bldg',  name: 'בניין מגורים', color: '#1d4ed8' },
        ],
        defaultFields: []
    },
    {
        id: 'synagogue', name: 'דת ובית כנסת', color: '#8b5cf6', hasCard: true,
        emoji: '🕍', isDefault: false, cardType: 'institution',
        subCategories: [
            { id: 'synagogue_chabad',     name: 'בית חב"ד',      color: '#8b5cf6' },
            { id: 'synagogue_general',    name: 'בית כנסת',       color: '#7c3aed' },
            { id: 'synagogue_institution',name: 'מוסד דתי',       color: '#6d28d9' },
        ],
        defaultFields: [
            { id: 'contactName', label: 'שם הרב / איש קשר', type: 'text' },
            { id: 'phone',       label: 'טלפון',             type: 'phone' },
            { id: 'prayerTimes', label: 'זמני תפילה',        type: 'textarea' },
            { id: 'hours',       label: 'שעות פעילות',       type: 'text' },
            { id: 'notes',       label: 'הערות',             type: 'textarea' },
        ]
    },
    {
        id: 'education', name: 'חינוך', color: '#10b981', hasCard: true,
        emoji: '📚', isDefault: false, cardType: 'institution',
        subCategories: [
            { id: 'education_kindergarten', name: 'גן ילדים',         color: '#34d399' },
            { id: 'education_school',       name: 'בית ספר',           color: '#10b981' },
            { id: 'education_college',      name: 'מכללה / אוניברסיטה',color: '#059669' },
            { id: 'education_other',        name: 'מוסד חינוכי אחר',   color: '#047857' },
        ],
        defaultFields: [
            { id: 'contactName', label: 'שם המנהל / איש קשר', type: 'text' },
            { id: 'phone',       label: 'טלפון',               type: 'phone' },
            { id: 'ageGroup',    label: 'גילאים',               type: 'text' },
            { id: 'hours',       label: 'שעות פעילות',         type: 'text' },
            { id: 'notes',       label: 'הערות',               type: 'textarea' },
        ]
    },
    {
        id: 'medical', name: 'בריאות', color: '#ef4444', hasCard: true,
        emoji: '🏥', isDefault: false, cardType: 'institution',
        subCategories: [
            { id: 'medical_clinic',   name: 'קליניקה / מרפאה', color: '#ef4444' },
            { id: 'medical_pharmacy', name: 'בית מרקחת',       color: '#dc2626' },
            { id: 'medical_hospital', name: 'בית חולים',        color: '#b91c1c' },
            { id: 'medical_other',    name: 'שירות רפואי אחר', color: '#f87171' },
        ],
        defaultFields: [
            { id: 'contactName', label: 'שם הרופא / איש קשר', type: 'text' },
            { id: 'phone',       label: 'טלפון',               type: 'phone' },
            { id: 'hours',       label: 'שעות קבלה',           type: 'text' },
            { id: 'specialty',   label: 'התמחות',              type: 'text' },
            { id: 'notes',       label: 'הערות',               type: 'textarea' },
        ]
    },
    {
        id: 'business', name: 'עסקים', color: '#f59e0b', hasCard: true,
        emoji: '🏪', isDefault: false, cardType: 'institution',
        subCategories: [
            { id: 'business_store',      name: 'חנות',          color: '#f59e0b' },
            { id: 'business_restaurant', name: 'מסעדה / בית קפה',color: '#d97706' },
            { id: 'business_office',     name: 'משרד / עסק',    color: '#b45309' },
            { id: 'business_other',      name: 'עסק אחר',       color: '#fbbf24' },
        ],
        defaultFields: [
            { id: 'contactName', label: 'שם בעל העסק / איש קשר', type: 'text' },
            { id: 'phone',       label: 'טלפון',                  type: 'phone' },
            { id: 'hours',       label: 'שעות פתיחה',             type: 'text' },
            { id: 'website',     label: 'אתר אינטרנט',            type: 'url' },
            { id: 'notes',       label: 'הערות',                  type: 'textarea' },
        ]
    },
    {
        id: 'offices', name: 'משרדים ומוסדות', color: '#6366f1', hasCard: true,
        emoji: '🏢', isDefault: false, cardType: 'institution',
        subCategories: [
            { id: 'offices_govt',    name: 'מוסד ממשלתי', color: '#6366f1' },
            { id: 'offices_org',     name: 'עמותה / ארגון',color: '#4f46e5' },
            { id: 'offices_general', name: 'משרד כללי',   color: '#4338ca' },
        ],
        defaultFields: [
            { id: 'contactName', label: 'איש קשר',        type: 'text' },
            { id: 'phone',       label: 'טלפון',           type: 'phone' },
            { id: 'hours',       label: 'שעות פעילות',    type: 'text' },
            { id: 'website',     label: 'אתר',             type: 'url' },
            { id: 'notes',       label: 'הערות',           type: 'textarea' },
        ]
    },
    {
        id: 'irrelevant', name: 'לא רלוונטי', color: '#94a3b8', hasCard: false,
        emoji: '🚫', isDefault: false, cardType: 'none',
        subCategories: [],
        defaultFields: []
    },
];
let tmBuildingClassify = {}; // { featureKey: { catId, name, geometry, center } }
let tmCollectedBuildings = {}; // { featureKey: { center, geometry } } — all buildings in territory
let tmPanelCityGeocoder = null;

// ── משתנה Draw instance ──
let tmDraw = null;

window.openTerritoryMapEditor = (source) => {
    tempTerritorySource = source || 'onboarding';
    tmCurrentTab = 'draw';

    // טען נתונים שמורים
    if (appSettings.territory?.manualBuildings) tmManualBuildings = { ...appSettings.territory.manualBuildings };
    if (appSettings.territory?.buildingClassify) tmBuildingClassify = { ...appSettings.territory.buildingClassify };
    if (appSettings.territory?.categories?.length) {
        const saved = appSettings.territory.categories;
        // מזג קטגוריות שמורות עם הגדרות חדשות (תאימות לאחור)
        tmCategories = tmCategories.map(def => {
            const stored = saved.find(s => s.id === def.id);
            return stored ? { ...def, ...stored, subCategories: stored.subCategories || def.subCategories, defaultFields: stored.defaultFields || def.defaultFields } : def;
        });
        // קטגוריות מותאמות אישית שנוספו
        saved.forEach(s => { if (!tmCategories.find(c => c.id === s.id)) tmCategories.push(s); });
        // ודא שרק קטגוריה אחת היא ברירת המחדל
        const defaults = tmCategories.filter(c => c.isDefault);
        if (defaults.length > 1) {
            // שמור רק את הראשון שנשמר כ-isDefault
            const keepId = saved.find(s => s.isDefault)?.id || 'residential';
            tmCategories.forEach(c => { c.isDefault = (c.id === keepId); });
        } else if (defaults.length === 0) {
            const res = tmCategories.find(c => c.id === 'residential');
            if (res) res.isDefault = true;
        }
    }

    const nameEl = document.getElementById('tmMissionNameInput');
    if (nameEl) nameEl.value = appSettings.territory?.missionName || document.getElementById('settingsMissionName')?.value || '';

    document.getElementById('territoryMapEditorModal').style.display = 'flex';
    switchTmTab('draw');
    try { tmRenderCategories(); } catch(e) { console.error('[tmRenderCategories]', e); }
    try { tmRenderClassifySummary(); } catch(e) { console.error('[tmRenderClassifySummary]', e); }

    setTimeout(() => {
        tmInitPanelCityGeocoder();
    }, 100);

    setTimeout(() => {
        if (tmMap) {
            tmMap.resize();
            // עדכן פוליגון קיים ב-Draw
            if (tempTerritoryPolygon && tempTerritoryPolygon.length >= 3) {
                tmDraw && tmDraw.deleteAll();
                const ring = window._isPolygonClosed(tempTerritoryPolygon)
                    ? tempTerritoryPolygon : [...tempTerritoryPolygon, tempTerritoryPolygon[0]];
                tmDraw && tmDraw.add({ type:'Feature', geometry:{ type:'Polygon', coordinates:[ring] } });
                const cx = ring.reduce((s,p)=>s+p[0],0)/ring.length;
                const cy = ring.reduce((s,p)=>s+p[1],0)/ring.length;
                tmMap.flyTo({ center:[cx,cy], zoom:15, duration:600 });
                tmUpdateFromDraw();
            }
            return;
        }

        const center = (tempTerritoryPolygon?.length > 0)
            ? [tempTerritoryPolygon.reduce((s,p)=>s+p[0],0)/tempTerritoryPolygon.length,
               tempTerritoryPolygon.reduce((s,p)=>s+p[1],0)/tempTerritoryPolygon.length]
            : (appSettings.homeLocation?.coords || appSettings.center || [35.2, 31.8]);

        tmMap = new mapboxgl.Map({
            container: 'territoryEditorMap',
            style: 'mapbox://styles/mapbox/streets-v12',
            center, zoom: 15,
            language: 'he'
        });

        // ── הוסף mapbox-gl-draw ──
        tmDraw = new MapboxDraw({
            displayControlsDefault: false,
            controls: {},
            defaultMode: 'draw_polygon',
            styles: [
                // פוליגון ממתין
                { id: 'gl-draw-polygon-fill', type: 'fill', filter: ['all',['==','$type','Polygon'],['!=','mode','static']],
                  paint: { 'fill-color': '#10b981', 'fill-opacity': 0.12 } },
                { id: 'gl-draw-polygon-stroke', type: 'line', filter: ['all',['==','$type','Polygon'],['!=','mode','static']],
                  paint: { 'line-color': '#10b981', 'line-width': 2.5, 'line-dasharray': [2,1] } },
                // נקודות
                { id: 'gl-draw-point', type: 'circle', filter: ['all',['==','$type','Point'],['==','meta','vertex']],
                  paint: { 'circle-radius': 8, 'circle-color': '#10b981', 'circle-stroke-width': 2.5, 'circle-stroke-color': 'white' } },
                { id: 'gl-draw-point-mid', type: 'circle', filter: ['all',['==','$type','Point'],['==','meta','midpoint']],
                  paint: { 'circle-radius': 5, 'circle-color': '#f59e0b', 'circle-stroke-width': 2, 'circle-stroke-color': 'white' } },
            ]
        });
        tmMap.addControl(tmDraw);

        tmMap.on('load', () => {
            // שכבת מבנים לצורך סיווג ומבנים
            tmMap.addLayer({
                id: 'tm-buildings-highlight',
                source: 'composite',
                'source-layer': 'building',
                type: 'fill-extrusion',
                minzoom: 13,
                paint: {
                    'fill-extrusion-color': '#d1d5db',
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': ['get', 'min_height'],
                    'fill-extrusion-opacity': 0.6
                }
            });

            // אם יש פוליגון קיים — טען אותו ל-Draw
            if (tempTerritoryPolygon && tempTerritoryPolygon.length >= 3) {
                const ring = window._isPolygonClosed(tempTerritoryPolygon)
                    ? tempTerritoryPolygon : [...tempTerritoryPolygon, tempTerritoryPolygon[0]];
                tmDraw.add({ type:'Feature', geometry:{ type:'Polygon', coordinates:[ring] } });
                tmUpdateFromDraw();
                // עבור למצב עריכה אחרי טעינה
                const features = tmDraw.getAll().features;
                if (features.length > 0) tmDraw.changeMode('direct_select', { featureId: features[0].id });
            }

            // hover על מבנים
            tmMap.on('mouseenter', 'tm-buildings-highlight', () => {
                if (tmCurrentTab === 'buildings' || tmCurrentTab === 'classify')
                    tmMap.getCanvas().style.cursor = 'pointer';
            });
            tmMap.on('mouseleave', 'tm-buildings-highlight', () => { tmMap.getCanvas().style.cursor = ''; });

            // לחיצה על מבנה — ישירות על השכבה (לא דרך map.click כדי לא להתנגש עם Draw)
            tmMap.on('click', 'tm-buildings-highlight', (e) => {
                e.preventDefault && e.preventDefault();
                console.log('[TM click] tab=', tmCurrentTab);
                try {
                    if (tmCurrentTab === 'buildings') tmHandleBuildingClick(e);
                    else if (tmCurrentTab === 'classify') tmHandleClassifyClick(e);
                } catch(err) { console.error('[TM click error]', err); }
            });
        });

        // ── הסתר כפתורי Draw המובנים — אנחנו משתמשים בכפתורים שלנו ──
        const drawControls = document.querySelector('.mapboxgl-ctrl-group');
        if (drawControls) drawControls.style.display = 'none';
        // הסר כל כפתורי draw שמופיעים
        tmMap.once('idle', () => {
            document.querySelectorAll('.mapbox-gl-draw_ctrl-draw-btn, .mapboxgl-ctrl-group').forEach(el => {
                if (el.closest('#territoryEditorMap')) el.style.display = 'none';
            });
        });
        tmMap.on('draw.create', tmUpdateFromDraw);
        tmMap.on('draw.update', tmUpdateFromDraw);
        tmMap.on('draw.delete', () => {
            tmPoints = [];
            document.getElementById('tmEditorArea').innerText = '—';
            document.getElementById('tmEditorStatus').innerText = 'הוסף פוליגון';
            document.getElementById('tmCurrentPolyInfo').style.display = 'none';
        });

        tmMap.on('error', (e) => { console.warn('TmMap error:', e); });
    }, 150);
};

// ── עדכון נתונים מ-Draw ──
function tmUpdateFromDraw() {
    if (!tmDraw) return;
    const data = tmDraw.getAll();
    if (!data.features.length) { tmPoints = []; return; }
    const coords = data.features[0].geometry.coordinates[0];
    tmPoints = coords.slice(0, -1); // הסר נקודה סוגרת

    document.getElementById('tmPointCount').innerText = tmPoints.length;

    if (tmPoints.length >= 3) {
        const areaKm2 = computePolygonAreaKm2([...tmPoints, tmPoints[0]]);
        const areaStr = areaKm2 < 1 ? (areaKm2*100).toFixed(1)+' דונם' : areaKm2.toFixed(2)+' קמ"ר';
        document.getElementById('tmEditorArea').innerText = areaStr;
        document.getElementById('tmEditorStatus').innerText = `${tmPoints.length} נקודות — ניתן לאשר`;
        tmUpdatePolyInfo('ציור ידני');
        clearTimeout(window._tmCountTimeout);
        window._tmCountTimeout = setTimeout(() => tmCountBuildings(), 800);
    }
}

window.tmSetMode = (mode) => {
    if (!tmDraw || !tmMap) return;

    const colors = { draw: '#10b981', move: '#f59e0b', erase: '#ef4444' };
    ['draw','move','erase'].forEach(m => {
        const btn = document.getElementById(`tmBtn${m.charAt(0).toUpperCase()+m.slice(1)}`);
        if (!btn) return;
        const isActive = m === mode;
        btn.style.background = isActive ? colors[m] : 'white';
        btn.style.color = isActive ? 'white' : '#374151';
        btn.style.borderColor = isActive ? colors[m] : 'white';
    });

    const features = tmDraw.getAll().features;
    const hasFeature = features.length > 0;

    try {
        if (mode === 'draw') {
            if (!hasFeature) {
                tmDraw.changeMode('draw_polygon');
            } else {
                tmDraw.changeMode('direct_select', { featureId: features[0].id });
            }
            tmMap.getCanvas().style.cursor = 'crosshair';
        } else if (mode === 'move') {
            if (hasFeature) tmDraw.changeMode('direct_select', { featureId: features[0].id });
            else tmDraw.changeMode('simple_select');
            tmMap.getCanvas().style.cursor = 'grab';
        } else if (mode === 'erase') {
            if (hasFeature) tmDraw.changeMode('direct_select', { featureId: features[0].id });
            else tmDraw.changeMode('simple_select');
            tmMap.getCanvas().style.cursor = 'pointer';
        }
    } catch(err) {
        console.warn('tmSetMode error:', err.message);
        try { tmDraw.changeMode('simple_select'); } catch(e) {}
    }
};

window.tmClearAll = () => {
    if (tmDraw) tmDraw.deleteAll();
    tmPoints = [];
    document.getElementById('tmEditorArea').innerText = '—';
    document.getElementById('tmEditorStatus').innerText = 'הוסף פוליגון';
    document.getElementById('tmCurrentPolyInfo').style.display = 'none';
};

window.closeTerritoryEditor = () => {
    document.getElementById('territoryMapEditorModal').style.display = 'none';
    if (tmMap) { try { tmMap.remove(); } catch(e) {} tmMap = null; }
    tmDraw = null;
    tmPanelCityGeocoder = null;
};

window.confirmTerritoryDrawing = () => {
    if (tmPoints.length < 3) { showToast('יש לסמן לפחות 3 נקודות', 'warning'); return; }
    tempTerritoryPolygon = [...tmPoints, tmPoints[0]];
    const areaKm2 = computePolygonAreaKm2(tempTerritoryPolygon);

    const missionName = document.getElementById('tmMissionNameInput')?.value?.trim();
    if (missionName) {
        if (!appSettings.territory) appSettings.territory = {};
        appSettings.territory.missionName = missionName;
        const settingsNameEl = document.getElementById('settingsMissionName');
        if (settingsNameEl) settingsNameEl.value = missionName;
    }

    if (!appSettings.territory) appSettings.territory = {};
    appSettings.territory.manualBuildings = tmManualBuildings;
    appSettings.territory.buildingClassify = tmBuildingClassify;
    appSettings.territory.categories = tmCategories;
    appSettings.territory.collectedBuildings = tmCollectedBuildings;
    tmCollectedBuildings = {};

    showTerritoryInfo(missionName || 'ציור ידני', areaKm2, tempTerritorySource);
    document.getElementById('territoryMapEditorModal').style.display = 'none';

    const st = document.getElementById('obDrawStatus');
    if (st) st.innerText = `✓ ${tmPoints.length} נקודות, שטח: ${areaKm2 < 1 ? (areaKm2*100).toFixed(1)+' דונם' : areaKm2.toFixed(2)+' קמ"ר'}`;

    if (tmMap) { try { tmMap.remove(); } catch(e) {} tmMap = null; }
    tmDraw = null;
    tmPanelCityGeocoder = null;

    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    showToast('תיחום נשמר ✓', 'success');
    setTimeout(() => syncTerritoryCardsToDb(), 800);
};


// ══════════════════════════════════════════════════════════════
// פונקציות ממשק תיחום — לשוניות, מבנים, סיווג
// ══════════════════════════════════════════════════════════════

// ── לוויין בעורך התיחום ──
let tmIsSatellite = false;
window.tmToggleSatellite = () => {
    if (!tmMap) return;
    tmIsSatellite = !tmIsSatellite;
    const style = tmIsSatellite
        ? 'mapbox://styles/mapbox/satellite-streets-v12'
        : 'mapbox://styles/mapbox/streets-v12';
    const btn = document.getElementById('tmSatelliteBtn');
    if (btn) {
        btn.style.background = tmIsSatellite ? '#1e293b' : 'white';
        btn.style.color = tmIsSatellite ? 'white' : '#374151';
        btn.innerHTML = tmIsSatellite
            ? '<i class="fas fa-map"></i> מפה'
            : '<i class="fas fa-satellite"></i> לוויין';
    }
    tmMap.setStyle(style);
    tmMap.once('style.load', () => {
        tmMap.addLayer({
            id: 'tm-buildings-highlight',
            source: 'composite',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 13,
            paint: {
                'fill-extrusion-color': tmIsSatellite ? '#ffffff' : '#d1d5db',
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'min_height'],
                'fill-extrusion-opacity': tmIsSatellite ? 0.5 : 0.6
            }
        });
        if (tmCurrentTab === 'buildings' || tmCurrentTab === 'classify') {
            setTimeout(() => tmCountBuildings(), 500);
        }
    });
};

// ── אתחול geocoder חיפוש עיר בפאנל ──
function tmInitPanelCityGeocoder() {
    const container = document.getElementById('tmPanelCityGeocoderContainer');
    if (!container || tmPanelCityGeocoder) return;
    tmPanelCityGeocoder = new MapboxGeocoder({
        accessToken: mapboxgl.accessToken,
        mapboxgl: mapboxgl,
        placeholder: 'חפש עיר / יישוב...',
        countries: 'il',
        language: 'he',
        types: 'place,locality'
    });
    container.appendChild(tmPanelCityGeocoder.onAdd(tmMap || map));
    tmPanelCityGeocoder.on('result', (e) => {
        const item = e.result;
        let coords;
        if (item.geojson?.type === 'Polygon') coords = item.geojson.coordinates[0];
        else if (item.geojson?.type === 'MultiPolygon') coords = item.geojson.coordinates[0][0];
        else { showToast('לא ניתן לטעון גבולות לאזור זה', 'warning'); return; }
        // טען פוליגון ל-Draw
        if (tmDraw) {
            tmDraw.deleteAll();
            tmDraw.add({ type:'Feature', geometry:{ type:'Polygon', coordinates:[coords] } });
            tmUpdateFromDraw();
            const cx = coords.reduce((s,p)=>s+p[0],0)/coords.length;
            const cy = coords.reduce((s,p)=>s+p[1],0)/coords.length;
            if (tmMap) tmMap.flyTo({ center:[cx,cy], zoom:13, duration:800 });
        }
        tmUpdatePolyInfo(item.place_name_he || item.place_name);
    });
}

// ── מעבר בין לשוניות ──
window.switchTmTab = (tab) => {
    tmCurrentTab = tab;
    ['draw','buildings','classify'].forEach(t => {
        const panel = document.getElementById(`tmPanel-${t}`);
        const btn = document.getElementById(`tmTab-${t}`);
        if (panel) panel.style.display = t === tab ? 'block' : 'none';
        if (btn) {
            btn.style.background = t === tab ? 'var(--accent)' : 'var(--surface)';
            btn.style.color = t === tab ? 'white' : 'var(--text-muted)';
            btn.style.borderBottom = t === tab ? '3px solid var(--accent)' : '3px solid transparent';
        }
    });
    const drawToolbar = document.getElementById('tmDrawToolbar');
    const buildingsHint = document.getElementById('tmBuildingsHint');
    const classifyHint = document.getElementById('tmClassifyHint');
    if (drawToolbar) drawToolbar.style.display = tab === 'draw' ? 'flex' : 'none';
    if (buildingsHint) buildingsHint.style.display = tab === 'buildings' ? 'block' : 'none';
    if (classifyHint) classifyHint.style.display = tab === 'classify' ? 'block' : 'none';
    if (tab === 'buildings') {
        // Draw במצב passive
        try { if (tmDraw) tmDraw.changeMode('simple_select'); } catch(e) {}
        tmCountBuildings();
        tmRenderManualBuildingsList();
    }
    if (tab === 'classify') {
        // Draw במצב passive
        try { if (tmDraw) tmDraw.changeMode('simple_select'); } catch(e) {}
        try { tmRenderCategories(); } catch(e) { console.error('[tmRenderCategories on classify tab]', e); }
        try { tmRenderClassifySummary(); } catch(e) {}
    }
    if (tab === 'draw') {
        // החזר ל-draw mode
        try { if (tmDraw) tmDraw.changeMode('draw_polygon'); } catch(e) {}
    }
    if (tmMap) tmMap.getCanvas().style.cursor = tab === 'draw' ? 'crosshair' : 'pointer';
};

// ── מצב ציור ידני / עיר ──
window.tmPanelSetDrawMode = (mode) => {
    const cityPanel = document.getElementById('tmCitySearchPanel');
    const manualPanel = document.getElementById('tmManualDrawPanel');
    const cityLabel = document.getElementById('tmModeCity');
    const manualLabel = document.getElementById('tmModeManual');
    if (mode === 'city') {
        if (cityPanel) cityPanel.style.display = 'block';
        if (manualPanel) manualPanel.style.display = 'none';
        if (cityLabel) cityLabel.style.borderColor = 'var(--accent)';
        if (manualLabel) manualLabel.style.borderColor = 'var(--border-light)';
    } else {
        if (cityPanel) cityPanel.style.display = 'none';
        if (manualPanel) manualPanel.style.display = 'block';
        if (cityLabel) cityLabel.style.borderColor = 'var(--border-light)';
        if (manualLabel) manualLabel.style.borderColor = 'var(--accent)';
        // עבור ל-draw_polygon mode ב-Draw
        if (tmDraw) tmDraw.changeMode('draw_polygon');
    }
};

// ── עדכון תצוגה ──
window.tmUpdateDisplay = () => {
    const mode = document.querySelector('input[name="tmDisplayMode"]:checked')?.value || 'border';
    if (!appSettings.territory) appSettings.territory = {};
    appSettings.territory.displayMode = mode;
    applyTerritoryDisplayMode(mode);
};

// ── עדכון מידע פוליגון בפאנל ──
function tmUpdatePolyInfo(name) {
    if (tmPoints.length < 3) { document.getElementById('tmCurrentPolyInfo').style.display = 'none'; return; }
    const areaKm2 = computePolygonAreaKm2([...tmPoints, tmPoints[0]]);
    document.getElementById('tmCurrentPolyInfo').style.display = 'block';
    document.getElementById('tmPolyName').innerText = name || 'ציור ידני';
    document.getElementById('tmPolyArea').innerText = areaKm2 < 1 ? (areaKm2*100).toFixed(1)+' דונם' : areaKm2.toFixed(2)+' קמ"ר';
}

// ── ספירת מבנים בתיחום ──
function tmCountBuildings() {
    if (!tmMap || tmPoints.length < 3) return;
    const polygon = [...tmPoints, tmPoints[0]];
    const lngs = tmPoints.map(p=>p[0]), lats = tmPoints.map(p=>p[1]);
    tmMap.fitBounds([[Math.min(...lngs), Math.min(...lats)],[Math.max(...lngs), Math.max(...lats)]], { padding:40, duration:500 });

    const doCount = () => {
        if (!tmMap) return;
        const features = tmMap.queryRenderedFeatures({ layers: ['tm-buildings-highlight'] });
        const seen = new Set();
        let count = 0;
        features.forEach(f => {
            const key = tmBuildingKey(f);
            if (seen.has(key)) return;
            seen.add(key);
            const center = tmBuildingCenter(f);
            if (!center) return;
            const isManualRemoved = tmManualBuildings[key]?.added === false;
            const isManualAdded = tmManualBuildings[key]?.added === true;
            const inTerritory = isManualAdded || (!isManualRemoved && pointInPolygon(center, polygon));
            if (inTerritory) {
                count++;
                let geom = f.geometry;
                if (!geom?.coordinates?.length) {
                    const [cx, cy] = center, d = 0.00015;
                    geom = { type: 'Polygon', coordinates: [[[cx-d,cy-d],[cx+d,cy-d],[cx+d,cy+d],[cx-d,cy+d],[cx-d,cy-d]]] };
                }
                tmCollectedBuildings[key] = { center, geometry: geom };
            }
        });
        const totalEl = document.getElementById('tmBuildingsTotal');
        const countEl = document.getElementById('tmPolyBuildingCount');
        if (totalEl) totalEl.innerText = count;
        if (countEl) countEl.innerText = count;
        if (!appSettings.territory) appSettings.territory = {};
        appSettings.territory.buildingCount = count;
    };

    // Wait for map to finish rendering tiles before querying features
    if (tmMap.isStyleLoaded() && tmMap.areTilesLoaded()) {
        doCount();
    } else {
        tmMap.once('idle', doCount);
    }
}

// ── מפתח ייחודי למבנה ──
function tmBuildingKey(feature) {
    const center = tmBuildingCenter(feature);
    if (!center) return `${feature.id}`;
    return `${center[0].toFixed(5)},${center[1].toFixed(5)}`;
}

// ── מרכז מבנה ──
function tmBuildingCenter(feature) {
    try {
        const type = feature.geometry?.type;
        const coords = feature.geometry?.coordinates;
        if (!coords) return null;
        if (type === 'Point') return coords;
        let pts = type === 'Polygon' ? coords[0] : coords[0][0];
        if (!pts || pts.length === 0) return null;
        return [pts.reduce((s,p)=>s+p[0],0)/pts.length, pts.reduce((s,p)=>s+p[1],0)/pts.length];
    } catch(e) { return null; }
}

// ── לחיצה על מבנה — לשונית מבנים ──
function tmHandleBuildingClick(e) {
    if (!tmMap || tmPoints.length < 3) { showToast('יש לצייר תיחום קודם', 'warning'); return; }
    const features = tmMap.queryRenderedFeatures(e.point, { layers: ['tm-buildings-highlight'] });
    if (!features.length) return;
    const f = features[0];
    const key = tmBuildingKey(f);
    const center = tmBuildingCenter(f);
    const polygon = [...tmPoints, tmPoints[0]];
    const isInsideByDraw = center && pointInPolygon(center, polygon);
    if (tmManualBuildings[key]?.added === false) delete tmManualBuildings[key];
    else if (tmManualBuildings[key]?.added === true) delete tmManualBuildings[key];
    else if (isInsideByDraw) tmManualBuildings[key] = { added: false, coords: center };
    else tmManualBuildings[key] = { added: true, coords: center };
    tmCountBuildings();
    tmRenderManualBuildingsList();
}

// ── לחיצה על מבנה — לשונית סיווג ──
function tmHandleClassifyClick(e) {
    const features = tmMap.queryRenderedFeatures(e.point, { layers: ['tm-buildings-highlight'] });
    if (!features.length) return;
    const f = features[0];
    const key = tmBuildingKey(f);

    // מצב שיוך מחדש של POI — בחירת בניין עבור הצעה ממתינה
    if (_tmReassignPoiIdx !== null) {
        const poi = _tmPOISuggestions[_tmReassignPoiIdx];
        if (poi) {
            poi.matchedBldgKey = key;
            _tmApplyPOIToBuilding(poi, key);
            poi.status = 'approved';
        }
        _tmReassignPoiIdx = null;
        window.tmCancelReassign();
        tmRenderPOISuggestions();
        tmRenderClassifySummary();
        return;
    }
    const center = tmBuildingCenter(f);
    const currentEntry = tmBuildingClassify[key];
    const currentCat = currentEntry?.catId || 'residential';
    const currentName = currentEntry?.name || '';

    // שמור גיאומטריה — נבנה polygon מרובע סביב המרכז אם הגיאומטריה חתוכה
    let geometry = f.geometry;
    if (!geometry || !geometry.coordinates?.length) {
        // fallback — צור מרובע קטן סביב המרכז
        if (center) {
            const [cx, cy] = center;
            const d = 0.00015;
            geometry = { type: 'Polygon', coordinates: [[[cx-d,cy-d],[cx+d,cy-d],[cx+d,cy+d],[cx-d,cy+d],[cx-d,cy-d]]] };
        }
    }

    window._tmPendingGeometry = window._tmPendingGeometry || {};
    window._tmPendingGeometry[key] = { geometry, center };

    const currentSubCat = tmBuildingClassify[key]?.subCatId || '';
    const mainCatSelected = currentCat !== 'residential' ? currentCat : 'residential';

    const _buildPopupHTML = (selectedMainCatId) => {
        const mainCat = tmCategories.find(c => c.id === selectedMainCatId);
        const subCats = mainCat?.subCategories || [];
        // שמור ערך שהמשתמש הקליד אם הpopup כבר פתוח
        const liveNameVal = document.getElementById('tmBldgNameInput')?.value ?? currentName;
        return `
            <div style="font-family:inherit; direction:rtl; padding:4px; min-width:240px;">
                <div style="font-weight:700; font-size:13px; margin-bottom:8px; color:#111;">סיווג מבנה</div>
                <input id="tmBldgNameInput" type="text" placeholder="שם המבנה (אופציונלי)..."
                    value="${escapeHTML(liveNameVal)}"
                    style="width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid #e2e8f0; border-radius:6px; font-size:12px; margin-bottom:10px; font-family:inherit; direction:rtl;">
                <div style="font-size:11px; font-weight:600; color:#6b7280; margin-bottom:6px;">קטגוריה ראשית</div>
                <div style="display:flex; flex-direction:column; gap:5px; margin-bottom:${subCats.length ? '12px' : '0'};">
                    ${tmCategories.map(cat => `
                        <button onclick="window._tmSelectMainCat('${key}','${cat.id}')"
                            style="display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:8px;
                                   border:2px solid ${cat.id === selectedMainCatId ? cat.color : '#e2e8f0'};
                                   background:${cat.id === selectedMainCatId ? cat.color+'22' : 'white'};
                                   cursor:pointer; font-family:inherit; font-size:12px; font-weight:${cat.id === selectedMainCatId ? '700':'500'}; color:#374151;">
                            <span style="width:10px;height:10px;border-radius:50%;background:${cat.color};flex-shrink:0;"></span>
                            ${cat.emoji || ''} ${cat.name}
                        </button>
                    `).join('')}
                </div>
                ${subCats.length ? `
                <div style="font-size:11px; font-weight:600; color:#6b7280; margin-bottom:6px; border-top:1px solid #e2e8f0; padding-top:10px;">תת-קטגוריה</div>
                <div style="display:flex; flex-direction:column; gap:5px; margin-bottom:10px;">
                    ${subCats.map(sc => `
                        <button onclick="window.tmSetBuildingCategory('${key}','${selectedMainCatId}',document.getElementById('tmBldgNameInput')?.value||'',null,'${sc.id}'); document.querySelectorAll('.mapboxgl-popup').forEach(p=>p.remove());"
                            style="display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:8px;
                                   border:2px solid ${sc.id === currentSubCat ? sc.color : '#e2e8f0'};
                                   background:${sc.id === currentSubCat ? sc.color+'22' : '#f9fafb'};
                                   cursor:pointer; font-family:inherit; font-size:11px; font-weight:${sc.id === currentSubCat ? '700':'400'}; color:#374151;">
                            <span style="width:8px;height:8px;border-radius:50%;background:${sc.color};flex-shrink:0;"></span>
                            ${sc.name}
                        </button>
                    `).join('')}
                </div>` : ''}
                <button onclick="window.tmSetBuildingCategory('${key}','${selectedMainCatId}',document.getElementById('tmBldgNameInput')?.value||'',null,null); document.querySelectorAll('.mapboxgl-popup').forEach(p=>p.remove());"
                    style="width:100%; padding:8px; background:${mainCat?.color||'#3b82f6'}; color:white; border:none; border-radius:8px; font-family:inherit; font-size:12px; font-weight:700; cursor:pointer;">
                    ✓ שמור${subCats.length ? ' ללא תת-קטגוריה' : ''}
                </button>
            </div>`;
    };

    window._tmSelectMainCat = (bldgKey, catId) => {
        const popup = document.querySelector('.mapboxgl-popup-content');
        if (popup) popup.innerHTML = _buildPopupHTML(catId);
    };

    new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '280px' })
        .setLngLat(center || e.lngLat)
        .setHTML(_buildPopupHTML(mainCatSelected))
        .addTo(tmMap);
}

// ── הגדרת קטגוריה למבנה ──
window.tmSetBuildingCategory = (key, catId, name, popupContentEl, subCatId) => {
    const pending = window._tmPendingGeometry?.[key];
    tmBuildingClassify[key] = {
        catId, subCatId: subCatId || null,
        name: name || '',
        geometry: pending?.geometry || null,
        center: pending?.center || null
    };
    if (popupContentEl) { const p = popupContentEl.closest?.('.mapboxgl-popup'); if (p) p.remove(); }
    else document.querySelectorAll('.mapboxgl-popup').forEach(p => p.remove());
    if (window._tmPendingGeometry?.[key]) delete window._tmPendingGeometry[key];
    tmRenderClassifySummary();
    showToast('קטגוריה נשמרה ✓', 'success');
};

// ── רשימת שינויים ידניים ──
function tmRenderManualBuildingsList() {
    const list = document.getElementById('tmManualBuildingsList');
    if (!list) return;
    const entries = Object.entries(tmManualBuildings);
    if (!entries.length) { list.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:20px;">אין שינויים ידניים עדיין</div>'; return; }
    list.innerHTML = entries.map(([key, val]) => `
        <div style="display:flex; align-items:center; gap:8px; padding:8px 10px; background:var(--bg-body); border-radius:8px; border:1px solid var(--border-light);">
            <div style="width:10px;height:10px;border-radius:50%;background:${val.added ? '#10b981' : '#ef4444'};flex-shrink:0;"></div>
            <div style="flex:1; font-size:12px; color:var(--text-main);">${val.added ? 'נוסף ידנית' : 'הוסר ידנית'}</div>
            <button onclick="delete tmManualBuildings['${key}']; tmCountBuildings(); tmRenderManualBuildingsList();"
                style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:13px; padding:2px 6px;"><i class="fas fa-times"></i></button>
        </div>
    `).join('');
}

// ── רינדור מנהל קטגוריות מלא ──
function tmRenderCategories() {
    const list = document.getElementById('tmCategoriesList');
    if (!list) return;
    list.innerHTML = tmCategories.map((cat, i) => `
        <div style="background:var(--bg-body); border-radius:10px; border:1px solid var(--border-light); overflow:hidden; margin-bottom:6px;">
            <!-- שורת קטגוריה ראשית -->
            <div style="display:flex; align-items:center; gap:8px; padding:9px 10px;">
                <input type="color" value="${cat.color}"
                    onchange="tmCategories[${i}].color=this.value; tmRenderCategories();"
                    style="width:22px;height:22px;border:none;border-radius:4px;cursor:pointer;padding:0;background:none;flex-shrink:0;">
                <input type="text" value="${cat.name}"
                    onchange="tmCategories[${i}].name=this.value;"
                    style="flex:1;border:none;background:transparent;font-size:12px;font-weight:600;color:var(--text-main);font-family:inherit;direction:rtl;outline:none;">
                ${cat.isDefault ? '<span style="font-size:10px;background:var(--accent);color:white;padding:2px 6px;border-radius:10px;flex-shrink:0;">ברירת מחדל</span>' :
                    `<button onclick="tmCategories.forEach(c=>c.isDefault=false); tmCategories[${i}].isDefault=true; tmRenderCategories();"
                        title="הגדר כברירת מחדל"
                        style="background:none;border:1px solid var(--border-light);color:var(--text-muted);cursor:pointer;font-size:10px;border-radius:10px;padding:2px 6px;flex-shrink:0;">הגדר כברירת מחדל</button>`}
                <button onclick="window.tmToggleCatExpand(${i})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;padding:2px 4px;">
                    <i class="fas fa-chevron-down" id="tmCatChevron_${i}"></i>
                </button>
                ${!['residential','irrelevant'].includes(cat.id) ?
                    `<button onclick="if(confirm('למחוק קטגוריה זו?')) { tmCategories.splice(${i},1); tmRenderCategories(); }"
                        style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:12px;"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            <!-- תת-קטגוריות (מוסתרות ברירת מחדל) -->
            <div id="tmCatExpand_${i}" style="display:none; border-top:1px solid var(--border-light); padding:8px 10px; background:var(--surface);">
                <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">תת-קטגוריות:</div>
                ${(cat.subCategories||[]).map((sc, si) => `
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
                        <input type="color" value="${sc.color}"
                            onchange="tmCategories[${i}].subCategories[${si}].color=this.value;"
                            style="width:18px;height:18px;border:none;border-radius:3px;cursor:pointer;padding:0;background:none;">
                        <input type="text" value="${sc.name}"
                            onchange="tmCategories[${i}].subCategories[${si}].name=this.value;"
                            style="flex:1;border:1px solid var(--border-light);background:var(--bg-body);font-size:11px;color:var(--text-main);font-family:inherit;direction:rtl;border-radius:5px;padding:3px 6px;">
                        <button onclick="tmCategories[${i}].subCategories.splice(${si},1); tmRenderCategories();"
                            style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:11px;"><i class="fas fa-times"></i></button>
                    </div>
                `).join('')}
                <button onclick="window.tmAddSubCategory(${i})"
                    style="font-size:11px;color:var(--accent);background:none;border:1px dashed var(--accent);border-radius:6px;padding:4px 10px;cursor:pointer;width:100%;margin-top:4px;">
                    + הוסף תת-קטגוריה
                </button>
            </div>
        </div>
    `).join('');
}

window.tmToggleCatExpand = (i) => {
    const el = document.getElementById(`tmCatExpand_${i}`);
    const chevron = document.getElementById(`tmCatChevron_${i}`);
    if (!el) return;
    const isOpen = el.style.display !== 'none';
    el.style.display = isOpen ? 'none' : 'block';
    if (chevron) chevron.className = isOpen ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
};

window.tmAddSubCategory = (i) => {
    const name = prompt('שם התת-קטגוריה:');
    if (!name?.trim()) return;
    if (!tmCategories[i].subCategories) tmCategories[i].subCategories = [];
    tmCategories[i].subCategories.push({
        id: `${tmCategories[i].id}_${Date.now()}`,
        name: name.trim(),
        color: tmCategories[i].color
    });
    tmRenderCategories();
    document.getElementById(`tmCatExpand_${i}`)?.style && (document.getElementById(`tmCatExpand_${i}`).style.display = 'block');
};

// ── הוספת קטגוריה ראשית חדשה ──
window.tmAddCategory = () => {
    const name = document.getElementById('tmNewCategoryName')?.value?.trim();
    const color = document.getElementById('tmNewCategoryColor')?.value || '#6366f1';
    const hasCard = document.getElementById('tmNewCategoryHasCard')?.checked ?? true;
    if (!name) { showToast('יש להזין שם קטגוריה', 'warning'); return; }
    tmCategories.splice(tmCategories.length - 1, 0, {
        id: 'custom_' + Date.now(), name, color, hasCard,
        emoji: '📌', isDefault: false, cardType: 'institution',
        subCategories: [], defaultFields: [
            { id: 'contactName', label: 'איש קשר', type: 'text' },
            { id: 'phone',       label: 'טלפון',   type: 'phone' },
            { id: 'notes',       label: 'הערות',   type: 'textarea' },
        ]
    });
    tmRenderCategories();
    if (document.getElementById('tmNewCategoryName')) document.getElementById('tmNewCategoryName').value = '';
    showToast(`קטגוריה "${name}" נוספה ✓`, 'success');
};

// ── סיכום סיווג ──
function tmRenderClassifySummary() {
    const el = document.getElementById('tmClassifySummary');
    if (!el) return;
    const counts = {};
    tmCategories.forEach(c => counts[c.id] = 0);
    Object.values(tmBuildingClassify).forEach(entry => {
        const catId = typeof entry === 'object' ? entry.catId : entry;
        if (counts[catId] !== undefined) counts[catId]++;
        else counts[catId] = 1;
    });
    const total = Object.values(counts).reduce((a,b)=>a+b,0);
    if (!total) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px;">אין מבנים מסווגים עדיין</div>'; return; }
    el.innerHTML = `<div style="background:var(--bg-body); border-radius:10px; border:1px solid var(--border-light); padding:12px; margin-bottom:14px;">
        <div style="font-weight:700; font-size:12px; color:var(--text-main); margin-bottom:8px;">סיכום סיווג</div>
        ${tmCategories.filter(c=>counts[c.id]>0).map(c=>`
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
                <div style="width:10px;height:10px;border-radius:50%;background:${c.color};flex-shrink:0;"></div>
                <div style="flex:1;font-size:12px;color:var(--text-main);">${c.name}</div>
                <div style="font-weight:700;font-size:13px;color:${c.color};">${counts[c.id]}</div>
            </div>
        `).join('')}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// OSM POI AUTO-DETECTION — זיהוי מקומות ציבוריים אוטומטי
// ══════════════════════════════════════════════════════════════════

let _tmPOISuggestions = [];
let _tmReassignPoiIdx = null;

const _POI_EMOJI = { synagogue:'🕍', education:'📚', medical:'🏥', business:'🏪', offices:'🏢' };

function tmGetDefaultCatId() {
    return (tmCategories.find(c => c.isDefault) || tmCategories[0]).id;
}

function _osmToCatId(tags) {
    const a = tags.amenity || '';
    // דת
    if (a === 'place_of_worship') return { catId: 'synagogue', subCatId: 'synagogue_general' };
    // חינוך
    if (a === 'kindergarten') return { catId: 'education', subCatId: 'education_kindergarten' };
    if (['school'].includes(a)) return { catId: 'education', subCatId: 'education_school' };
    if (['university','college'].includes(a)) return { catId: 'education', subCatId: 'education_college' };
    if (['library','community_centre','arts_centre'].includes(a)) return { catId: 'education', subCatId: 'education_other' };
    // בריאות
    if (['clinic','doctors','dentist'].includes(a)) return { catId: 'medical', subCatId: 'medical_clinic' };
    if (a === 'pharmacy') return { catId: 'medical', subCatId: 'medical_pharmacy' };
    if (a === 'hospital') return { catId: 'medical', subCatId: 'medical_hospital' };
    // משרדים ומוסדות
    if (tags.office || ['townhall','post_office','police','fire_station'].includes(a)) return { catId: 'offices', subCatId: 'offices_govt' };
    // עסקים
    if (tags.shop) return { catId: 'business', subCatId: 'business_store' };
    if (['restaurant','cafe','fast_food','bar','pub'].includes(a)) return { catId: 'business', subCatId: 'business_restaurant' };
    if (['bank','atm','fuel'].includes(a)) return { catId: 'business', subCatId: 'business_other' };
    // ברירת מחדל — קטגוריית הברירת מחדל של המשתמש
    return { catId: tmGetDefaultCatId(), subCatId: null };
}

function _osmGetName(tags) {
    return tags['name:he'] || tags.name || tags['name:en'] || '';
}

function _osmGetAddress(tags) {
    return [tags['addr:street'] || '', tags['addr:housenumber'] || ''].filter(Boolean).join(' ');
}

function _tmFindNearestBuilding(lng, lat, maxM) {
    if (!tmMap) return null;
    maxM = maxM || 80;
    const features = tmMap.queryRenderedFeatures({ layers: ['tm-buildings-highlight'] });
    const polygon = tmPoints.length >= 3 ? [...tmPoints, tmPoints[0]] : null;
    let best = null, bestD = Infinity;
    const seen = new Set();
    features.forEach(f => {
        const key = tmBuildingKey(f);
        if (seen.has(key)) return;
        seen.add(key);
        const center = tmBuildingCenter(f);
        if (!center) return;
        if (polygon && !pointInPolygon(center, polygon) && !tmManualBuildings[key]?.added) return;
        const d = haversineM([lng, lat], center);
        if (d < maxM && d < bestD) { bestD = d; best = { key, center }; }
    });
    return best;
}

function _tmApplyPOIToBuilding(poi, bldgKey) {
    const pending = window._tmPendingGeometry?.[bldgKey];
    tmBuildingClassify[bldgKey] = {
        catId: poi.catId,
        subCatId: poi.subCatId || null,
        name: poi.name,
        phone: poi.phone,
        website: poi.website,
        hours: poi.hours,
        address: poi.address,
        gmapsUrl: poi.gmapsUrl,
        geometry: pending?.geometry || null,
        center: [poi.lng, poi.lat],
        source: 'osm',
        osmId: poi.osmId
    };
    showToast(`"${poi.name}" שויך ✓`, 'success');
}

window.tmScanPOIs = async function() {
    if (tmPoints.length < 3) { showToast('יש לצייר תיחום קודם', 'warning'); return; }
    const btn = document.getElementById('tmScanPOIsBtn');
    const statusEl = document.getElementById('tmPOIScanStatus');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> סורק מ-OpenStreetMap...'; }
    if (statusEl) { statusEl.style.display = 'block'; statusEl.innerText = 'שולף נתוני מקומות...'; }

    const lngs = tmPoints.map(p => p[0]), lats = tmPoints.map(p => p[1]);
    const bbox = `${(Math.min(...lats)-0.001).toFixed(6)},${(Math.min(...lngs)-0.001).toFixed(6)},${(Math.max(...lats)+0.001).toFixed(6)},${(Math.max(...lngs)+0.001).toFixed(6)}`;
    const polygon = [...tmPoints, tmPoints[0]];

    const query = `[out:json][timeout:25];(
node["amenity"~"place_of_worship|school|university|college|kindergarten|clinic|hospital|pharmacy|doctors|dentist|bank|restaurant|cafe|fast_food"](${bbox});
node["shop"](${bbox});
node["office"](${bbox});
way["amenity"~"place_of_worship|school|university|college|kindergarten|clinic|hospital|pharmacy|doctors|dentist|bank"](${bbox});
way["shop"](${bbox});
way["office"](${bbox});
);out tags center;`;

    try {
        const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(query) });
        if (!resp.ok) throw new Error('Overpass ' + resp.status);
        const data = await resp.json();

        const pois = [];
        for (const el of data.elements) {
            const tags = el.tags || {};
            const name = _osmGetName(tags);
            if (!name) continue;
            let lat, lng;
            if (el.type === 'node') { lat = el.lat; lng = el.lon; }
            else if (el.center) { lat = el.center.lat; lng = el.center.lon; }
            else continue;
            if (!pointInPolygon([lng, lat], polygon)) continue;
            const { catId, subCatId } = _osmToCatId(tags);
            const cat = tmCategories.find(c => c.id === catId) || { name: 'אחר', color: '#6366f1' };
            const address = _osmGetAddress(tags);
            const safeName = encodeURIComponent(name + (address ? ' ' + address : ''));
            pois.push({
                osmId: el.id, osmType: el.type,
                name, catId, subCatId, catName: cat.name, catColor: cat.color,
                phone: tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '',
                website: tags.website || tags['contact:website'] || '',
                hours: tags.opening_hours || '',
                address,
                lat, lng,
                gmapsUrl: `https://maps.google.com/?q=${safeName}&ll=${lat},${lng}&z=18`,
                matchedBldgKey: null,
                status: 'pending'
            });
        }

        if (!pois.length) {
            if (statusEl) { statusEl.innerText = 'לא נמצאו מקומות ציבוריים בתיחום'; }
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> זיהוי אוטומטי מ-OpenStreetMap'; }
            return;
        }

        // התאמה אוטומטית לבניין הקרוב
        pois.forEach(poi => {
            const match = _tmFindNearestBuilding(poi.lng, poi.lat);
            if (match) poi.matchedBldgKey = match.key;
        });

        _tmPOISuggestions = pois;
        if (statusEl) { statusEl.innerText = `נמצאו ${pois.length} מקומות`; setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 3000); }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-redo"></i> סרוק שוב'; }
        tmRenderPOISuggestions();

    } catch(e) {
        console.warn('POI scan failed:', e);
        showToast('שגיאה בסריקת מקומות — נסה שוב', 'danger');
        if (statusEl) { statusEl.innerText = 'שגיאה — נסה שוב'; }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> זיהוי אוטומטי מ-OpenStreetMap'; }
    }
};

function tmRenderPOISuggestions() {
    const wrap = document.getElementById('tmPOISuggestionsWrap');
    const list = document.getElementById('tmPOISuggestionsList');
    const countEl = document.getElementById('tmPOIPendingCount');
    if (!wrap || !list) return;

    const pending = _tmPOISuggestions.filter(p => p.status === 'pending');
    if (countEl) countEl.innerText = pending.length;

    if (!pending.length) {
        wrap.style.display = 'none';
        if (_tmPOISuggestions.length > 0) showToast('כל ההצעות טופלו ✓', 'success');
        return;
    }
    wrap.style.display = 'block';

    list.innerHTML = pending.map(poi => {
        const idx = _tmPOISuggestions.indexOf(poi);
        const emoji = _POI_EMOJI[poi.catId] || '📍';
        const hasMatch = !!poi.matchedBldgKey;
        const safeWebsite = /^https?:\/\//.test(poi.website) ? poi.website : '';
        return `
        <div class="poi-sug-card" id="poiCard-${idx}">
            <div class="poi-sug-header">
                <span class="poi-sug-icon">${emoji}</span>
                <div class="poi-sug-title">
                    <div class="poi-sug-name">${escapeHTML(poi.name)}</div>
                    <span class="poi-sug-badge" style="background:${poi.catColor}22;color:${poi.catColor};">${escapeHTML(poi.catName)}</span>
                </div>
                <a href="${poi.gmapsUrl}" target="_blank" rel="noopener" class="poi-gmaps-btn" title="פתח בגוגל מפות">
                    <i class="fas fa-external-link-alt"></i>
                </a>
            </div>
            <div class="poi-sug-details">
                ${poi.address ? `<div class="poi-sug-detail"><i class="fas fa-map-marker-alt"></i>${escapeHTML(poi.address)}</div>` : ''}
                ${poi.phone   ? `<div class="poi-sug-detail"><i class="fas fa-phone"></i>${escapeHTML(poi.phone)}</div>` : ''}
                ${safeWebsite ? `<div class="poi-sug-detail"><i class="fas fa-globe"></i><a href="${safeWebsite}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(safeWebsite.replace(/^https?:\/\//,'').slice(0,32))}</a></div>` : ''}
                ${poi.hours   ? `<div class="poi-sug-detail"><i class="fas fa-clock"></i>${escapeHTML(poi.hours.slice(0,50))}</div>` : ''}
            </div>
            <div class="poi-sug-match">
                <i class="fas fa-${hasMatch ? 'link' : 'question-circle'}" style="color:${hasMatch ? '#10b981' : '#f59e0b'};font-size:11px;"></i>
                <span style="font-size:11px;color:var(--text-muted);">${hasMatch ? 'בניין זוהה אוטומטית' : 'לא זוהה בניין — בחר ידנית'}</span>
            </div>
            <div class="poi-sug-actions">
                <button onclick="window.tmApprovePOI(${idx})" class="poi-btn-approve">
                    <i class="fas fa-check"></i> ${hasMatch ? 'אשר' : 'בחר בניין'}
                </button>
                <button onclick="window.tmReassignPOI(${idx})" class="poi-btn-reassign" title="שייך לבניין אחר">
                    <i class="fas fa-arrows-alt"></i>
                </button>
                <button onclick="window.tmSkipPOI(${idx})" class="poi-btn-skip" title="דלג">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

window.tmApprovePOI = function(idx) {
    const poi = _tmPOISuggestions[idx];
    if (!poi) return;
    if (!poi.matchedBldgKey) { window.tmReassignPOI(idx); return; }
    _tmApplyPOIToBuilding(poi, poi.matchedBldgKey);
    poi.status = 'approved';
    tmRenderPOISuggestions();
    tmRenderClassifySummary();
};

window.tmSkipPOI = function(idx) {
    const poi = _tmPOISuggestions[idx];
    if (poi) poi.status = 'skipped';
    tmRenderPOISuggestions();
};

window.tmSkipAllPOIs = function() {
    _tmPOISuggestions.forEach(p => { if (p.status === 'pending') p.status = 'skipped'; });
    tmRenderPOISuggestions();
};

window.tmReassignPOI = function(idx) {
    _tmReassignPoiIdx = idx;
    const poi = _tmPOISuggestions[idx];
    const hint = document.getElementById('tmClassifyHint');
    if (hint) {
        hint.innerHTML = `<i class="fas fa-crosshairs"></i> לחץ על הבניין של "${escapeHTML(poi?.name || '')}" &nbsp;<button onclick="window.tmCancelReassign()" style="background:none;border:1px solid white;border-radius:6px;color:white;padding:2px 8px;cursor:pointer;font-size:11px;font-family:inherit;">ביטול</button>`;
        hint.style.display = 'block';
    }
};

window.tmCancelReassign = function() {
    _tmReassignPoiIdx = null;
    const hint = document.getElementById('tmClassifyHint');
    if (hint) {
        hint.innerHTML = '<i class="fas fa-tag"></i> לחץ על מבנה לסיווגו';
        hint.style.display = tmCurrentTab === 'classify' ? 'block' : 'none';
    }
};

// ── Territory rendering on main map ──
function renderTerritoryOnMap() {
    if(!appSettings.territory || !appSettings.territory.polygon) {
        ['territory-fill','territory-line','territory-buildings'].forEach(id => { try { if(map.getLayer(id)) map.removeLayer(id); } catch(e){} });
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

    applyTerritoryDisplayMode(displayMode);
    renderBuildingClassifyOnMap();
}

// ── צביעת מבנים מסווגים על המפה הראשית ──
function renderBuildingClassifyOnMap() {
    // נקה שכבות קודמות
    const oldLayers = (map.getStyle()?.layers || [])
        .map(l => l.id)
        .filter(id => id.startsWith('territory-buildings'));
    oldLayers.forEach(id => { try { map.removeLayer(id); } catch(e){} });
    ['territory-buildings-src'].forEach(id => {
        try { if(map.getSource(id)) map.removeSource(id); } catch(e){}
    });

    const classify = appSettings.territory?.buildingClassify || {};
    const categories = appSettings.territory?.categories || [];
    if (Object.keys(classify).length === 0) return;

    // קבץ מפתחות לפי קטגוריה
    const byCategory = {};
    Object.entries(classify).forEach(([key, entry]) => {
        const catId = typeof entry === 'object' ? entry.catId : entry;
        if (!byCategory[catId]) byCategory[catId] = [];
        byCategory[catId].push(key);
    });

    // לכל קטגוריה — בנה filter לפי featureState boolean + שכבה נפרדת
    // קודם: סמן featureState לפי קטגוריה
    const markAndRender = () => {
        // אפס featureState לכולם
        const allRendered = map.queryRenderedFeatures({ layers: ['3d-buildings'] });
        allRendered.forEach(f => {
            if (!f.id) return;
            try { map.removeFeatureState({ source:'composite', sourceLayer:'building', id: f.id }); } catch(e){}
        });

        // סמן לפי קטגוריה
        categories.forEach(cat => {
            if (cat.id === 'irrelevant') return;
            const keys = byCategory[cat.id] || [];
            if (!keys.length) return;

            // מצא features שמרכזם תואם
            allRendered.forEach(f => {
                if (!f.id) return;
                const center = tmBuildingCenterFromFeature(f);
                if (!center) return;
                const key = `${center[0].toFixed(5)},${center[1].toFixed(5)}`;
                if (!keys.includes(key)) return;
                try {
                    map.setFeatureState(
                        { source: 'composite', sourceLayer: 'building', id: f.id },
                        { [`cat_${cat.id}`]: true }
                    );
                } catch(e) {}
            });
        });

        // עדכן paint של 3d-buildings לפי featureState booleans
        const colorExpr = ['case'];
        categories.forEach(cat => {
            if (cat.id === 'irrelevant') return;
            colorExpr.push(['boolean', ['feature-state', `cat_${cat.id}`], false]);
            colorExpr.push(cat.color);
        });
        colorExpr.push(['case', ['boolean', ['feature-state', 'hover'], false], appSettings.themeColor || '#6366f1', '#d1d5db']);

        try {
            map.setPaintProperty('3d-buildings', 'fill-extrusion-color', colorExpr);
            map.setPaintProperty('3d-buildings', 'fill-extrusion-opacity', 0.9);
        } catch(e) { console.warn('setPaintProperty error:', e); }
    };

    if (map.isStyleLoaded() && map.areTilesLoaded()) {
        markAndRender();
    } else {
        map.once('idle', markAndRender);
    }

    // עדכן כל פעם שה-map זז (tiles חדשים נטענים)
    if (!map._classifyMoveHandler) {
        map._classifyMoveHandler = () => {
            if (Object.keys(appSettings.territory?.buildingClassify || {}).length > 0) {
                clearTimeout(map._classifyMoveTimeout);
                map._classifyMoveTimeout = setTimeout(markAndRender, 500);
            }
        };
        map.on('moveend', map._classifyMoveHandler);
    }
}

// ── כרטיס מבנה לפי סיווג — לחיצה על מבנה במפה הראשית ──
function tmBuildingCenterFromFeature(f) {
    try {
        const type = f.geometry?.type;
        const coords = f.geometry?.coordinates;
        if (!coords) return null;
        let pts = type === 'Polygon' ? coords[0] : coords[0]?.[0];
        if (!pts?.length) return null;
        return [pts.reduce((s,p)=>s+p[0],0)/pts.length, pts.reduce((s,p)=>s+p[1],0)/pts.length];
    } catch(e) { return null; }
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

// ── Dialog: כרטיס קיים עם נתונים ────────────────────────────
function showBuildingConflictDialog(displayName, aptCount) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:var(--bg-card,#fff);border-radius:16px;padding:24px;max-width:380px;width:90%;direction:rtl;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,.25);">
                <div style="font-weight:700;font-size:16px;margin-bottom:6px;color:var(--text-main,#111);">כרטיס קיים עם נתונים</div>
                <div style="font-size:13px;color:var(--text-muted,#64748b);margin-bottom:20px;">
                    הכרטיס <strong>${displayName}</strong> מכיל <strong>${aptCount}</strong> משפחות.<br>הסיווג השתנה — מה לעשות עם הנתונים?
                </div>
                <div style="display:flex;flex-direction:column;gap:9px;">
                    <button data-r="noaddr" style="padding:10px 14px;border-radius:10px;border:1.5px solid var(--border-light,#e2e8f0);background:var(--bg-body,#f8fafc);cursor:pointer;font-size:13px;font-weight:600;text-align:right;font-family:inherit;">
                        <i class="fas fa-map-marker-slash" style="margin-left:8px;color:#64748b;"></i>העבר לכתובת ללא מיקום
                    </button>
                    <button data-r="move" style="padding:10px 14px;border-radius:10px;border:1.5px solid var(--border-light,#e2e8f0);background:var(--bg-body,#f8fafc);cursor:pointer;font-size:13px;font-weight:600;text-align:right;font-family:inherit;">
                        <i class="fas fa-exchange-alt" style="margin-left:8px;color:#3b82f6;"></i>העבר לכתובת אחרת...
                    </button>
                    <button data-r="delete" style="padding:10px 14px;border-radius:10px;border:1.5px solid #fee2e2;background:#fef2f2;cursor:pointer;font-size:13px;font-weight:600;text-align:right;color:#ef4444;font-family:inherit;">
                        <i class="fas fa-trash" style="margin-left:8px;"></i>מחק את הנתונים
                    </button>
                    <button data-r="keep" style="padding:10px 14px;border-radius:10px;border:none;background:none;cursor:pointer;font-size:12px;text-align:center;color:var(--text-muted,#94a3b8);font-family:inherit;">
                        השאר כפי שהוא
                    </button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelectorAll('button[data-r]').forEach(btn => {
            btn.onclick = () => { document.body.removeChild(overlay); resolve(btn.dataset.r); };
        });
    });
}

// ── יצירת/עדכון כרטיסי db מתיחום ────────────────────────────
async function syncTerritoryCardsToDb() {
    const collected  = appSettings.territory?.collectedBuildings || {};
    const classify   = appSettings.territory?.buildingClassify   || {};
    const categories = appSettings.territory?.categories || tmCategories;
    const keys = Object.keys(collected);
    if (!keys.length) return;

    const homeCoords = appSettings.homeLocation?.coords || appSettings.center;
    const proximityParam = homeCoords ? `&proximity=${homeCoords[0]},${homeCoords[1]}` : '';

    let created = 0, updated = 0;
    showToast(`מעבד ${keys.length} מבנים...`, 'info');

    for (const key of keys) {
        const bldg  = collected[key];
        const entry = classify[key];
        const catId = entry?.catId || 'residential';
        const cat   = categories.find(c => c.id === catId) || { hasCard: true, cardType: 'residential' };

        const [lng, lat] = bldg.center;
        const geom = entry?.geometry || bldg.geometry;
        const polygon = geom?.type === 'Polygon'      ? geom.coordinates[0]
                      : geom?.type === 'MultiPolygon' ? geom.coordinates[0][0]
                      : null;

        // גיאוקודינג
        let address = null;
        try {
            const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=address&language=he${proximityParam}&access_token=${mapboxgl.accessToken}`);
            const d = await r.json();
            if (d.features?.length) address = (d.features[0].place_name_he || d.features[0].place_name).split(',')[0].trim();
        } catch(e) {}

        const dbKey      = address || `@${key}`;
        const displayName = address || entry?.name || 'מבנה ללא כתובת';
        const existing   = db[dbKey];

        // כרטיס קיים — בדוק אם צריך לטפל בו
        if (existing) {
            const hasData      = (existing.apts?.length || 0) > 0;
            const catChanged   = existing.info?.category && existing.info.category !== catId;
            const nowIrrelevant = !cat.hasCard;

            if (hasData && (catChanged || nowIrrelevant)) {
                // שאל את המשתמש
                const action = await showBuildingConflictDialog(displayName, existing.apts.length);
                if (action === 'noaddr') {
                    db[NO_ADDRESS_KEY].apts.push(...existing.apts);
                    delete db[dbKey];
                } else if (action === 'move') {
                    const newAddr = await showCustomDialog({ title: 'כתובת חדשה', message: `לאיזו כתובת להעביר את המשפחות מ-"${displayName}"?`, showInput: true, showCancel: true, defaultValue: '' });
                    if (newAddr) {
                        if (!db[newAddr]) db[newAddr] = { info: { code:'', rep:'', notes:'', coords: null }, apts: [] };
                        db[newAddr].apts.push(...existing.apts);
                        delete db[dbKey];
                    } else { continue; } // ביטול — לא נוגעים
                } else if (action === 'delete') {
                    delete db[dbKey];
                } else { // keep
                    if (!existing.info.polygon && polygon) existing.info.polygon = polygon;
                    continue;
                }
            } else if (!nowIrrelevant) {
                // אין שינוי קריטי — עדכן שקט
                if (!existing.info.polygon && polygon) { existing.info.polygon = polygon; updated++; }
                if (!existing.info.category) existing.info.category = catId;
                continue;
            } else {
                continue; // לא רלוונטי + ריק — לא יוצרים כרטיס
            }
        }

        // צור כרטיס חדש (גם אחרי מחיקה למעלה)
        if (!cat.hasCard) continue;
        const subCatId = entry?.subCatId || null;
        const cardType = cat.cardType || 'residential';
        db[dbKey] = {
            info: {
                address, coords: bldg.center, polygon,
                category: catId, categoryId: catId, subCategoryId: subCatId,
                cardType, buildingName: entry?.name || '',
                institutionName: entry?.name || '',
                institutionData: {
                    phone: entry?.phone || '',
                    website: entry?.website || '',
                    hours: entry?.hours || '',
                },
                customFields: {},
                code: '', rep: '', notes: ''
            },
            apts: []
        };
        created++;

        await new Promise(r => setTimeout(r, 120));
    }

    saveDB();
    updateBuildingStatsCard();
    showToast(`✓ ${created} כרטיסים חדשים · ${updated} עודכנו`, 'success');
}

// ── Point-in-polygon ───────────────────────────────────────────
function pointInPolygon([px, py], polygon) {
    try {
        return turf.booleanPointInPolygon(turf.point([px, py]), turf.polygon([polygon]));
    } catch(e) { return false; }
}

function haversineM([lng1,lat1],[lng2,lat2]){
    try {
        return turf.distance(turf.point([lng1,lat1]), turf.point([lng2,lat2]), {units:'meters'});
    } catch(e) {
        const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
        const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
        return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
    }
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
    // FROZEN — disabled temporarily to prevent overwriting existing building markers
    showToast('סריקת דירות מושהית זמנית', 'info');
    return;

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
// ══════════════════════════════════════════════════════
// ── סטטיסטיקת מבנים לפי סיווג ─────────────────────
// ══════════════════════════════════════════════════════
let _bldgStatsChart = null;
let _bldgStatsActiveFilter = null; // null = הכל, catId = קטגוריה

function computeBuildingStats() {
    const byCategory = {};
    let total = 0;
    for (const k of Object.keys(db)) {
        if (k === '__BOARDS__' || k === 'meta' || k === NO_ADDRESS_KEY || k === '__SETTINGS__') continue;
        if (!db[k]?.info) continue;
        total++;
        const catId = db[k].info.categoryId || 'residential';
        byCategory[catId] = (byCategory[catId] || 0) + 1;
    }
    return { total, byCategory };
}

function updateBuildingStatsCard() {
    const card = document.getElementById('buildingsStatsCard');
    if (!card) return;
    const stats = computeBuildingStats();
    if (stats.total === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    // עדכן badge כולל
    const badge = document.getElementById('bldgStatsTotalBadge');
    if (badge) {
        const shown = _bldgStatsActiveFilter
            ? (stats.byCategory[_bldgStatsActiveFilter] || 0)
            : stats.total;
        badge.textContent = shown;
    }

    // עדכן תווית סינון
    const filterLabel = document.getElementById('bldgStatsFilterLabel');
    if (filterLabel) {
        if (_bldgStatsActiveFilter) {
            const cat = tmCategories.find(c => c.id === _bldgStatsActiveFilter);
            filterLabel.textContent = cat ? cat.name : '';
        } else {
            filterLabel.textContent = '';
        }
    }

    // עדכן תוכן מורחב רק אם פתוח
    const expanded = document.getElementById('bldgStatsExpanded');
    if (expanded && expanded.style.display !== 'none') {
        _renderBuildingStatsContent(stats);
    }
}

function _renderBuildingStatsContent(stats) {
    // כפתורי סינון
    const filtersEl = document.getElementById('bldgStatsFilters');
    if (filtersEl) {
        const activeCats = tmCategories.filter(c => stats.byCategory[c.id] > 0);
        filtersEl.innerHTML = `
            <button onclick="window.setBldgStatsFilter(null)"
                style="padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700; cursor:pointer; border:2px solid ${!_bldgStatsActiveFilter ? 'var(--accent)' : 'var(--border-light)'}; background:${!_bldgStatsActiveFilter ? 'var(--accent)' : 'var(--bg-body)'}; color:${!_bldgStatsActiveFilter ? 'white' : 'var(--text-muted)'};">
                הכל (${stats.total})
            </button>
            ${activeCats.map(cat => `
                <button onclick="window.setBldgStatsFilter('${cat.id}')"
                    style="padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700; cursor:pointer; border:2px solid ${_bldgStatsActiveFilter === cat.id ? cat.color : 'var(--border-light)'}; background:${_bldgStatsActiveFilter === cat.id ? cat.color + '22' : 'var(--bg-body)'}; color:${_bldgStatsActiveFilter === cat.id ? cat.color : 'var(--text-muted)'};">
                    ${cat.emoji || ''} ${cat.name} (${stats.byCategory[cat.id] || 0})
                </button>
            `).join('')}`;
    }

    // גרף עוגה
    const canvas = document.getElementById('bldgStatsChart');
    if (!canvas) return;
    const activeCats = tmCategories.filter(c => (stats.byCategory[c.id] || 0) > 0 && c.id !== 'irrelevant');
    const data = activeCats.map(c => stats.byCategory[c.id] || 0);
    const colors = activeCats.map(c => c.color);
    const labels = activeCats.map(c => `${c.emoji || ''} ${c.name}`);

    if (_bldgStatsChart) { _bldgStatsChart.destroy(); _bldgStatsChart = null; }

    const highlightCat = _bldgStatsActiveFilter;
    const displayData = highlightCat
        ? activeCats.map(c => c.id === highlightCat ? (stats.byCategory[c.id] || 0) : 0)
        : data;

    _bldgStatsChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: displayData,
                backgroundColor: highlightCat
                    ? colors.map((c, i) => activeCats[i].id === highlightCat ? c : c + '33')
                    : colors,
                borderWidth: 2,
                borderColor: 'var(--surface)',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            cutout: '62%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.raw} מבנים`
                    }
                }
            }
        }
    });

    // לג'נד מותאם
    const legendEl = document.getElementById('bldgStatsLegend');
    if (legendEl) {
        legendEl.innerHTML = activeCats.map((cat, i) => `
            <div style="display:flex; align-items:center; gap:5px; font-size:11px; color:var(--text-muted); cursor:pointer;"
                onclick="window.setBldgStatsFilter('${cat.id}')">
                <span style="width:10px;height:10px;border-radius:50%;background:${cat.color};flex-shrink:0;${highlightCat && highlightCat !== cat.id ? 'opacity:0.3;' : ''}"></span>
                ${cat.name}: <b style="color:${cat.color};">${data[i]}</b>
            </div>`).join('');
    }
}

window.toggleBuildingsStats = function() {
    const expanded = document.getElementById('bldgStatsExpanded');
    const chevron = document.getElementById('bldgStatsChevron');
    if (!expanded) return;
    const isOpen = expanded.style.display !== 'none';
    expanded.style.display = isOpen ? 'none' : 'block';
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    if (!isOpen) _renderBuildingStatsContent(computeBuildingStats());
};

window.setBldgStatsFilter = function(catId) {
    _bldgStatsActiveFilter = catId;
    updateBuildingStatsCard();
    _renderBuildingStatsContent(computeBuildingStats());
};

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
    if(s.totalUnits===0){card.style.display='none';}
    else {
        card.style.display='block';
        document.getElementById('coveragePctBig').innerText=s.pct+'%';
        document.getElementById('coverageBarMain').style.width=s.pct+'%';
        document.getElementById('coverageFamilies').innerText=s.families;
        document.getElementById('coverageTotalUnits').innerText=s.totalUnits;
        const vr=document.getElementById('coverageVerifiedRow');
        if(s.verifiedBldgs>0){vr.style.display='block';document.getElementById('coverageVerifiedCount').innerText=s.verifiedBldgs;}
        else vr.style.display='none';
    }
    updateBuildingStatsCard();
    if (typeof renderLifecycleAlerts === 'function') renderLifecycleAlerts();
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


window.switchMainView = function(viewName) {
    // Old name aliases → new names
    if (viewName === 'table') viewName = 'community';

    currentMainView = viewName;

    // Update tab active state — handles both old and new tab IDs
    document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
    const dtab = document.getElementById('tab-' + viewName);
    if (dtab) dtab.classList.add('active');
    // Also activate community tab when showing community
    if (viewName === 'community') {
        const cTab = document.getElementById('tab-community');
        if (cTab) cTab.classList.add('active');
    }

    // body view class
    document.body.classList.remove(
        'view-map','view-table','view-kanban','view-tasks','view-comm','view-events',
        'view-community','view-activity','view-globaldonations'
    );
    document.body.classList.add('view-' + viewName);

    // Container visibility
    const contMap       = document.getElementById('map-container');
    const contList      = document.getElementById('list-container');
    const contKanban    = document.getElementById('kanban-container');
    const contComm      = document.getElementById('comm-container');
    const contTasks     = document.getElementById('tasks-container');
    const contEvents    = document.getElementById('events-container');
    const contActivity  = document.getElementById('activity-container');
    const contDonations = document.getElementById('global-donations-container');

    if (contMap)       contMap.style.display       = viewName==='map'            ? 'block' : 'none';
    if (contList)      contList.style.display      = viewName==='community'       ? 'block' : 'none';
    if (contComm)      contComm.style.display      = viewName==='comm'            ? 'flex'  : 'none';
    if (contActivity)  contActivity.style.display  = viewName==='activity'        ? 'flex'  : 'none';
    if (contDonations) contDonations.style.display = viewName==='globaldonations' ? 'flex'  : 'none';

    if (viewName==='map') map.resize();
    if (viewName==='community') handleOmniSearch();
    if (viewName==='globaldonations' && typeof renderGlobalDonations === 'function') renderGlobalDonations();
    if (viewName !== 'community') handleOmniSearch();
};

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
    const map = { phone: 'calls', whatsapp: 'compose', email: 'compose', sms: 'compose' };
    switchCommMode(map[tabName] || tabName);
    if (tabName === 'sms') switchCommChannel('sms');
    else if (tabName === 'email') switchCommChannel('email');
    else if (tabName === 'whatsapp') switchCommChannel('whatsapp');
};

window.toggleMapStyle = () => { const s = map.getStyle().name.includes('Satellite'); map.setStyle(s ? 'mapbox://styles/mapbox/streets-v12' : 'mapbox://styles/mapbox/satellite-streets-v12'); showToast(s ? 'מפת רחובות' : 'מפת לוויין', 'info'); };
map.on('style.load', () => { if(!map.getLayer('3d-buildings')) map.addLayer({ 'id':'3d-buildings', 'source':'composite', 'source-layer':'building', 'filter':['==','extrude','true'], 'type':'fill-extrusion', 'minzoom':15, 'paint': { 'fill-extrusion-color':['case',['boolean',['feature-state','hover'],false],appSettings.themeColor,'#d1d5db'], 'fill-extrusion-height':['get','height'], 'fill-extrusion-base':['get','min_height'], 'fill-extrusion-opacity':0.8 } }); });

let hoveredStateId = null; const hoverPopup = new mapboxgl.Popup({ closeButton:false, closeOnClick:false, className:'hover-popup', offset:15 });
map.on('mousemove', '3d-buildings', (e) => {
    if(e.features.length>0) {
        map.getCanvas().style.cursor='pointer';
        if(hoveredStateId!==null) map.setFeatureState({source:'composite',sourceLayer:'building',id:hoveredStateId},{hover:false});
        hoveredStateId=e.features[0].id;
        map.setFeatureState({source:'composite',sourceLayer:'building',id:hoveredStateId},{hover:true});

        // בדוק אם מבנה מסווג — הצג מידע רק אם כן
        const f = e.features[0];
        const classify = appSettings.territory?.buildingClassify || {};
        const categories = appSettings.territory?.categories || [];
        try {
            const coords = f.geometry?.coordinates;
            let pts = f.geometry?.type === 'Polygon' ? coords[0] : coords[0]?.[0];
            if (pts?.length) {
                const lng = pts.reduce((s,p)=>s+p[0],0)/pts.length;
                const lat = pts.reduce((s,p)=>s+p[1],0)/pts.length;
                const key = lng.toFixed(5)+','+lat.toFixed(5);
                const entry = classify[key];
                if (entry) {
                    const catId = typeof entry === 'object' ? entry.catId : entry;
                    const name = typeof entry === 'object' ? entry.name : '';
                    const cat = categories.find(c => c.id === catId);
                    if (cat) {
                        const html = '<div style="direction:rtl;font-family:inherit;padding:2px 0;">'
                            + '<div style="display:flex;align-items:center;gap:6px;">'
                            + '<span style="width:10px;height:10px;border-radius:50%;background:'+cat.color+';display:inline-block;flex-shrink:0;"></span>'
                            + '<span style="font-weight:700;font-size:12px;color:#111;">'+cat.name+'</span>'
                            + '</div>'
                            + (name ? '<div style="font-size:11px;color:#374151;margin-top:3px;">'+name+'</div>' : '')
                            + '</div>';
                        hoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
                        return;
                    }
                }
            }
        } catch(err){}
        // מבנה לא מסווג — הצג tooltip פשוט
        hoverPopup.setLngLat(e.lngLat).setHTML('<div style="font-weight:600;font-size:12px;color:var(--accent);"><i class="fas fa-hand-pointer"></i> ניהול בניין</div>').addTo(map);
    }
});
map.on('mouseleave', '3d-buildings', () => {
    map.getCanvas().style.cursor='';
    if(hoveredStateId!==null) map.setFeatureState({source:'composite',sourceLayer:'building',id:hoveredStateId},{hover:false});
    hoveredStateId=null;
    hoverPopup.remove();
});
map.on('mousemove', (e) => {
    // הסר popup אם לא על מבנה
    const features = map.queryRenderedFeatures(e.point, { layers: ['3d-buildings'] });
    if (!features.length) hoverPopup.remove();
});
map.on('click', '3d-buildings', async (e) => {
    hoverPopup.remove();
    const clickPt = [e.lngLat.lng, e.lngLat.lat];

    // בדוק אם הנקודה בתוך פוליגון של כרטיס קיים
    for (const [key, entry] of Object.entries(db)) {
        if (key === '__BOARDS__' || key === '__SETTINGS__' || key === 'meta' || key === NO_ADDRESS_KEY) continue;
        if (!entry?.info?.polygon) continue;
        try {
            const ring = entry.info.polygon;
            const closed = ring[0][0] === ring[ring.length-1][0] && ring[0][1] === ring[ring.length-1][1] ? ring : [...ring, ring[0]];
            if (pointInPolygon(clickPt, closed)) { currentBldg = key; openBuildingModal(); return; }
        } catch(e) {}
    }

    // אין פוליגון שמור — geocoding רגיל
    try {
        const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${e.lngLat.lng},${e.lngLat.lat}.json?types=address&language=he&access_token=${mapboxgl.accessToken}`);
        const d = await r.json();
        let addr = `מיקום (${e.lngLat.lng.toFixed(4)}, ${e.lngLat.lat.toFixed(4)})`;
        if (d.features?.length) addr = (d.features[0].place_name_he || d.features[0].place_name).split(',')[0].trim();

        // שמור פוליגון של הבניין הנלחץ לשימוש עתידי
        const clicked = map.queryRenderedFeatures(e.point, { layers: ['3d-buildings'] });
        let polygon = null;
        if (clicked.length) {
            const geom = clicked[0].geometry;
            polygon = geom?.type === 'Polygon' ? geom.coordinates[0]
                    : geom?.type === 'MultiPolygon' ? geom.coordinates[0][0] : null;
        }

        currentBldg = addr;
        if (!db[currentBldg]) db[currentBldg] = { info: { code:'', rep:'', notes:'', coords:[e.lngLat.lng, e.lngLat.lat], polygon }, apts:[] };
        else if (!db[currentBldg].info.polygon && polygon) db[currentBldg].info.polygon = polygon;
        openBuildingModal();
    } catch(err) { showToast("שגיאת כתובת", "warning"); }
});

function getAllPhones(a) { return [a.fatherPhone, a.motherPhone, ...(a.childrenList||[]).map(c=>c.phone)].filter(Boolean); }
function getAllEmails(a) { return [a.fatherEmail, a.motherEmail, ...(a.childrenList||[]).map(c=>c.email)].filter(Boolean); }

window.openBuildingModal = function() {
    const b = db[currentBldg];
    // ניתוב לפי קטגוריית הבניין — מוסד או מגורים
    const bldgCatId = b.info?.categoryId || 'residential';
    const bldgCat = tmCategories.find(c => c.id === bldgCatId);
    if (bldgCat && bldgCat.cardType === 'institution') {
        openInstitutionCard(currentBldg);
        return;
    }
    const displayName = b.info?.address || b.info?.buildingName || (currentBldg.startsWith('@') ? 'מבנה ללא כתובת' : currentBldg);
    document.getElementById('bModalTitle').innerHTML = `<i class="fas fa-building" style="color:var(--accent);"></i> ${displayName}`;
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

// ══════════════════════════════════════════════════════════════
// כרטיסיית מוסד — לבניינים שאינם מגורים
// ══════════════════════════════════════════════════════════════
window.openInstitutionCard = function(bldgKey) {
    const b = db[bldgKey];
    if (!b) return;
    const catId = b.info?.categoryId || 'residential';
    const subCatId = b.info?.subCategoryId || null;
    const cat = tmCategories.find(c => c.id === catId) || tmCategories[0];
    const subCat = subCatId ? (cat.subCategories||[]).find(s => s.id === subCatId) : null;
    const displayName = b.info?.institutionName || b.info?.address || b.info?.buildingName || bldgKey;
    const data = b.info?.institutionData || {};
    const fields = cat.defaultFields || [];
    const customFields = b.info?.customFields || {};

    const fieldsHTML = fields.map(f => {
        const val = data[f.id] || '';
        if (f.type === 'textarea') return `
            <div style="margin-bottom:12px;">
                <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;">${f.label}</label>
                <textarea id="instField_${f.id}" rows="2"
                    style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border-light);border-radius:8px;font-family:inherit;font-size:13px;resize:vertical;background:var(--bg-body);color:var(--text-main);"
                >${escapeHTML(val)}</textarea>
            </div>`;
        return `
            <div style="margin-bottom:12px;">
                <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;">${f.label}</label>
                <input type="${f.type === 'phone' ? 'tel' : f.type === 'url' ? 'url' : 'text'}" id="instField_${f.id}"
                    value="${escapeHTML(val)}"
                    style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border-light);border-radius:8px;font-family:inherit;font-size:13px;background:var(--bg-body);color:var(--text-main);">
            </div>`;
    }).join('');

    const bkJ = JSON.stringify(bldgKey); // JSON.stringify בטוח ל-JS inline
    const customHTML = Object.entries(customFields).map(([k, v]) => {
        const kJ = JSON.stringify(k);
        return `
        <div style="margin-bottom:8px;display:flex;gap:6px;align-items:center;">
            <input type="text" value="${escapeHTML(k)}" placeholder="שם שדה"
                onchange="(function(el){var db_=db[${bkJ}].info.customFields; var nv=el.value; db_[nv]=db_[${kJ}]; delete db_[${kJ}]; openInstitutionCard(${bkJ});})(this)"
                style="flex:0.4;padding:6px;border:1px solid var(--border-light);border-radius:6px;font-size:12px;background:var(--bg-body);color:var(--text-main);">
            <input type="text" value="${escapeHTML(v)}" placeholder="ערך"
                onchange="db[${bkJ}].info.customFields[${kJ}]=this.value;"
                style="flex:0.6;padding:6px;border:1px solid var(--border-light);border-radius:6px;font-size:12px;background:var(--bg-body);color:var(--text-main);">
            <button onclick="delete db[${bkJ}].info.customFields[${kJ}]; openInstitutionCard(${bkJ});"
                style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:13px;"><i class="fas fa-times"></i></button>
        </div>`;
    }).join('');

    const modal = document.getElementById('institutionCardModal');
    if (!modal) return;
    document.getElementById('instModalTitle').innerHTML =
        `<span style="color:${cat.color}">${cat.emoji||'🏢'}</span> ${escapeHTML(displayName)}`;
    document.getElementById('instModalBadge').innerHTML =
        `<span style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}44;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">${cat.name}${subCat ? ' · ' + subCat.name : ''}</span>`;
    document.getElementById('instModalName').value = b.info?.institutionName || '';
    document.getElementById('instModalFields').innerHTML = fieldsHTML;
    document.getElementById('instModalCustomFields').innerHTML = customHTML;
    document.getElementById('instModalNotes').value = b.info?.notes || '';
    modal.dataset.bldgKey = bldgKey;
    modal.style.display = 'flex';
};

window.saveInstitutionCard = function() {
    const modal = document.getElementById('institutionCardModal');
    const bldgKey = modal?.dataset.bldgKey;
    if (!bldgKey || !db[bldgKey]) return;
    const cat = tmCategories.find(c => c.id === (db[bldgKey].info?.categoryId || 'residential')) || tmCategories[0];
    const fields = cat.defaultFields || [];
    if (!db[bldgKey].info) db[bldgKey].info = {};
    db[bldgKey].info.institutionName = document.getElementById('instModalName').value.trim();
    db[bldgKey].info.notes = document.getElementById('instModalNotes').value.trim();
    db[bldgKey].info.institutionData = {};
    fields.forEach(f => {
        const el = document.getElementById(`instField_${f.id}`);
        if (el) db[bldgKey].info.institutionData[f.id] = el.value;
    });
    saveDB();
    showToast('נשמר ✓', 'success');
    modal.style.display = 'none';
};

window.addInstitutionCustomField = function() {
    const modal = document.getElementById('institutionCardModal');
    const bldgKey = modal?.dataset.bldgKey;
    if (!bldgKey || !db[bldgKey]) return;
    if (!db[bldgKey].info.customFields) db[bldgKey].info.customFields = {};
    db[bldgKey].info.customFields['שדה חדש'] = '';
    openInstitutionCard(bldgKey);
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
    if (a.style && !appSettings.styles.includes(a.style)) sSel.innerHTML += `<option selected>${a.style}</option>`;
    if (!appSettings.styles.includes('מעורב')) sSel.innerHTML += `<option value="מעורב" ${a.style==='מעורב'?'selected':''}>מעורב (הורים שונים)</option>`;
    // Individual parent styles (shown when family style = מעורב)
    const _fsEl = document.getElementById('cFatherStyle'); if (_fsEl) _fsEl.dataset.current = a.fatherStyle || '';
    const _msEl = document.getElementById('cMotherStyle'); if (_msEl) _msEl.dataset.current = a.motherStyle || '';
    if (typeof toggleMixedStyle === 'function') toggleMixedStyle();

    tempTags=[...(a.tags||[])]; renderModalTags();
    tempChildren=JSON.parse(JSON.stringify(a.childrenList||[])); renderModalChildren();
    refreshMemberDropdowns();
    tempLogs=JSON.parse(JSON.stringify(a.interactions||[])); renderLogs();
    tempDonations=JSON.parse(JSON.stringify(a.donations||[])); renderDonations();
    tempTasks=JSON.parse(JSON.stringify(a.tasks||[])); renderTasks();
    tempCustom=JSON.parse(JSON.stringify(a.customData || a.customFields ||{})); renderCustomFields();
    tempBoards=JSON.parse(JSON.stringify(a.boards||{})); renderModalBoards();
    tempMilestones=JSON.parse(JSON.stringify(a.milestones||[])); renderMilestones();
    if (typeof initLifecycle === 'function') initLifecycle(a);
    if (typeof initPledges === 'function') initPledges(a);
    if (typeof _populateLogTypeSelect === 'function') _populateLogTypeSelect();
    if (typeof updateEngagementDisplay === 'function') updateEngagementDisplay(currentBldg, idx);
    
    const tStr = new Date().toISOString().split('T')[0];
    const _setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    _setVal('newLogDate', tStr); _setVal('newDonDate', tStr); _setVal('newTaskDate', tStr);
    
    switchCrmTab('details'); document.getElementById('clientModal').style.display='flex';
};

window.switchCrmTab = (tab) => {
    document.querySelectorAll('#clientModal .crm-tab, #clientModal .crm-tab-content').forEach(e=>e.classList.remove('active'));
    document.getElementById(`tabBtn-${tab}`).classList.add('active');
    document.getElementById(`crm-${tab}`).classList.add('active');
    if (tab === 'docs') renderConvDocs(currentBldg, currentAptIdx);
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

window.toggleMixedStyle = function () {
    const style    = document.getElementById('cStyle')?.value || '';
    const override = document.getElementById('parent-style-override');
    if (!override) return;
    const isMixed  = style === 'מעורב';
    override.style.display = isMixed ? 'block' : 'none';
    if (!isMixed) return;
    const baseStyles = (appSettings?.styles || []).filter(s => s !== 'מעורב');
    ['cFatherStyle', 'cMotherStyle'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const cur = sel.dataset.current || sel.value || '';
        sel.innerHTML = baseStyles.map(s => `<option value="${s}" ${cur===s?'selected':''}>${s}</option>`).join('');
    });
};
window.toggleTempTag = (t) => { markDirty(); if(tempTags.includes(t)) tempTags=tempTags.filter(x=>x!==t); else tempTags.push(t); renderModalTags(); };

window.renderModalChildren = () => {
    refreshMemberDropdowns && refreshMemberDropdowns();
    document.getElementById('childrenWrapper').innerHTML = tempChildren.map((c,i) => {
        const gEmoji = c.gender === 'boy' ? '👦' : c.gender === 'girl' ? '👧' : '🧒';
        const gNext  = c.gender === 'boy' ? 'girl' : c.gender === 'girl' ? '' : 'boy';
        const gColor = c.gender === 'boy' ? '#3b82f6' : c.gender === 'girl' ? '#ec4899' : '#94a3b8';
        return `
        <div style="display:flex; flex-direction:column; gap:5px; padding:8px; background:var(--surface); border:1px solid ${gColor}44; border-radius:6px; border-right:3px solid ${gColor};">
            <div style="display:flex; gap:5px; align-items:center;">
                <button onclick="tempChildren[${i}].gender='${gNext}';markDirty();renderModalChildren()" title="לחץ לשינוי מין" style="font-size:18px;background:none;border:none;cursor:pointer;padding:0 4px;line-height:1;">${gEmoji}</button>
                <input type="text" placeholder="שם הילד/ה" value="${c.name||''}" oninput="tempChildren[${i}].name=this.value;markDirty();refreshMemberDropdowns&&refreshMemberDropdowns()" class="inline-input" style="flex:1;">
                <input type="date" value="${c.dob||''}" onchange="tempChildren[${i}].dob=this.value;markDirty()" class="inline-input" style="flex:1;">
                <button onclick="toggleChildPhone(${i})" class="btn-icon" title="הוסף פרטי קשר" style="color:var(--accent);border:none;"><i class="fas fa-phone"></i></button>
                <button onclick="tempChildren.splice(${i},1);markDirty();renderModalChildren()" class="btn-icon" style="color:var(--danger);border:none;"><i class="fas fa-trash"></i></button>
            </div>
            ${c.showPhone || c.phone || c.email ? `<div style="display:flex; gap:5px;">
                <input type="text" placeholder="טלפון של הילד" value="${c.phone||''}" oninput="tempChildren[${i}].phone=this.value; formatPhone(this); markDirty()" class="inline-input" dir="ltr" style="text-align:right;">
                <input type="email" placeholder="מייל הילד" value="${c.email||''}" oninput="tempChildren[${i}].email=this.value; markDirty()" class="inline-input" dir="ltr" style="text-align:right;">
            </div>` : ''}
        </div>`;
    }).join('');
};
window.toggleChildPhone = (i) => { tempChildren[i].showPhone = !tempChildren[i].showPhone; renderModalChildren(); };
window.addModalChild = (gender = '') => { markDirty(); tempChildren.push({name:'',dob:'', phone:'', email:'', showPhone: false, gender}); renderModalChildren(); };

function renderCustomFields() {
    const c = document.getElementById('cCustomFieldsContainer'); c.innerHTML = '';
    appSettings.customFields.forEach(f => { c.innerHTML += `<div class="form-group"><label>${f}</label><input type="text" placeholder="הזן ערך..." value="${tempCustom[f]||''}" oninput="tempCustom['${f}']=this.value;markDirty()"></div>`; });
}

// ── Member attribution helpers ─────────────────────────────
function _getMemberLabel(key) {
    if (!key || key === 'family') return null;
    if (key === 'father') return (document.getElementById('cFather')?.value?.trim()) || 'אבא';
    if (key === 'mother') return (document.getElementById('cMother')?.value?.trim()) || 'אמא';
    if (key.startsWith('child:')) return key.slice(6);
    return key;
}

function _memberBadge(key) {
    const label = _getMemberLabel(key);
    if (!label) return '';
    return ` <span class="member-badge">${escapeHTML(label)}</span>`;
}

function _getMemberOptions(selected) {
    const father = document.getElementById('cFather')?.value?.trim();
    const mother = document.getElementById('cMother')?.value?.trim();
    const opts = [['family', 'כל המשפחה']];
    if (father) opts.push(['father', father + ' (אבא)']);
    if (mother) opts.push(['mother', mother + ' (אמא)']);
    (tempChildren || []).forEach(c => { if (c.name?.trim()) opts.push(['child:' + c.name, c.name]); });
    return opts.map(([k, l]) => `<option value="${escapeHTML(k)}" ${selected===k?'selected':''}>${escapeHTML(l)}</option>`).join('');
}

window.refreshMemberDropdowns = function() {
    ['newLogMember','newTaskMember','newDonMember','newPledgeMember','lcMember'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = _getMemberOptions(el.value || 'family');
    });
};

// ── Tasks ──────────────────────────────────────────────────
function renderTasks() {
    document.getElementById('cTasksList').innerHTML = tempTasks.length===0
        ? '<div class="empty-state"><i class="fas fa-check-double"></i><div>אין משימות פתוחות.</div></div>'
        : tempTasks.map((t,i) => `
            <div class="log-item" style="opacity:${t.done?0.6:1};">
                <div class="log-header">
                    <span style="text-decoration:${t.done?'line-through':'none'};">
                        <input type="checkbox" ${t.done?'checked':''} onchange="tempTasks[${i}].done=this.checked;markDirty();renderTasks()" style="margin-left:8px;">
                        ${escapeHTML(t.text)}${_memberBadge(t.member)}
                    </span>
                    <div>
                        <span style="color:var(--text-muted);font-size:11px;margin-left:10px;">${t.date||''}</span>
                        <button onclick="tempTasks.splice(${i},1);markDirty();renderTasks()" style="background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>`).join('');
}
window.addTask = (text='', date='') => {
    const t = text || document.getElementById('newTaskText').value;
    const d = date || document.getElementById('newTaskDate').value;
    const member = document.getElementById('newTaskMember')?.value || 'family';
    if (!t) { showToast('יש להזין תוכן למשימה', 'warning'); return; }
    markDirty();
    tempTasks.push({ text:t, date:d, done:false, member });
    document.getElementById('newTaskText').value = '';
    renderTasks();
};

// ── Interaction Logs ───────────────────────────────────────
function renderLogs() {
    document.getElementById('cLogsList').innerHTML = tempLogs.length===0
        ? '<div class="empty-state"><i class="fas fa-comments"></i><div>עוד לא נוצר קשר. זה הזמן!</div></div>'
        : tempLogs.sort((a,b)=>new Date(b.date)-new Date(a.date)).map((l,i) => {
            const tInfo = typeof getITypeInfo === 'function' ? getITypeInfo(l.interactionType || l.type) : null;
            const typeIcon = tInfo ? `<i class="fas ${tInfo.icon}" style="color:${tInfo.color};margin-left:5px;" title="${escapeHTML(tInfo.label)}"></i>` : '';
            const dirColors = { outgoing:'#7c3aed', incoming:'#0891b2', milestone:'#f59e0b' };
            const dirLabels = { outgoing:'אני אצלו', incoming:'הוא אצלי' };
            const dirBadge  = tInfo && dirLabels[tInfo.direction]
                ? `<span style="background:${dirColors[tInfo.direction]}22;color:${dirColors[tInfo.direction]};padding:1px 6px;border-radius:8px;font-size:10px;margin-right:4px;">${dirLabels[tInfo.direction]}</span>` : '';
            return `<div class="log-item">
                <div class="log-header">
                    <span>${typeIcon}${dirBadge}${escapeHTML(tInfo?.label || l.type||'')} — <span style="color:var(--text-muted);font-size:11px;">${l.date}</span>${_memberBadge(l.member)}</span>
                    <button onclick="tempLogs.splice(${i},1);markDirty();renderLogs()" style="background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fas fa-times"></i></button>
                </div>
                <div style="font-size:13px;">${escapeHTML(l.text||l.notes||'')}</div>
            </div>`;
        }).join('');
}
window.addInteractionLog = () => {
    const d      = document.getElementById('newLogDate').value;
    const typeKey= document.getElementById('newLogType').value;
    const txt    = document.getElementById('newLogText').value;
    const member = document.getElementById('newLogMember')?.value || 'family';
    if (!d || !txt) { showToast('יש למלא תאריך ותיאור', 'warning'); return; }
    const tInfo  = typeof getITypeInfo === 'function' ? getITypeInfo(typeKey) : null;
    markDirty();
    tempLogs.push({ date:d, type: tInfo?.label || typeKey, interactionType: typeKey, text:txt, member, direction: tInfo?.direction || 'milestone' });
    document.getElementById('newLogText').value = '';
    renderLogs();
    if (typeof updateEngagementDisplay === 'function') updateEngagementDisplay(currentBldg, currentAptIdx);
};

// ── Donations ──────────────────────────────────────────────
function renderDonations() {
    if (typeof _updateDonSumBox === 'function') _updateDonSumBox();
    else {
        const sum = tempDonations.reduce((a,b) => a + Number(b.amount||0), 0);
        document.getElementById('cDonationsSum').innerText = `₪${sum.toLocaleString()}`;
    }

    // Per-member breakdown
    const byMember = {};
    tempDonations.forEach(d => {
        const k = d.member && d.member !== 'family' ? d.member : null;
        if (k) byMember[k] = (byMember[k]||0) + Number(d.amount||0);
    });
    const breakdownEl = document.getElementById('cDonationsBreakdown');
    if (breakdownEl) {
        const keys = Object.keys(byMember);
        breakdownEl.innerHTML = keys.length < 2 ? '' : keys.map(k =>
            `<span class="member-badge">${escapeHTML(_getMemberLabel(k)||k)}: ₪${byMember[k].toLocaleString()}</span>`
        ).join(' ');
    }

    document.getElementById('cDonationsList').innerHTML = tempDonations.length===0
        ? '<div class="empty-state"><i class="fas fa-hand-holding-heart"></i><div>אין תרומות.</div></div>'
        : tempDonations.sort((a,b)=>new Date(b.date)-new Date(a.date)).map((d,i) => {
            const campLabel = typeof _getCampaignLabel === 'function' ? _getCampaignLabel(d.campaign) : (d.campaign||'');
            return `<div class="log-item">
                <div class="log-header">
                    <span style="color:var(--success);font-weight:600;"><i class="fas fa-shekel-sign"></i> ${Number(d.amount).toLocaleString()}${_memberBadge(d.member)}</span>
                    <span style="font-size:11px;color:var(--text-muted);">${d.date}</span>
                </div>
                <div style="font-size:13px;">${escapeHTML(d.reason||'')}
                    ${campLabel ? `<span style="font-size:11px;color:var(--accent);margin-right:6px;"><i class="fas fa-flag"></i> ${escapeHTML(campLabel)}</span>` : ''}
                    <button onclick="tempDonations.splice(${i},1);markDirty();renderDonations()" style="float:left;background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
}
window.addDonation = () => {
    const d        = document.getElementById('newDonDate').value;
    const a        = document.getElementById('newDonAmount').value;
    const r        = document.getElementById('newDonReason').value;
    const member   = document.getElementById('newDonMember')?.value || 'family';
    const campaign = document.getElementById('newDonCampaign')?.value || '';
    const pledgeId = document.getElementById('newDonPledge')?.value || '';
    if (!d || !a) { showToast('יש למלא תאריך וסכום', 'warning'); return; }
    markDirty();
    const donation = { date:d, amount:a, reason:r||'כללי', member, campaign };
    if (pledgeId) donation.pledgeId = pledgeId;
    tempDonations.push(donation);
    if (pledgeId && typeof refreshPledgesAfterDonation === 'function') refreshPledgesAfterDonation();
    if (Number(a) >= 500) { addTask(`להתקשר להגיד תודה אישית על התרומה (${a} ש"ח)`, d); showToast('נוצרה משימה להכרת הטוב! ' + getRandomCompliment(), 'info'); }
    document.getElementById('newDonAmount').value = '';
    document.getElementById('newDonReason').value = '';
    if (document.getElementById('newDonPledge')) document.getElementById('newDonPledge').value = '';
    renderDonations();
};

// ── Split family card ──────────────────────────────────────
window.splitFamilyCard = function() {
    const father = document.getElementById('cFather')?.value?.trim();
    const mother = document.getElementById('cMother')?.value?.trim();
    const members = [];
    if (father) members.push({ key:'father', label:father+' (אבא)', phone:document.getElementById('cFatherPhone')?.value, email:document.getElementById('cFatherEmail')?.value });
    if (mother) members.push({ key:'mother', label:mother+' (אמא)', phone:document.getElementById('cMotherPhone')?.value, email:document.getElementById('cMotherEmail')?.value });
    tempChildren.forEach(c => { if (c.name?.trim()) members.push({ key:'child:'+c.name, label:c.name, phone:c.phone||'', email:c.email||'' }); });
    if (!members.length) { showToast('אין בני משפחה לפיצול', 'warning'); return; }

    document.getElementById('splitMemberList').innerHTML = members.map(m =>
        `<button class="btn btn-outline split-member-btn" onclick="confirmSplitMember('${escapeHTML(m.key)}')">
            <i class="fas fa-user"></i> ${escapeHTML(m.label)}
        </button>`
    ).join('');
    document.getElementById('splitFamilyModal').style.display = 'flex';
};

window.confirmSplitMember = function(memberKey) {
    document.getElementById('splitFamilyModal').style.display = 'none';

    const father = document.getElementById('cFather')?.value?.trim();
    const mother = document.getElementById('cMother')?.value?.trim();
    const allMembers = [];
    if (father) allMembers.push({ key:'father', label:father, phone:document.getElementById('cFatherPhone')?.value||'', email:document.getElementById('cFatherEmail')?.value||'' });
    if (mother) allMembers.push({ key:'mother', label:mother, phone:document.getElementById('cMotherPhone')?.value||'', email:document.getElementById('cMotherEmail')?.value||'' });
    tempChildren.forEach(c => { if (c.name?.trim()) allMembers.push({ key:'child:'+c.name, label:c.name, phone:c.phone||'', email:c.email||'' }); });

    const member = allMembers.find(m => m.key === memberKey);
    if (!member) return;

    const splitDate  = new Date().toLocaleDateString('he-IL');
    const origFamily = document.getElementById('cFamilyName')?.value?.trim() || '';
    const origKey    = `${currentBldg}|${currentAptIdx}`;
    const origApt    = db[currentBldg]?.apts?.[currentAptIdx];

    // Interactions: member-specific + shared "family" ones (shared history)
    const newInteractions = [
        { date: splitDate, type: 'פיצול כרטיס', text: `נפצל מכרטיס משפחת ${origFamily}`, member: 'family' },
        ...tempLogs.filter(l => l.member === memberKey || !l.member || l.member === 'family')
    ];

    const newApt = {
        name: member.label,
        fatherPhone: member.phone,
        fatherEmail: member.email,
        style: origApt?.style || appSettings.styles[0],
        tags: [...(origApt?.tags||[])],
        childrenList: [],
        interactions: newInteractions,
        donations: tempDonations.filter(d => d.member === memberKey).map(d => ({...d})),
        tasks: tempTasks.filter(t => t.member === memberKey).map(t => ({...t, done:false})),
        boards: {}, customData: {}, customFields: {}, milestones: [],
        splitDate, linkedFrom: origKey,
        updatedAt: Date.now()
    };

    if (!db[NO_ADDRESS_KEY]) db[NO_ADDRESS_KEY] = { info:{}, apts:[] };
    db[NO_ADDRESS_KEY].apts.push(newApt);
    const newIdx = db[NO_ADDRESS_KEY].apts.length - 1;

    if (origApt) {
        if (!origApt.splits) origApt.splits = [];
        origApt.splits.push({ memberKey, memberName:member.label, splitDate, linkedTo:`${NO_ADDRESS_KEY}|${newIdx}` });
        origApt.updatedAt = Date.now();
    }

    saveDB(); handleOmniSearch();
    showToast(`נוצר כרטיס נפרד עבור ${member.label} ✅`, 'success');
};

window.saveClientWithAuthCheck = () => ensureAuthAndExecute(() => {
    const a = db[currentBldg].apts[currentAptIdx];
    a.name=document.getElementById('cFamilyName').value; a.num=document.getElementById('cAptNum').value; a.father=document.getElementById('cFather').value; a.mother=document.getElementById('cMother').value; 
    a.fatherPhone=document.getElementById('cFatherPhone').value; a.motherPhone=document.getElementById('cMotherPhone').value; a.phones = '';
    a.fatherEmail=document.getElementById('cFatherEmail').value; a.motherEmail=document.getElementById('cMotherEmail').value;
    a.style=document.getElementById('cStyle').value; a.notes=document.getElementById('cNotes').value;
    a.fatherStyle=document.getElementById('cFatherStyle')?.value||''; a.motherStyle=document.getElementById('cMotherStyle')?.value||'';
    a.boards={...tempBoards}; a.childrenList=[...tempChildren]; a.tags=[...tempTags]; a.interactions=[...tempLogs]; a.donations=[...tempDonations]; a.tasks=[...tempTasks]; a.customData={...tempCustom}; a.customFields=a.customData; // backward compat
    a.milestones=[...tempMilestones];
    if (typeof getLifecycleData === 'function') a.lifecycleEvents = getLifecycleData();
    if (typeof getPledgesData === 'function') a.pledges = getPledgesData();
    a.updatedAt = Date.now();
    if(a.num) ensureMinimumUnits(currentBldg, a.num);
    isDirty=false; isCreatingNew=false; saveDB(); if(window.haptic) haptic('success'); document.getElementById('clientModal').style.display='none'; showToast("עודכן בהצלחה! " + getRandomCompliment(), "success");
    handleOmniSearch();
    updateCoverageStats();
    refreshMap && refreshMap();
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
        dd.innerHTML=res.slice(0,15).map(r=>`<div class="search-item" onclick="jumpToSearchResult('${encodeURIComponent(r.bldg)}',${r.idx})"><div class="search-item-title">${escapeHTML(r.apt.name||'ללא שם')} <span style="font-size:12px;">(${r.bldg===NO_ADDRESS_KEY?'ללא כתובת':escapeHTML(r.bldg)})</span></div></div>`).join(''); 
    } else { 
        if(dd) dd.style.display='none'; 
    }
    
    refreshMap(res);
    if(currentMainView==='table' || currentMainView==='community') renderListView(res);
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

function getAptScore(a) {
    const logs = a.interactions || [];
    if (!logs.length) return -1; // -1 = no contact ever
    const rules = appSettings.scoringRules?.channels || [];
    const _typeToKey = { 'WhatsApp':'whatsapp','מייל':'email','SMS':'sms','שיחה':'phone','ביקור':'visit' };
    const now = Date.now();
    let score = 0;
    logs.forEach(log => {
        const ch = log.channel || _typeToKey[log.type] || '';
        const rule = rules.find(r => r.key === ch);
        if (!rule) return;
        const logMs = new Date(log.date).getTime();
        if (!logMs) return;
        const ageDays = (now - logMs) / 86400000;
        if (ageDays <= rule.ttlDays) score += rule.points;
    });
    return score;
}

window.getAptScore = getAptScore;

function getStatusColor(a) {
    const score = getAptScore(a);
    if (score < 0) return '#94a3b8'; // אפור — אין קשר
    const thresh = appSettings.scoringRules?.thresholds || { green: 60, orange: 25 };
    if (score >= thresh.green)  return '#10b981';
    if (score >= thresh.orange) return '#f59e0b';
    return '#ef4444';
}
window.flyToBuildingFromTable = (bEnc) => { const b=decodeURIComponent(bEnc); if(b===NO_ADDRESS_KEY||!db[b].info.coords) {showToast('ללא מיקום מפה','error');return;} switchMainView('map'); map.flyTo({center:db[b].info.coords,zoom:19,pitch:60}); setTimeout(()=>{currentBldg=b;openBuildingModal();},1200); };

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

    const _density = appSettings.tableDensity || 'normal';
    const _densityHtml = `
        <div style="display:flex; gap:2px; border:1px solid var(--border-light); border-radius:8px; padding:3px; background:var(--bg-body);" title="צפיפות תצוגה">
            <button class="density-btn${_density==='compact'?' active':''}" onclick="setDensity('compact')" title="צפוף"><i class="fas fa-grip-lines"></i></button>
            <button class="density-btn${_density==='normal'?' active':''}" onclick="setDensity('normal')" title="רגיל"><i class="fas fa-align-justify"></i></button>
            <button class="density-btn${_density==='spacious'?' active':''}" onclick="setDensity('spacious')" title="מרווח"><i class="fas fa-expand-arrows-alt"></i></button>
        </div>`;

    let html = `
        <div style="display:flex; justify-content:space-between; margin-bottom:15px; align-items:center; flex-wrap:wrap; gap:10px; width:100%;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h2 style="margin:0;"><i class="fas fa-list"></i> אינדקס קהילה</h2>
            <span style="font-size:13px; color:var(--text-muted); font-weight:600;">${arr.length} משפחות</span>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            ${smartSortHtml}
            ${_densityHtml}
            ${columnsMenuHtml}
            <button class="btn btn-success" style="width:auto; padding:8px 15px;" onclick="exportTableToCSV()"><i class="fas fa-file-excel"></i> ייצוא</button>
        </div>
    </div>`;

    if (arr.length === 0) {
        inner.innerHTML = html + `<div class="empty-state-box">
            <i class="fas fa-users" style="font-size:40px; opacity:.2; color:var(--text-muted); margin-bottom:12px;"></i>
            <h4 style="margin:0 0 6px 0; color:var(--text-muted);">אין משפחות להצגה</h4>
            <p style="color:var(--text-hint); font-size:13px; margin:0;">נסה לנקות את הסינון, או הוסף משפחה ראשונה</p>
        </div>`;
        return;
    }

    html += `<div style="width:100%; overflow-x:auto; padding-bottom:80px; padding-left: 2px; padding-right: 2px;">
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
            const smsPhone = cleanPhone.startsWith('0') ? '+972' + cleanPhone.substring(1) : '+' + cleanPhone;
            contactIcons += `<a href="tel:${cleanPhone}" class="row-action-btn" style="color:var(--success);" onclick="event.stopPropagation()" title="חייג"><i class="fas fa-phone"></i></a>`;
            contactIcons += `<a href="https://wa.me/${waPhone}" target="_blank" class="row-action-btn" style="color:#25D366;" onclick="event.stopPropagation()" title="וואטסאפ"><i class="fab fa-whatsapp"></i></a>`;
            contactIcons += `<a href="sms:${smsPhone}" class="row-action-btn" style="color:#0ea5e9;" onclick="event.stopPropagation()" title="SMS"><i class="fas fa-sms"></i></a>`;
        }
        if(emails.length > 0) {
            contactIcons += `<a href="mailto:${emails[0]}" class="row-action-btn" style="color:#ea4335;" onclick="event.stopPropagation()" title="שלח מייל"><i class="fas fa-envelope"></i></a>`;
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
            else if(col.id === 'actions') content = contactIcons ? `<div class="row-actions">${contactIcons}</div>` : '<i class="fas fa-minus" style="opacity:.25;"></i>';
            cellsHtml += `<td data-label="${escapeHTML(col.label)}">${content}</td>`;
        });

        html += `<tr oncontextmenu="showContextMenu(event,'${enc}',${r.idx})" onclick="currentBldg='${r.bldg}'; openClientCard(${r.idx})">${cellsHtml}</tr>`;
    });
    inner.innerHTML = html + `</tbody></table></div>`;
};

window.setDensity = function(d) {
    appSettings.tableDensity = d;
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    document.body.classList.remove('density-compact', 'density-spacious');
    if (d !== 'normal') document.body.classList.add('density-' + d);
    handleOmniSearch();
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
            total++; const _sk = a.style || 'ללא סגנון'; if(stats[_sk]!==undefined) stats[_sk]++; else {stats[_sk]=1; if(a.style && !appSettings.styles.includes(a.style)) appSettings.styles.push(a.style);}
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
    if(chart) { chart.destroy(); chart = null; }
    const _chartLabels = Object.keys(stats);
    if(_chartLabels.length > 0) {
        const _chartColors = _chartLabels.map(s => getColorForString(s, 'style'));
        const _cvs = document.getElementById('styleChart');
        if(_cvs) {
            _cvs.style.display = 'block';
            chart = new Chart(_cvs, { type:'doughnut', data:{labels:_chartLabels, datasets:[{data:Object.values(stats), borderWidth:0, backgroundColor:_chartColors}]}, options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'left', labels:{color:document.body.classList.contains('dark-mode')?'#fff':'#000', font:{size:11}}}}, cutout:'65%', animation:{duration:400}} });
        }
    }
    
    updateGoalTracker();
    updateHomeButton();
}

window.markTaskDoneFromDash = (bldgEnc, aptIdx, taskIdx) => {
    const bldg = decodeURIComponent(bldgEnc);
    db[bldg].apts[aptIdx].tasks[taskIdx].done = true;
    saveDB();
    handleOmniSearch();
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

    // ── Scoring rules UI ──
    _renderScoringSettingsUI();

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

function _renderScoringSettingsUI() {
    const g = document.getElementById('scoreThreshGreen');
    const o = document.getElementById('scoreThreshOrange');
    const t = appSettings.scoringRules?.thresholds || { green: 60, orange: 25 };
    if (g) g.value = t.green;
    if (o) o.value = t.orange;

    const table = document.getElementById('scoringRulesTable');
    if (!table) return;
    const channels = appSettings.scoringRules?.channels || [];
    const chColors = { visit:'#8b5cf6', phone:'#10b981', whatsapp:'#25D366', sms:'#0ea5e9', email:'#ea4335' };

    table.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 80px 80px;gap:6px;padding:4px 8px;font-size:11px;font-weight:700;color:var(--text-muted);">
            <span>סוג קשר</span><span style="text-align:center;">נקודות</span><span style="text-align:center;">תוקף (ימים)</span>
        </div>` +
    channels.map(ch => `
        <div class="scoring-row" data-key="${ch.key}" style="display:grid;grid-template-columns:1fr 80px 80px;gap:6px;align-items:center;padding:6px 8px;background:var(--surface);border-radius:8px;border:1px solid var(--border-light);">
            <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
                <span style="width:10px;height:10px;border-radius:50%;background:${chColors[ch.key]||'var(--accent)'};flex-shrink:0;display:inline-block;"></span>
                ${escapeHTML(ch.label)}
            </div>
            <input type="number" class="inline-input score-pts" value="${ch.points}" min="0" max="999" style="padding:4px 6px;text-align:center;font-weight:700;color:var(--accent);">
            <input type="number" class="inline-input score-ttl" value="${ch.ttlDays}" min="1" max="365" style="padding:4px 6px;text-align:center;">
        </div>`
    ).join('');
}

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

    // Scoring rules
    const gEl = document.getElementById('scoreThreshGreen');
    const oEl = document.getElementById('scoreThreshOrange');
    if (gEl && oEl) {
        if (!appSettings.scoringRules) appSettings.scoringRules = { thresholds: {}, channels: [] };
        appSettings.scoringRules.thresholds.green  = parseInt(gEl.value)  || 60;
        appSettings.scoringRules.thresholds.orange = parseInt(oEl.value) || 25;
        document.querySelectorAll('.scoring-row').forEach(row => {
            const key = row.dataset.key;
            const ch = appSettings.scoringRules.channels.find(c => c.key === key);
            if (!ch) return;
            const pts = row.querySelector('.score-pts');
            const ttl = row.querySelector('.score-ttl');
            if (pts) ch.points  = parseInt(pts.value)  || ch.points;
            if (ttl) ch.ttlDays = parseInt(ttl.value) || ch.ttlDays;
        });
    }

    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    saveDB();
    populateFilterDropdowns();
    document.getElementById('settingsModal').style.display = 'none';
    updateHomeButton();
    renderTerritoryOnMap();
    updateCoverageStats();
    refreshMap();
    handleOmniSearch();
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
    const text = (document.getElementById('commMessageText') || document.getElementById('waMessageText'))?.value || '';
    if(!text) return showToast('יש להזין תוכן להודעה', 'warning');
    if(commRecipients.length === 0) return showToast('יש להוסיף נמענים קודם!', 'error');

    const validRecipients = commRecipients.filter(r => r.phone);
    if(validRecipients.length === 0) return showToast('לא נמצאו טלפונים — הוסף מספר טלפון לאיש הקשר', 'error');

    if(validRecipients.length > 1 || text.includes('[שם]')) {
        startCommQueue('whatsapp', '', text, validRecipients);
        commRecipients = [];
        _updateCommRecipCount();
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
            if(window.autoLogSentMessage) autoLogSentMessage('whatsapp', commRecipients.filter(r=>r.key), text);
            commRecipients = [];
            _updateCommRecipCount();
        }
    }
};

window.sendCommEmail = async () => {
    const subjInput = document.getElementById('emSubject')?.value || 'הודעה מהקהילה';
    const textInput = (document.getElementById('commMessageText') || document.getElementById('emMessageText'))?.value || '';
    
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
            _updateCommRecipCount();
            return;
        }
    }

    const emails = validRecipients.map(r => r.email);
    const finalSubj = subjInput.replace(/\[\s*שם\s*\]/g, '');
    const finalText = textInput.replace(/\[\s*שם\s*\]/g, 'משפחה יקרה');
    const logRecipients = commRecipients.filter(r=>r.key);

    const prov = appSettings.emailProvider;
    if (!prov) {
        window._pendingEmailData = { subj: finalSubj, text: finalText, emails, logRecipients, rawText: textInput };
        const m = document.getElementById('emailProviderModal');
        if (m) m.style.display = 'flex';
        return;
    }
    _doSendEmail(prov, finalSubj, finalText, emails);
    if(window.autoLogSentMessage) autoLogSentMessage('email', logRecipients, textInput);
    commRecipients = [];
    _updateCommRecipCount();
};

// שולח מייל בודד דרך Gmail API (ללא פתיחת חלון)
async function _sendOneGmailAPI(toEmail, subj, body) {
    if (!accessToken) return false;
    const msg = [
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        `To: ${toEmail}`,
        `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subj)))}?=`,
        '',
        body,
    ].join('\r\n');
    const raw = btoa(unescape(encodeURIComponent(msg)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
    });
    if (res.status === 403) {
        // scope חסר — בקש הרשאה מחדש
        showToast('נדרשת הרשאה לשליחת מיילים — מפנה לאישור...', 'warning');
        setTimeout(() => {
            if (window.tokenClient) window.tokenClient.requestAccessToken({ prompt: 'consent' });
        }, 1500);
        return 'reauth';
    }
    return res.ok;
}

window._doSendEmail = async function(prov, subj, text, emails) {
    // Gmail — שלח ישיר דרך API ללא פתיחת חלון
    if (prov === 'gmail' && accessToken) {
        setSyncStatus('wait', 'שולח מיילים...');
        let sent = 0, failed = 0, reauth = false;
        for (const email of emails) {
            const result = await _sendOneGmailAPI(email, subj, text);
            if (result === 'reauth') { reauth = true; break; }
            result ? sent++ : failed++;
            if (emails.length > 1) await new Promise(r => setTimeout(r, 300));
        }
        setSyncStatus('ok', 'מסונכרן');
        if (!reauth) showToast(`✅ ${sent} מיילים נשלחו${failed ? `, ${failed} נכשלו` : ''}`, sent > 0 ? 'success' : 'error');
        return;
    }
    // ספקים אחרים — פתח ממשק כתיבה
    const bcc = emails.join(',');
    const su = encodeURIComponent(subj), bo = encodeURIComponent(text);
    let ok = true;
    switch(prov) {
        case 'gmail':
            ok = !!window.open(`https://mail.google.com/mail/?view=cm&fs=1&tf=1&bcc=${encodeURIComponent(bcc)}&su=${su}&body=${bo}`, '_blank');
            break;
        case 'outlook':
            window.open(`https://outlook.live.com/mail/0/deeplink/compose?subject=${su}&body=${bo}`, '_blank');
            break;
        case 'yahoo':
            window.open(`https://compose.mail.yahoo.com/?bcc=${encodeURIComponent(bcc)}&subject=${su}&body=${bo}`, '_blank');
            break;
        default:
            window.location.href = `mailto:?bcc=${bcc}&subject=${subj}&body=${text}`;
    }
    if (!ok) { showCustomDialog({ title: 'שגיאת דפדפן', message: 'אנא אשר חלונות קופצים.', showCancel: false }); return; }
    showToast('נפתח ממשק שליחת מייל ✅', 'success');
};

window.pickEmailProvider = function(prov) {
    const remember = document.getElementById('emailProvRemember')?.checked;
    if (remember) { appSettings.emailProvider = prov; localStorage.setItem('crm_prefs', JSON.stringify(appSettings)); }
    document.getElementById('emailProviderModal').style.display = 'none';
    const d = window._pendingEmailData;
    if (!d) return;
    window._pendingEmailData = null;
    _doSendEmail(prov, d.subj, d.text, d.emails);
    if(window.autoLogSentMessage) autoLogSentMessage('email', d.logRecipients, d.rawText);
    commRecipients = [];
    renderRecipientsList('email');
    const el = document.getElementById('emRecipientCount');
    if (el) el.innerText = 0;
};

window.resetEmailProvider = function() {
    delete appSettings.emailProvider;
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    showToast('בחירת ספק מייל אופסה — תישאל בפעם הבאה', 'info');
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

// --- תקשורת ---
let _currentCommChannel = 'whatsapp';

// --- תבניות ---
let commRecipients = [];
// Bridge scope gap: audience.js writes window.commRecipients, but app.js functions
// close over the local `let` above. This proxy keeps both references in sync.
Object.defineProperty(window, 'commRecipients', {
    get: () => commRecipients,
    set: (v) => { commRecipients = Array.isArray(v) ? v : []; },
    configurable: true,
});

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
            let [b,i] = v.split('|'); let a = db[b]?.apts?.[parseInt(i)];
            if(a) {
                const r = { name: a.name||'ללא שם', phone: getAllPhones(a)[0]||'', email: getAllEmails(a)[0]||'', key: v };
                commRecipients.push(r);
                // Reflect in sharedAudience so audience panel shows selections
                if (window.sharedAudience && !window.sharedAudience.some(s => s.key === v))
                    window.sharedAudience.push(r);
            }
        });
        bulkSelection = [];
        // Re-render audience panel so checkboxes reflect new selection
        if (typeof openAudienceBuilder === 'function') openAudienceBuilder();
    }
    _loadCommTemplates && _loadCommTemplates();
    _updateCommRecipCount();
};

window.renderRecipientsList = (type) => {
    _updateCommRecipCount();
};

window.removeRecipient = (idx, type) => {
    commRecipients.splice(idx, 1);
    _updateCommRecipCount();
};

window.addRecipientManually = async (type) => {
    const ch = type || _currentCommChannel;
    const name = await showCustomDialog({ title: 'הוסף נמען', message: 'שם המשפחה:', showInput: true, showCancel: true });
    if(!name) return;
    const fieldLabel = ch === 'email' ? 'כתובת מייל:' : 'מספר טלפון:';
    const contact = await showCustomDialog({ title: 'הוסף נמען', message: fieldLabel, showInput: true, showCancel: true });
    if(!contact) return;
    commRecipients.push({ name: name.trim(), phone: ch === 'email' ? '' : contact.trim(), email: ch === 'email' ? contact.trim() : '', key: '' });
    _updateCommRecipCount();
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
    const idx = document.getElementById('waTemplateSelect')?.value;
    if(idx !== '') {
        const t = (appSettings.templates[idx]||{}).text || '';
        const ta = document.getElementById('commMessageText') || document.getElementById('waMessageText');
        if(ta) ta.value = t;
    }
};

window.previewEmTemplate = () => {
    const idx = document.getElementById('emTemplateSelect')?.value;
    if(idx !== '') {
        const t = (appSettings.templates[idx]||{}).text || '';
        const ta = document.getElementById('commMessageText') || document.getElementById('emMessageText');
        if(ta) ta.value = t;
    }
};

// ══════════════════════════════════════════════════════════════
// COMM HUB — New unified functions
// ══════════════════════════════════════════════════════════════

window.switchCommMode = function(mode) {
    document.querySelectorAll('.comm-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.querySelectorAll('.comm-mode-content').forEach(el => el.classList.remove('active'));
    const target = document.getElementById('comm-mode-' + mode);
    if (target) target.classList.add('active');
    if (mode === 'calls')     renderCallList && renderCallList();
    if (mode === 'logs')      renderCommLogs && renderCommLogs();
    if (mode === 'templates') renderTemplates && renderTemplates();
    if (mode === 'docs')      renderAllConvDocs && renderAllConvDocs();
    if (mode === 'compose')   _restoreCommDraft();
    updateCommStats && updateCommStats();
};

window.switchCommChannel = function(ch) {
    _currentCommChannel = ch;
    document.querySelectorAll('.comm-ch-btn').forEach(b => b.classList.toggle('active', b.dataset.ch === ch));
    const subjectRow = document.getElementById('commSubjectRow');
    if (subjectRow) subjectRow.style.display = ch === 'email' ? 'block' : 'none';
    const smsBar = document.getElementById('smsCharCounter');
    if (smsBar) smsBar.style.display = ch === 'sms' ? 'block' : 'none';
    const smsBadge = document.getElementById('smsProviderBadge');
    const smsSvcBtn = document.getElementById('smsSvcBtn');
    if (smsBadge) smsBadge.style.display = ch === 'sms' ? 'inline' : 'none';
    if (smsSvcBtn) smsSvcBtn.style.display = ch === 'sms' ? 'inline-flex' : 'none';
    _updateCommRecipCount();
    _loadCommTemplates();
};

window._updateCommRecipCount = function() {
    const ch = _currentCommChannel;
    let total = 0, missing = 0;
    const src = ch === 'sms' ? (window._smsR || []) : (window.commRecipients || []);
    const field = ch === 'email' ? 'email' : 'phone';

    if (ch === 'sms') {
        total = src.filter(r => r.phone).length;
        missing = src.filter(r => !r.phone).length;
    } else if (ch === 'email') {
        total = src.filter(r => r.email).length;
        missing = src.filter(r => !r.email).length;
    } else {
        total = src.filter(r => r.phone).length;
        missing = src.filter(r => !r.phone).length;
    }

    const countEl = document.getElementById('commRecipCount');
    if (countEl) countEl.textContent = total;

    const warn = document.getElementById('commMissingWarn');
    if (warn) {
        if (missing > 0 && src.length > 0) {
            const fieldLabel = ch === 'email' ? 'מייל' : 'טלפון';
            warn.textContent = `⚠️ ${missing} חסרי ${fieldLabel}`;
            warn.style.display = 'inline';
        } else {
            warn.style.display = 'none';
        }
    }

    const chips = document.getElementById('commRecipChips');
    if (chips) {
        const shown = src.slice(0, 5);
        chips.innerHTML = shown.map(r => `<span class="comm-recip-chip">${escapeHTML(r.name)}</span>`).join('')
            + (src.length > 5 ? `<span class="comm-recip-chip">+${src.length - 5}</span>` : '');
    }

    // Send button color by channel
    const btn = document.getElementById('commSendBtn');
    if (btn) {
        const colors = { whatsapp: '#25D366', email: '#ea4335', sms: '#0ea5e9' };
        btn.style.background = colors[ch] || '';
        btn.style.borderColor = colors[ch] || '';
    }
};

window._loadCommTemplates = function() {
    const sel = document.getElementById('commTemplateSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- בחר תבנית --</option>' +
        (appSettings.templates || []).map((t, i) =>
            `<option value="${i}">${escapeHTML(t.title)}</option>`
        ).join('');
};

window.applyCommTemplate = function() {
    const sel = document.getElementById('commTemplateSelect');
    const ta  = document.getElementById('commMessageText');
    if (!sel || !ta) return;
    const idx = parseInt(sel.value);
    if (!isNaN(idx) && appSettings.templates?.[idx]) {
        ta.value = appSettings.templates[idx].text;
        onCommTextInput(ta);
    }
};

window.onCommTextInput = function(ta) {
    // SMS char counter
    const counter = document.getElementById('smsCharCounter');
    const num     = document.getElementById('smsCharNum');
    const multi   = document.getElementById('smsMultiPart');
    if (counter && _currentCommChannel === 'sms') {
        const len = ta.value.length;
        if (num) num.textContent = len;
        if (num) num.style.color = len > 160 ? 'var(--danger)' : 'var(--text-muted)';
        if (multi) {
            if (len > 160) {
                const parts = Math.ceil(len / 153);
                multi.textContent = `${parts} חלקים`;
                multi.style.display = 'inline';
            } else {
                multi.style.display = 'none';
            }
        }
        counter.style.display = 'block';
    }
    // Draft auto-save
    try {
        localStorage.setItem('comm_draft', JSON.stringify({
            ch: _currentCommChannel,
            text: ta.value,
            subject: document.getElementById('emSubject')?.value || ''
        }));
    } catch(e) {}
};

window._restoreCommDraft = function() {
    try {
        const saved = JSON.parse(localStorage.getItem('comm_draft') || 'null');
        if (!saved) return;
        if (saved.ch) switchCommChannel(saved.ch);
        const ta = document.getElementById('commMessageText');
        if (ta && saved.text) ta.value = saved.text;
        const subj = document.getElementById('emSubject');
        if (subj && saved.subject) subj.value = saved.subject;
    } catch(e) {}
};

window.sendCommMessage = function() {
    const text = document.getElementById('commMessageText')?.value?.trim();
    if (!text) return showToast('יש להזין תוכן', 'warning');
    // Sync hidden legacy textareas so old send functions still work
    const smsTA = document.getElementById('smsMessageText');
    if (smsTA) smsTA.value = text;
    if (_currentCommChannel === 'whatsapp') sendCommWhatsApp();
    else if (_currentCommChannel === 'email') sendCommEmail();
    else if (_currentCommChannel === 'sms')   sendCommSMS();
};

window.showCommPreview = function() {
    const text = document.getElementById('commMessageText')?.value?.trim();
    if (!text) return showToast('יש להזין תוכן תחילה', 'warning');
    const ch = _currentCommChannel;
    const src = ch === 'sms' ? (window._smsR || []) : (window.commRecipients || []);
    if (!src.length) return showToast('אין נמענים לתצוגה מקדימה', 'warning');

    const samples = src.slice(0, 3);
    const chLabel = { whatsapp: 'WhatsApp', email: 'מייל', sms: 'SMS' }[ch] || ch;
    const chColor = { whatsapp: '#25D366', email: '#ea4335', sms: '#0ea5e9' }[ch] || 'var(--accent)';

    const content = document.getElementById('commPreviewContent');
    if (!content) return;
    content.innerHTML = samples.map(r => {
        const msg = text.replace(/\[\s*שם\s*\]/g, r.name || 'משפחה יקרה');
        return `<div style="background:var(--bg-body);border-radius:10px;padding:12px;border:1px solid var(--border-light);">
            <div style="font-size:11px;font-weight:700;color:${chColor};margin-bottom:6px;">
                <i class="fas fa-user"></i> ${escapeHTML(r.name)} — ${chLabel}
            </div>
            <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;">${escapeHTML(msg)}</div>
        </div>`;
    }).join('');

    if (src.length > 3) {
        content.innerHTML += `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px;">
            ועוד ${src.length - 3} נמענים...
        </div>`;
    }

    document.getElementById('commPreviewModal').style.display = 'flex';
};

window.addManualCommRecipient = async function() {
    const ch = _currentCommChannel;
    const name = await showCustomDialog({ title: 'הוסף נמען', message: 'שם המשפחה:', showInput: true, showCancel: true });
    if (!name) return;
    const fieldLabel = ch === 'email' ? 'כתובת מייל:' : 'מספר טלפון:';
    const contact = await showCustomDialog({ title: 'הוסף נמען', message: fieldLabel, showInput: true, showCancel: true });
    if (!contact) return;
    if (ch === 'sms') {
        if (!window._smsR) window._smsR = [];
        window._smsR.push({ name: name.trim(), phone: contact.trim(), key: null });
    } else {
        commRecipients.push({
            name: name.trim(),
            phone: ch === 'whatsapp' ? contact.trim() : '',
            email: ch === 'email'    ? contact.trim() : '',
            key: ''
        });
    }
    _updateCommRecipCount();
};

// ══════════════════════════════════════════════════════════════
// CONV DOCS — תיעוד שיחות (documentation hub)
// ══════════════════════════════════════════════════════════════

const _docTypeLabels = { summary: 'סיכום', thread: 'שרשור', transcript: 'תמליל', recording_link: 'הקלטה' };
const _docTypeBadgeColors = { summary: '#6366f1', thread: '#25D366', transcript: '#f59e0b', recording_link: '#0ea5e9' };
const _docChanIcons = {
    phone:   { icon: 'fa-phone fas',    color: 'var(--success)', label: 'שיחה' },
    whatsapp:{ icon: 'fa-whatsapp fab', color: '#25D366',        label: 'WhatsApp' },
    email:   { icon: 'fa-envelope fas', color: '#ea4335',        label: 'מייל' },
    visit:   { icon: 'fa-walking fas',  color: 'var(--accent)', label: 'ביקור' },
    general: { icon: 'fa-file fas',     color: 'var(--text-muted)', label: 'כללי' }
};

let _docsChannelFilter = '';
let _docsTypeFilter = '';
let _docsSearch = '';

window.setDocsChannelFilter = function(f) {
    _docsChannelFilter = f;
    document.querySelectorAll('[data-df]').forEach(b => b.classList.toggle('active', b.dataset.df === f));
    renderAllConvDocs();
};
window.setDocsTypeFilter = function(f) {
    _docsTypeFilter = f;
    document.querySelectorAll('[data-dt]').forEach(b => b.classList.toggle('active', b.dataset.dt === f));
    renderAllConvDocs();
};
window.setDocsSearch = function(v) { _docsSearch = v; renderAllConvDocs(); };

window.renderAllConvDocs = function() {
    const c = document.getElementById('allDocsTimeline');
    if (!c) return;

    let entries = [];
    Object.keys(db).forEach(bldg => {
        if (bldg === '__BOARDS__' || bldg === '__SETTINGS__' || bldg === 'meta') return;
        (db[bldg]?.apts || []).forEach((apt, idx) => {
            (apt.convDocs || []).forEach(doc => entries.push({ bldg, idx, apt, doc }));
        });
    });

    entries.sort((a, b) => (b.doc.createdAt || 0) - (a.doc.createdAt || 0));

    if (_docsChannelFilter) entries = entries.filter(e => e.doc.channel === _docsChannelFilter);
    if (_docsTypeFilter)    entries = entries.filter(e => e.doc.docType  === _docsTypeFilter);
    if (_docsSearch) {
        const q = _docsSearch.toLowerCase();
        entries = entries.filter(e =>
            (e.apt.name||'').toLowerCase().includes(q) ||
            (e.doc.title||'').toLowerCase().includes(q) ||
            (e.doc.body||'').toLowerCase().includes(q)
        );
    }

    const counter = document.getElementById('docsCount');
    if (counter) counter.textContent = entries.length;

    if (entries.length === 0) {
        c.innerHTML = `<div class="empty-state" style="padding:40px 0;">
            <i class="fas fa-folder-open" style="font-size:36px;opacity:.3;"></i>
            <h4>אין תיעודים עדיין</h4>
            <p style="color:var(--text-muted);">פתח כרטיס משפחה → לשונית "תיעוד" → הוסף תיעוד</p>
        </div>`;
        return;
    }

    c.innerHTML = entries.map(({ bldg, idx, apt, doc }) => {
        const ci = _docChanIcons[doc.channel] || _docChanIcons.general;
        const typeLabel = _docTypeLabels[doc.docType] || doc.docType || '';
        const typeBadgeColor = _docTypeBadgeColors[doc.docType] || 'var(--accent)';
        const safeFamily = escapeHTML(apt.name || 'ללא שם');
        const safeTitle  = escapeHTML(doc.title || '');
        const safePreview= escapeHTML((doc.body || '').substring(0, 130));
        const safeDate   = escapeHTML(doc.date || '');
        const recLink = doc.recordingUrl
            ? `<a href="${escapeHTML(doc.recordingUrl)}" target="_blank" onclick="event.stopPropagation();" class="doc-rec-link"><i class="fas fa-headphones"></i> האזן להקלטה</a>`
            : '';

        return `<div class="conv-doc-entry" onclick="currentBldg='${escapeHTML(bldg)}'; openClientCard(${idx}); setTimeout(()=>switchCrmTab('docs'),350)">
            <div class="conv-doc-icon" style="background:${ci.color}22;color:${ci.color};"><i class="${ci.icon}"></i></div>
            <div class="conv-doc-body">
                <div class="conv-doc-header">
                    <span class="conv-doc-name">${safeFamily}</span>
                    <span class="conv-doc-type-badge" style="background:${typeBadgeColor}22;color:${typeBadgeColor};">${typeLabel}</span>
                    <span class="conv-doc-date">${safeDate}</span>
                </div>
                ${safeTitle ? `<div class="conv-doc-title">${safeTitle}</div>` : ''}
                ${safePreview ? `<div class="conv-doc-preview">${safePreview}${(doc.body||'').length > 130 ? '...' : ''}</div>` : ''}
                ${recLink}
            </div>
        </div>`;
    }).join('');
};

// ── Per-family docs (client card tab) ─────────────────────

window.renderConvDocs = function(bldg, idx) {
    const c = document.getElementById('convDocsList');
    if (!c || !bldg) return;
    const apt = db[bldg]?.apts?.[idx];
    if (!apt) return;
    const docs = apt.convDocs || [];

    if (docs.length === 0) {
        c.innerHTML = `<div class="empty-state" style="padding:24px 0;"><i class="fas fa-folder-open" style="font-size:28px;opacity:.3;"></i>
            <div style="margin-top:8px;font-size:13px;color:var(--text-muted);">אין תיעודים עבור משפחה זו</div></div>`;
        return;
    }

    const sorted = [...docs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    c.innerHTML = sorted.map((doc, i) => {
        const ci = _docChanIcons[doc.channel] || _docChanIcons.general;
        const typeLabel = _docTypeLabels[doc.docType] || doc.docType || '';
        const typeBadgeColor = _docTypeBadgeColors[doc.docType] || 'var(--accent)';
        const safeTitle   = escapeHTML(doc.title || '');
        const safeDate    = escapeHTML(doc.date || '');
        const bodyPreview = escapeHTML((doc.body || '').substring(0, 150));
        const bodyFull    = escapeHTML(doc.body || '');
        const docIdx = docs.indexOf(doc);
        const recLink = doc.recordingUrl
            ? `<a href="${escapeHTML(doc.recordingUrl)}" target="_blank" onclick="event.stopPropagation();" class="doc-rec-link"><i class="fas fa-headphones"></i> האזן</a>`
            : '';

        return `<div class="conv-doc-card" id="convDocCard-${docIdx}">
            <div class="conv-doc-card-header" onclick="toggleDocExpand(${docIdx})">
                <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                    <span style="width:28px;height:28px;border-radius:50%;background:${ci.color}22;color:${ci.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;"><i class="${ci.icon}"></i></span>
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                            ${safeTitle ? `<span style="font-weight:700;font-size:13px;">${safeTitle}</span>` : ''}
                            <span style="font-size:11px;padding:1px 6px;border-radius:8px;background:${typeBadgeColor}22;color:${typeBadgeColor};">${typeLabel}</span>
                            <span style="font-size:11px;color:var(--text-muted);">${safeDate}</span>
                        </div>
                        ${bodyPreview ? `<div class="conv-doc-preview" id="convDocPreview-${docIdx}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${bodyPreview}${(doc.body||'').length > 150 ? '...' : ''}</div>` : ''}
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                    ${recLink}
                    <button class="btn-icon" style="color:var(--danger);padding:2px 6px;font-size:12px;" onclick="event.stopPropagation();deleteConvDoc('${escapeHTML(bldg)}',${idx},${docIdx})" title="מחק"><i class="fas fa-trash"></i></button>
                    <i class="fas fa-chevron-down" id="convDocChevron-${docIdx}" style="font-size:11px;color:var(--text-muted);transition:transform 0.2s;"></i>
                </div>
            </div>
            <div id="convDocFull-${docIdx}" style="display:none;padding:10px 12px;border-top:1px solid var(--border-light);font-size:13px;line-height:1.7;white-space:pre-wrap;">${bodyFull}</div>
        </div>`;
    }).join('');
};

window.toggleDocExpand = function(docIdx) {
    const full    = document.getElementById(`convDocFull-${docIdx}`);
    const preview = document.getElementById(`convDocPreview-${docIdx}`);
    const chevron = document.getElementById(`convDocChevron-${docIdx}`);
    if (!full) return;
    const open = full.style.display !== 'none';
    full.style.display    = open ? 'none' : 'block';
    if (preview) preview.style.display = open ? '' : 'none';
    if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
};

window.openAddConvDoc = function() {
    const form = document.getElementById('addConvDocForm');
    if (!form) return;
    const dateEl = document.getElementById('newDocDate');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
    document.getElementById('newDocTitle').value = '';
    document.getElementById('newDocBody').value = '';
    const recUrl = document.getElementById('newDocRecordingUrl');
    if (recUrl) recUrl.value = '';
    document.getElementById('newDocChannel').value = 'phone';
    document.getElementById('newDocType').value = 'summary';
    toggleDocRecordingUrl();
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.cancelAddConvDoc = function() {
    const form = document.getElementById('addConvDocForm');
    if (form) form.style.display = 'none';
};

window.toggleDocRecordingUrl = function() {
    const typeEl = document.getElementById('newDocType');
    const row    = document.getElementById('newDocRecordingRow');
    if (!typeEl || !row) return;
    row.style.display = typeEl.value === 'recording_link' ? 'block' : 'none';
};

window.saveConvDoc = function() {
    const date    = document.getElementById('newDocDate')?.value || '';
    const channel = document.getElementById('newDocChannel')?.value || 'general';
    const docType = document.getElementById('newDocType')?.value || 'summary';
    const title   = document.getElementById('newDocTitle')?.value?.trim() || '';
    const body    = document.getElementById('newDocBody')?.value?.trim() || '';
    const recUrl  = document.getElementById('newDocRecordingUrl')?.value?.trim() || '';

    if (docType !== 'recording_link' && !body) { showToast('יש להזין תוכן', 'warning'); return; }
    if (docType === 'recording_link' && !recUrl && !body) { showToast('יש להזין קישור להקלטה', 'warning'); return; }

    const apt = db[currentBldg]?.apts?.[currentAptIdx];
    if (!apt) return;
    if (!apt.convDocs) apt.convDocs = [];

    apt.convDocs.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        date, channel, docType, title, body,
        recordingUrl: recUrl,
        createdAt: Date.now()
    });
    apt.updatedAt = Date.now();
    saveDB();
    cancelAddConvDoc();
    renderConvDocs(currentBldg, currentAptIdx);
    showToast('התיעוד נשמר ✅', 'success');
};

window.deleteConvDoc = async function(bldg, idx, docIdx) {
    const ok = await showCustomDialog({ title: 'מחיקת תיעוד', message: 'האם למחוק תיעוד זה?', showCancel: true });
    if (!ok) return;
    const apt = db[bldg]?.apts?.[idx];
    if (!apt?.convDocs) return;
    apt.convDocs.splice(docIdx, 1);
    apt.updatedAt = Date.now();
    saveDB();
    renderConvDocs(bldg, idx);
    showToast('התיעוד נמחק', 'info');
};

window._offerStatusUpdate = async function(count) {
    if (!count) return;
    const yes = await showCustomDialog({
        title: 'עדכון סטטוס',
        message: `לסמן את ${count} המשפחות ששלחת להן כ"ירוק"?`,
        showCancel: true
    });
    if (!yes) return;
    let updated = 0;
    const src = _currentCommChannel === 'sms' ? (window._smsR || []) : (window.commRecipients || []);
    src.forEach(r => {
        if (!r.key) return;
        const [bldg, idxStr] = r.key.split('|');
        const apt = db[bldg]?.apts?.[parseInt(idxStr)];
        if (apt) { apt.status = 'green'; apt.updatedAt = Date.now(); updated++; }
    });
    if (updated > 0) { saveDB(); handleOmniSearch(); showToast(`${updated} משפחות סומנו ירוק ✅`, 'success'); }
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
window._syncTextInterval = setInterval(() => {
    const el = document.getElementById('sync-text');
    if(el && el.innerText !== 'שומר...' && el.innerText !== 'שואב...') {
        el.innerText = getLastSyncText();
    }
}, 5000);

// סנכרון אוטומטי כל 30 שניות — רק אם המשתמש לא באמצע עריכה והטוקן בתוקף
window._autoSyncInterval = setInterval(() => {
    const session = JSON.parse(localStorage.getItem('gdrive_session'));
    const isTokenValid = session && session.expiresAt > (new Date().getTime() + 60000);
    if(accessToken && !isDirty && isTokenValid) {
        syncWithDrive();
    } else if (!accessToken) {
        clearInterval(window._autoSyncInterval);
        clearInterval(window._syncTextInterval);
    }
}, 30000);

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

// ════════════════════════════════════════════════════════════
