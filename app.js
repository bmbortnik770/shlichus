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
if(!appSettings.goal) appSettings.goal = { text: 'חיפוש חופשי', target: 30 };
if(!appSettings.templates) {
    appSettings.templates = [
        { title: 'הודעת פתיחה', text: 'שלום משפחת [שם], שמחים לעדכן אתכם ש...' },
        { title: 'תזכורת', text: 'שלום משפחת [שם], מזכירים לכם לגבי האירוע הקרוב...' }
    ];
}

document.documentElement.style.setProperty('--accent', appSettings.themeColor);
let currentMainView = appSettings.defaultView || 'map';

let db = getStoredJSON('community_data_final', {});
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
let currentFilters = { tags: '', style: '', status: '' };
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
    document.getElementById('smartSearch').addEventListener('input', handleOmniSearch);

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
    }
};

window.saveOnboardingLocation = () => {
    if(!tempObLoc) { showToast('יש לחפש ולבחור כתובת', 'warning'); return; }
    appSettings.homeLocation = { coords: tempObLoc.coords, address: tempObLoc.address, isChabad: document.getElementById('onboardingIsChabad').checked };
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
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
    const bldgs = Object.keys(db).filter(k => k !== '__BOARDS__' && k !== NO_ADDRESS_KEY && (!db[k].info.coords || isNaN(db[k].info.coords[0])));
    if(bldgs.length > 0) showToast("מתבצע עדכון מיקומים ברקע...", "info");
    let updated = false;
    for(let b of bldgs) {
        try {
            const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(b)}.json?country=il&language=he&access_token=${mapboxgl.accessToken}`);
            const d = await r.json();
            if(d.features && d.features.length > 0) {
                db[b].info.coords = d.features[0].center;
                updated = true;
            }
        } catch(e) {}
        await new Promise(res => setTimeout(res, 1000));
    }
    if(updated) { saveDB(); refreshMap(); }
}

async function syncWithDrive() {
    setSyncStatus('wait', 'שואב...');
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='community_data_final.json'`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const list = await res.json();
        if (list.files && list.files.length > 0) {
            driveFileId = list.files[0].id;
            const content = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
            const driveDB = await content.json(); if(Object.keys(driveDB).length > 0) db = driveDB; 
        } else {
            const create = await fetch('https://www.googleapis.com/drive/v3/files', { method:'POST', headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'}, body:JSON.stringify({name:'community_data_final.json',mimeType:'application/json'}) });
            driveFileId = (await create.json()).id; await pushToDrive(); 
        }
        if(!db[NO_ADDRESS_KEY]) db[NO_ADDRESS_KEY] = { info: {code:'',rep:'',notes:'',coords:null}, apts:[] };
        if(!db['__BOARDS__']) db['__BOARDS__'] = [{ id: 'b_default', name: 'לוח מעקב כללי', columns: ['מתעניין חדש', 'בטיפול', 'פעיל קבוע', 'לא רלוונטי'], archived: false }];
        localStorage.setItem('community_data_final', JSON.stringify(db)); setSyncStatus('ok', 'מסונכרן');
    } catch(e) { setSyncStatus('error', 'שגיאה'); }
    
    document.getElementById('splash-screen').style.opacity='0'; 
    setTimeout(() => { 
        document.getElementById('splash-screen').style.display='none'; 
        map.resize(); 
        handleOmniSearch(); 
        updateHomeButton();
        
        const obModal = document.getElementById('onboardingModal');
        if(!appSettings.homeLocation && obModal) {
            obModal.style.display = 'flex';
        }
        
        geocodeMissingAddresses(); 
    }, 800);
}

async function pushToDrive() {
    if(!driveFileId || !accessToken) return; setSyncStatus('wait', 'שומר...');
    try { await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, { method:'PATCH', headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'}, body:JSON.stringify(db) }); setSyncStatus('ok', 'נשמר'); } catch(e) { setSyncStatus('error', 'שגיאה'); }
}
function setSyncStatus(st, txt) { document.getElementById('sync-text').innerText=txt; const ic=document.getElementById('sync-icon'), co=document.getElementById('sync-status'); if(st==='wait'){ic.className='fas fa-spinner fa-spin';co.style.color='var(--warning)';} if(st==='ok'){ic.className='fas fa-cloud-check';co.style.color='var(--success)';} if(st==='error'){ic.className='fas fa-exclamation-triangle';co.style.color='var(--danger)';} }

function saveDB() { localStorage.setItem('community_data_final', JSON.stringify(db)); handleOmniSearch(); pushToDrive(); }

window.switchMainView = function(viewName) {
    currentMainView = viewName;
    document.querySelectorAll('.main-tab').forEach(t=>t.classList.remove('active'));
    document.getElementById('tab-' + viewName).classList.add('active');
    
    document.getElementById('map-container').style.display = viewName==='map'?'block':'none';
    document.getElementById('list-container').style.display = viewName==='table'?'block':'none';
    document.getElementById('kanban-container').style.display = viewName==='kanban'?'flex':'none';
    document.getElementById('comm-container').style.display = viewName==='comm'?'flex':'none';
    
    if(viewName==='map') map.resize();
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
        let col = getStatusColor(a), bdg = (a.tags||[]).map(t=>`<span class="tag-badge">${t}</span>`).join('');
        let phones = getAllPhones(a); let ph = phones.length > 0 ? phones[0].replace(/\D/g, '') : '';
        return `<div class="bldg-fam-item" style="border-right-color:${col}" onclick="openClientCard(${i})"><div><div style="font-weight:700;font-size:16px;">${a.name||'(ללא שם)'} <span style="font-size:12px;font-weight:normal;color:var(--text-muted);">(דירה ${a.num||'-'})</span></div><div style="margin-top:4px;">${bdg}</div></div><div style="display:flex;gap:8px;">${ph?`<a href="tel:${ph}" class="btn-icon" style="color:var(--success);border-color:var(--success);" onclick="event.stopPropagation()"><i class="fas fa-phone"></i></a>`:''}<button class="btn-icon" style="color:var(--accent);"><i class="fas fa-pen"></i></button></div></div>`;
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
};

window.closeModals = () => { 
    isDirty = false; 
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
    tempCustom=JSON.parse(JSON.stringify(a.customFields||{})); renderCustomFields();
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
window.addTask = (text='', date='') => { const t=text||document.getElementById('newTaskText').value, d=date||document.getElementById('newTaskDate').value; if(!t)return; markDirty(); tempTasks.push({text:t,date:d,done:false}); document.getElementById('newTaskText').value=''; renderTasks(); };

function renderLogs() { document.getElementById('cLogsList').innerHTML = tempLogs.length===0 ? '<div class="empty-state"><i class="fas fa-comments"></i><div>עוד לא נוצר קשר. זה הזמן!</div></div>' : tempLogs.sort((a,b)=>new Date(b.date)-new Date(a.date)).map((l,i) => `<div class="log-item"><div class="log-header"><span><i class="fas fa-calendar-alt"></i> ${l.date} - ${l.type}</span><button onclick="tempLogs.splice(${i},1);markDirty();renderLogs()" style="background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fas fa-times"></i></button></div><div>${l.text}</div></div>`).join(''); }
window.addInteractionLog = () => { const d=document.getElementById('newLogDate').value, t=document.getElementById('newLogType').value, txt=document.getElementById('newLogText').value; if(!d||!txt)return; markDirty(); tempLogs.push({date:d,type:t,text:txt}); document.getElementById('newLogText').value=''; renderLogs(); };

function renderDonations() { let sum=tempDonations.reduce((a,b)=>a+Number(b.amount||0),0); document.getElementById('cDonationsSum').innerText=`₪${sum}`; document.getElementById('cDonationsList').innerHTML = tempDonations.length===0 ? '<div class="empty-state"><i class="fas fa-hand-holding-heart"></i><div>אין תרומות.</div></div>' : tempDonations.sort((a,b)=>new Date(b.date)-new Date(a.date)).map((d,i) => `<div class="log-item"><div class="log-header"><span style="color:var(--success);"><i class="fas fa-shekel-sign"></i> ${d.amount}</span><span>${d.date}</span></div><div>${d.reason} <button onclick="tempDonations.splice(${i},1);markDirty();renderDonations()" style="float:left;background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fas fa-trash"></i></button></div></div>`).join(''); }

window.addDonation = () => { 
    const d=document.getElementById('newDonDate').value, a=document.getElementById('newDonAmount').value, r=document.getElementById('newDonReason').value; 
    if(!d||!a)return; markDirty(); 
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
    a.boards={...tempBoards}; a.childrenList=[...tempChildren]; a.tags=[...tempTags]; a.interactions=[...tempLogs]; a.donations=[...tempDonations]; a.tasks=[...tempTasks]; a.customFields={...tempCustom};
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
}

window.applyAdvFilters = () => { currentFilters.style=document.getElementById('fStyle').value; currentFilters.tags=document.getElementById('fTag').value; currentFilters.status=document.getElementById('fStatus').value; handleOmniSearch(); };

window.handleOmniSearch = () => {
    const el = document.getElementById('smartSearch');
    if(!el) return;
    
    const q=el.value.toLowerCase(), dd=document.getElementById('searchDropdown'); let res=[];
    Object.keys(db).forEach(b => { 
        if(b === '__BOARDS__') return;
        db[b].apts.forEach((a,i) => {
        let txt=`${b} ${a.name} ${getAllPhones(a).join(' ')} ${getAllEmails(a).join(' ')} ${a.notes||''} ${(a.tags||[]).join(' ')} ${a.father||''} ${a.mother||''}`.toLowerCase();
        let matchQ = q.length<2 || txt.includes(q);
        let matchStyle = !currentFilters.style || a.style===currentFilters.style;
        let matchTag = !currentFilters.tags || (a.tags||[]).includes(currentFilters.tags);
        let col = getStatusColor(a);
        let matchStat = !currentFilters.status || (currentFilters.status==='green'&&col==='#10b981') || (currentFilters.status==='orange'&&col==='#f59e0b') || (currentFilters.status==='red'&&(col==='#ef4444'||col==='#94a3b8'));
        if(matchQ && matchStyle && matchTag && matchStat) res.push({bldg:b, idx:i, apt:a});
    });});
    
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
    m.style.left = e.pageX + 'px';
    m.style.top = e.pageY + 'px';
};
window.ctxEdit = () => { currentBldg = ctxBldg; document.getElementById('contextMenu').style.display='none'; openClientCard(ctxIdx); };
window.ctxMove = () => { currentBldg = ctxBldg; currentAptIdx = ctxIdx; document.getElementById('contextMenu').style.display='none'; pendingMoveMode=true; document.getElementById('addressSearchModal').style.display='flex'; };

window.ctxDelete = () => { 
    document.getElementById('contextMenu').style.display='none'; 
    ensureAuthAndExecute(() => { 
        let deletedData = db[ctxBldg].apts.splice(ctxIdx, 1)[0]; 
        let deletedBldg = ctxBldg;
        let deletedIdx = ctxIdx;
        saveDB(); 
        handleOmniSearch();
        showUndoToast("המשפחה נמחקה", () => {
            db[deletedBldg].apts.splice(deletedIdx, 0, deletedData);
            saveDB();
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
           if(bldg !== '__BOARDS__') { db[bldg].apts.forEach(a => { if(a.boards && a.boards[id]) delete a.boards[id]; }); }
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
    if(!filteredRes) Object.keys(db).forEach(b=>{ if(b!=='__BOARDS__') db[b].apts.forEach((a,i)=>arr.push({bldg:b,idx:i,apt:a})) });
    
    activeBoard.columns.forEach(stage => {
        let colCards = arr.filter(r => r.apt.boards && r.apt.boards[currentBoardId] === stage);
        let colHtml = `<div class="kanban-col" ondragover="allowDrop(event)" ondragleave="dragLeave(event)" ondrop="dropCard(event, '${stage}')"><div class="kanban-header">${stage} <span style="background:rgba(0,0,0,0.2);padding:2px 8px;border-radius:12px;font-size:12px;">${colCards.length}</span></div><div class="kanban-body">`;
        colCards.forEach(r => {
            colHtml += `<div class="kanban-card" draggable="true" ondragstart="dragCard(event, '${encodeURIComponent(r.bldg)}', ${r.idx})" onclick="currentBldg='${r.bldg}'; openClientCard(${r.idx})"><div class="kanban-card-title">${r.apt.name||'ללא שם'}</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:5px;">${r.bldg===NO_ADDRESS_KEY?'ללא כתובת':r.bldg}</div></div>`;
        });
        c.innerHTML += colHtml + `</div></div>`;
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
    const t = await showCustomDialog({ title: 'תגית המונית', message: 'הקלד תגית להוספה למשפחות:', showInput: true });
    if(t) { 
        ensureAuthAndExecute(()=>{ 
            bulkSelection.forEach(v=>{let [b,i]=v.split('|'); let a=db[b].apts[i]; if(!a.tags)a.tags=[]; if(!a.tags.includes(t))a.tags.push(t); }); 
            if(!appSettings.tags.includes(t)) {appSettings.tags.push(t); localStorage.setItem('crm_prefs',JSON.stringify(appSettings)); populateFilterDropdowns();} 
            saveDB(); clearBulkSelection(); showToast("תגית נוספה! " + getRandomCompliment(),"success"); 
        }); 
    } 
};

window.bulkDelete = async () => { 
    const proceed = await showCustomDialog({ title: 'מחיקה המונית', message: `למחוק ${bulkSelection.length} משפחות? פעולה בלתי הפיכה!`, showCancel: true });
    if(proceed) { 
        ensureAuthAndExecute(()=>{ 
            bulkSelection.sort((x,y)=>Number(y.split('|')[1])-Number(x.split('|')[1])).forEach(v=>{let [b,i]=v.split('|'); db[b].apts.splice(i,1);}); 
            saveDB(); clearBulkSelection(); showToast("נמחקו","success"); 
        }); 
    } 
};

window.bulkRoute = () => {
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

window.renderListView = (filteredRes = null) => {
    const inner = document.getElementById('list-inner');
    let html=`<div style="display:flex; justify-content:space-between; margin-bottom:15px; align-items:center; flex-wrap:wrap; gap:10px; width:100%;">
        <h2 style="margin:0;"><i class="fas fa-list"></i> רשימת משפחות</h2>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn btn-success" style="width:auto; padding:8px 15px;" onclick="exportTableToCSV()"><i class="fas fa-file-excel"></i> ייצוא לאקסל</button>
        </div>
    </div>
    <div style="width:100%; overflow-x:auto; padding-bottom:80px; padding-left: 2px; padding-right: 2px;">
    <table class="data-table"><thead><tr><th style="width:30px;"><input type="checkbox" id="bulkSelectAll" onchange="toggleAllBulk(this)"></th><th>כתובת</th><th>משפחה</th><th>פרויקטים וסטטוס</th><th>תגיות</th><th>קשר אחרון</th><th>טלפונים ומייל</th></tr></thead><tbody>`;
    
    let arr = filteredRes || []; if(!filteredRes) Object.keys(db).forEach(b=>{if(b!=='__BOARDS__')db[b].apts.forEach((a,i)=>arr.push({bldg:b,idx:i,apt:a}))});
    arr.forEach(r => {
        const enc=encodeURIComponent(r.bldg), bName=r.bldg===NO_ADDRESS_KEY?'ללא כתובת':r.bldg, a=r.apt;
        let lastDate='-'; if(a.interactions&&a.interactions.length>0) lastDate=a.interactions.sort((x,y)=>new Date(y.date)-new Date(x.date))[0].date;
        
        let boardsHtml = '-';
        if(a.boards && Object.keys(a.boards).length > 0) {
            boardsHtml = Object.entries(a.boards).map(([bid, status]) => {
                const bObj = db.__BOARDS__.find(x => x.id === bid);
                return bObj ? `<span class="board-badge">${bObj.name}: ${status}</span>` : '';
            }).join(' ');
        }
        
        let contactIcons = '';
        if(getAllPhones(a).length > 0) contactIcons += `<i class="fas fa-phone" style="color:var(--success); margin-left:5px;"></i>`;
        if(getAllEmails(a).length > 0) contactIcons += `<i class="fas fa-envelope" style="color:#ea4335;"></i>`;

        html += `<tr oncontextmenu="showContextMenu(event,'${enc}',${r.idx})" onclick="currentBldg='${r.bldg}'; openClientCard(${r.idx})">
            <td data-label="בחר" onclick="event.stopPropagation()"><input type="checkbox" class="bulk-cb" value="${r.bldg}|${r.idx}" onchange="updateBulkBar()"></td>
            <td data-label="כתובת" onclick="flyToBuildingFromTable('${enc}'); event.stopPropagation();" style="color:var(--accent);font-weight:600;cursor:pointer;"><i class="fas fa-map-marker-alt"></i> ${bName}</td>
            <td data-label="משפחה"><b>${a.name||'(ללא שם)'}</b></td><td data-label="פרויקטים">${boardsHtml}</td>
            <td data-label="תגיות">${(a.tags||[]).map(t=>`<span class="tag-badge">${t}</span>`).join('')}</td>
            <td data-label="קשר אחרון"><span class="status-dot" style="background:${getStatusColor(a)};"></span> ${lastDate}</td>
            <td data-label="פרטי קשר" style="font-size:16px;">${contactIcons}</td>
        </tr>`;
    });
    inner.innerHTML = html + `</tbody></table></div>`;
};

window.editGoal = async () => {
    let targetText = await showCustomDialog({ title: 'הגדרת יעד', message: 'מה המטרה שלך? (למשל שם רחוב, או תגית)', showInput: true, defaultValue: appSettings.goal.text });
    if(!targetText) return;
    let targetNum = await showCustomDialog({ title: 'הגדרת יעד', message: 'לכמה משפחות תרצה להגיע ביעד הזה?', showInput: true, defaultValue: appSettings.goal.target.toString() });
    if(targetNum && !isNaN(targetNum) && Number(targetNum) > 0) {
        appSettings.goal = { text: targetText, target: Number(targetNum) };
        localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
        updateGoalTracker();
        showToast("היעד עודכן! יוצאים לדרך 🚀", "success");
    }
};

window.updateGoalTracker = () => {
    let count = 0;
    let q = appSettings.goal.text.toLowerCase();
    Object.keys(db).forEach(b => {
        if(b === '__BOARDS__') return;
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
        if(k === '__BOARDS__') return;
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
window.addNewTag=async ()=>{const v=await showCustomDialog({title:'תגית חדשה', message:'שם התגית:', showInput:true}); if(v&&!appSettings.tags.includes(v)){appSettings.tags.push(v);openSettings();}};
window.addNewCustomField=async ()=>{const v=await showCustomDialog({title:'שדה מותאם', message:'שם השדה:', showInput:true}); if(v&&!appSettings.customFields.includes(v)){appSettings.customFields.push(v);openSettings();}};

window.setItemColor = (type, name, color) => {
    if(type === 'style') appSettings.styleColors[name] = color;
    else appSettings.tagColors[name] = color;
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
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
    Object.keys(db).forEach(k => { if(k==='__BOARDS__') return; db[k].apts.forEach(a => { if(a.style===oldName) a.style=newName; }); });
    saveDB(); localStorage.setItem('crm_prefs', JSON.stringify(appSettings)); populateFilterDropdowns(); openSettings(); refreshMap();
};

window.deleteStyle = async (idx) => {
    const name = appSettings.styles[idx];
    const ok = await showCustomDialog({ title: 'מחיקת סגנון', message: `למחוק את הסגנון "${name}"? משפחות עם סגנון זה יישארו ללא סגנון.`, showCancel: true });
    if(!ok) return;
    appSettings.styles.splice(idx, 1);
    delete appSettings.styleColors[name];
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings)); populateFilterDropdowns(); openSettings(); refreshMap();
};

window.addNewStyle = async () => {
    const v = document.getElementById('newStyleInput').value.trim();
    if(!v) return;
    if(appSettings.styles.includes(v)) { showToast('סגנון זה כבר קיים', 'warning'); return; }
    appSettings.styles.push(v);
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings)); populateFilterDropdowns(); openSettings(); refreshMap();
};

window.saveSettingsAndClose=()=>{
    appSettings.defaultView=document.getElementById('setDefaultView').value; 
    
    const isPrimary = document.getElementById('locTypePrimary').checked;
    if(isPrimary) {
        if(appSettings.primaryLocation) {
            appSettings.homeLocation = { coords: appSettings.primaryLocation.coords, address: appSettings.primaryLocation.address, isChabad: true };
        } else if(appSettings.homeLocation) {
            // אין primaryLocation – שמור את homeLocation הקיים כ-isChabad
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
    
    localStorage.setItem('crm_prefs',JSON.stringify(appSettings)); 
    populateFilterDropdowns(); 
    document.getElementById('settingsModal').style.display='none'; 
    updateHomeButton();
    refreshMap(); 
    showToast('הגדרות נשמרו','success');
};

window.setDefaultLocation=()=>{appSettings.center=[map.getCenter().lng,map.getCenter().lat]; appSettings.zoom=map.getZoom(); localStorage.setItem('crm_prefs',JSON.stringify(appSettings)); showToast("נשמר מיקום מפה","success");};

window.exportTableToCSV = () => { 
    let customHeaders = appSettings.customFields.join(',');
    let csv = `\uFEFFכתובת/בניין,שם משפחה,דירה,סגנון,פרויקטים,תגיות,קשר אחרון,טלפונים,מיילים,הערות${customHeaders ? ',' + customHeaders : ''}\n`; 
    Object.keys(db).forEach(b=>{ 
        if(b==='__BOARDS__')return; 
        db[b].apts.forEach(a=>{ 
            let tags=(a.tags||[]).join(' - '), phones=getAllPhones(a).join(' - '), emails=getAllEmails(a).join(' - '), notes=(a.notes||'').replace(/,/g,' ').replace(/\n/g,' '); 
            let last='-'; if(a.interactions&&a.interactions.length>0) last=a.interactions.sort((x,y)=>new Date(y.date)-new Date(x.date))[0].date; 
            let boardsStr = a.boards ? Object.entries(a.boards).map(([bid, st]) => `${db.__BOARDS__.find(x=>x.id===bid)?.name||''}:${st}`).join(' | ') : ''; 
            let customVals = appSettings.customFields.map(f => (a.customFields && a.customFields[f] ? a.customFields[f].replace(/,/g,' ') : '')).join(',');
            csv += `${b===NO_ADDRESS_KEY?'ללא כתובת':b.replace(/,/g,'')},${(a.name||'').replace(/,/g,'')},${a.num||''},${a.style||''},${boardsStr},${tags},${last},${phones},${emails},${notes}${customVals ? ',' + customVals : ''}\n`; 
        })
    }); 
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'})); a.download = `קהילה_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); showToast("ייצוא הושלם!","success"); 
};
window.exportData = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(db)], {type:'application/json;charset=utf-8;'})); a.download = `גיבוי_מלא_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); };
window.importData = (e) => { const r=new FileReader(); r.onload=(ev)=>{try{db=JSON.parse(ev.target.result); if(!db[NO_ADDRESS_KEY]) db[NO_ADDRESS_KEY] = { info: {code:'',rep:'',notes:'',coords:null}, apts:[] }; if(!db['__BOARDS__']) db['__BOARDS__'] = [{ id: 'b_default', name: 'לוח כללי', columns: ['חדש', 'בטיפול', 'פעיל'], archived: false }]; saveDB(); showToast("שוחזר!","success"); closeModals(); handleOmniSearch(); }catch(err){showToast("קובץ שגוי","error");}}; r.readAsText(e.target.files[0]); e.target.value=''; };

// --- ניהול תבניות ומרכז התקשורת ---
window.renderTemplates = () => {
    const container = document.getElementById('templatesListContainer');
    if(!container) return;
    if(!appSettings.templates || appSettings.templates.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-file-signature"></i><div>אין תבניות שמורות. לחץ על "תבנית חדשה" כדי להתחיל.</div></div>';
        return;
    }
    container.innerHTML = appSettings.templates.map((t, i) => `
        <div class="template-card" style="display:flex; align-items:flex-start; background:var(--bg-body); border:1px solid var(--border-light); border-radius:8px; padding:12px; margin-bottom:10px;">
            <div style="flex-grow:1; margin-left:15px;">
                <div style="font-weight:bold; font-size:15px; color:var(--text-main); margin-bottom:5px;">${t.title}</div>
                <div style="font-size:13px; color:var(--text-muted); white-space:pre-wrap;">${t.text}</div>
            </div>
            <div style="display:flex; gap:8px; flex-shrink:0;">
                <button class="btn-icon" style="color:var(--accent);" onclick="editTemplate(${i})" title="ערוך"><i class="fas fa-pen"></i></button>
                <button class="btn-icon" style="color:var(--danger);" onclick="deleteTemplate(${i})" title="מחק"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('');
};

window.createNewTemplate = async () => {
    const title = await showCustomDialog({ title: 'תבנית חדשה', message: 'תן שם קצר לתבנית:', showInput: true, showCancel: true });
    if(!title) return;
    const text = await showCustomDialog({ title: 'תוכן התבנית', message: 'הקלד את תוכן ההודעה.\n(אפשר להשתמש במילה [שם] לטובת שם המשפחה)', showInput: true, showCancel: true });
    if(!text) return;
    appSettings.templates.push({ title, text });
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    renderTemplates();
    showToast("התבנית נשמרה", "success");
};

window.editTemplate = async (idx) => {
    const t = appSettings.templates[idx];
    const title = await showCustomDialog({ title: 'עריכת שם תבנית', message: 'שם התבנית:', showInput: true, defaultValue: t.title, showCancel: true });
    if(!title) return;
    const text = await showCustomDialog({ title: 'עריכת תוכן תבנית', message: 'תוכן ההודעה:', showInput: true, defaultValue: t.text, showCancel: true });
    if(!text) return;
    appSettings.templates[idx] = { title, text };
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    renderTemplates();
    showToast("התבנית עודכנה", "success");
};

window.deleteTemplate = async (idx) => {
    const proceed = await showCustomDialog({ title: 'מחיקת תבנית', message: 'האם למחוק תבנית זו?', showCancel: true });
    if(!proceed) return;
    appSettings.templates.splice(idx, 1);
    localStorage.setItem('crm_prefs', JSON.stringify(appSettings));
    renderTemplates();
    showToast("התבנית נמחקה", "success");
};

// רשימת נמענים לניהול עצמאי
let commRecipients = []; // [{name, phone, email, key}]

window.renderCommSenders = (type) => {
    // בנה רשימה מה-bulkSelection הנוכחי
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
    document.getElementById(type === 'whatsapp' ? 'waRecipientCount' : 'emRecipientCount').innerText = commRecipients.length;
};

window.addRecipientManually = async (type) => {
    const name = await showCustomDialog({ title: 'הוסף נמען', message: 'שם המשפחה:', showInput: true, showCancel: true });
    if(!name) return;
    const contact = await showCustomDialog({ title: 'הוסף נמען', message: type === 'whatsapp' ? 'מספר טלפון:' : 'כתובת מייל:', showInput: true, showCancel: true });
    if(!contact) return;
    commRecipients.push({ name, phone: type === 'whatsapp' ? contact : '', email: type === 'email' ? contact : '', key: '' });
    renderRecipientsList(type);
    document.getElementById(type === 'whatsapp' ? 'waRecipientCount' : 'emRecipientCount').innerText = commRecipients.length;
};

window.addRecipientsFromDB = (type) => {
    const modal = document.getElementById('recipientPickerModal');
    const list = document.getElementById('recipientPickerList');
    list.innerHTML = '';
    Object.keys(db).forEach(b => {
        if(b === '__BOARDS__') return;
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
    modal.dataset.type = type;
    modal.style.display = 'flex';
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
    document.getElementById(type === 'whatsapp' ? 'waRecipientCount' : 'emRecipientCount').innerText = commRecipients.length;
};

window.closeRecipientPicker = (type) => {
    document.getElementById('recipientPickerModal').style.display = 'none';
    renderRecipientsList(type);
};

window.previewWaTemplate = () => {
    const idx = document.getElementById('waTemplateSelect').value;
    if(idx !== '') document.getElementById('waMessageText').value = appSettings.templates[idx].text;
};

window.previewEmTemplate = () => {
    const idx = document.getElementById('emTemplateSelect').value;
    if(idx !== '') document.getElementById('emMessageText').value = appSettings.templates[idx].text;
};

window.sendCommWhatsApp = () => {
    let text = document.getElementById('waMessageText').value;
    if(!text) return showToast('יש להזין תוכן להודעה', 'warning');
    if(commRecipients.length === 0) return showToast('יש להוסיף נמענים קודם!', 'error');
    
    let p = commRecipients.filter(r => r.phone).map(r => {
        let cleanPhone = String(r.phone).replace(/\D/g,'');
        if(cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
        return { phone: cleanPhone, text: encodeURIComponent(text.replace(/\[שם\]/g, r.name||'')) };
    });

    if(p.length > 0) { 
        window.open(`https://wa.me/972${p[0].phone}?text=${p[0].text}`, '_blank'); 
        if(p.length > 1) showToast(`נפתח חלון לנמען הראשון בלבד (מגבלת וואטסאפ)`, 'warning');
        commRecipients = [];
        renderRecipientsList('whatsapp');
        document.getElementById('waRecipientCount').innerText = 0;
    } else {
        showToast('לא נמצאו מספרי טלפון בנמענים', 'error');
    }
};

window.sendCommEmail = () => {
    let subj = document.getElementById('emSubject').value || 'הודעה מהקהילה';
    let text = document.getElementById('emMessageText').value;
    if(!text) return showToast('יש להזין תוכן למייל', 'warning');
    if(commRecipients.length === 0) return showToast('יש להוסיף נמענים קודם!', 'error');

    let emails = commRecipients.filter(r => r.email).map(r => r.email);
    if(emails.length === 0) return showToast('לא נמצאו כתובות מייל בנמענים', 'error');

    let mailtoLink = `mailto:?bcc=${emails.join(',')}&subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(text)}`;
    
    // פותח את המייל קודם כל
    const a = document.createElement('a');
    a.href = mailtoLink;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    showToast('נפתחה תוכנת המייל', 'success');
    
    // clipboard ברקע בלי לחסום כלום
    setTimeout(() => {
        if(navigator.clipboard) {
            navigator.clipboard.writeText(emails.join(', ')).catch(() => {});
        }
    }, 1000);
    
    commRecipients = [];
    renderRecipientsList('email');
    document.getElementById('emRecipientCount').innerText = 0;
};