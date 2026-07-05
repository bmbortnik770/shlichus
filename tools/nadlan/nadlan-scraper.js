// nadlan-scraper.js — node nadlan-scraper.js
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const NADLAN_BASE = 'https://nadlan.taxes.gov.il/svinfonadlan2010/';
const RESULT_URL  = 'perutOfDira.aspx';

// ── 1. שלוף רחובות מה-CRM ──────────────────────────────────────
async function getStreetsFromCRM(browser) {
    const pages = await browser.pages();
    const crmTab = pages.find(p => p.url().includes('shlichus-new') || p.url().includes('index.html'));
    if (!crmTab) { console.error('CRM tab not found — please open index.html in Chrome'); process.exit(1); }

    const raw = await crmTab.evaluate(() => localStorage.getItem('community_data_final'));
    if (!raw) { console.error('No CRM data found in localStorage'); process.exit(1); }

    const db = JSON.parse(raw);
    const skip = new Set(['__BOARDS__', '__SETTINGS__', 'meta', '__NO_ADDRESS__']);
    const streetSet = new Set();

    for (const key of Object.keys(db)) {
        if (skip.has(key) || key.startsWith('@')) continue;
        // strip trailing house number: "שמואל תמיר 19" → "שמואל תמיר"
        const street = key.replace(/\s+\d+[א-ת]?\s*$/, '').trim();
        if (street && street.length > 2) streetSet.add(street);
    }

    return [...streetSet];
}

// ── 2. שלוף דף תוצאה אחד ──────────────────────────────────────
async function scrapePage(tab, processKey, cur) {
    const url = NADLAN_BASE + RESULT_URL + '?cur=' + cur + '&ProcessKey=' + processKey;
    await tab.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await tab.waitForFunction(
        () => { var e = document.getElementById('ContentUsersPage_lblRechov'); return e && e.textContent.trim().length > 0; },
        { timeout: 12000 }
    ).catch(() => {});

    return await tab.evaluate(() => {
        function g(id) { var e = document.getElementById(id); return e ? e.textContent.trim() : ''; }
        return {
            rechov: g('ContentUsersPage_lblRechov'),
            bayit:  g('ContentUsersPage_lblBayit'),
            yeshuv: g('ContentUsersPage_lblYeshuv'),
            units:  g('ContentUsersPage_lblDirotBnyn'),
            floors: g('ContentUsersPage_lblMisKomot'),
            year:   g('ContentUsersPage_lblShnatBniya'),
        };
    });
}

// ── 3. חיפוש רחוב + המתנה למשתמש ─────────────────────────────
async function searchStreet(tab, street, city) {
    await tab.goto(NADLAN_BASE + 'SearchDira.aspx', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // מלא עיר
    try {
        await tab.waitForSelector('input[ng-model*="ity"], input[placeholder*="יישוב"], #ContentUsersPage_tbYishuv', { timeout: 5000 });
        const cityInput = await tab.$('input[ng-model*="ity"], input[placeholder*="יישוב"], #ContentUsersPage_tbYishuv');
        if (cityInput) { await cityInput.click({ clickCount: 3 }); await cityInput.type(city, { delay: 80 }); await new Promise(r => setTimeout(r, 1500)); }
    } catch(e) {}

    // מלא רחוב
    try {
        const streetInput = await tab.$('input[ng-model*="treet"], input[placeholder*="רחוב"], #ContentUsersPage_tbRechov');
        if (streetInput) { await streetInput.click({ clickCount: 3 }); await streetInput.type(street, { delay: 80 }); await new Promise(r => setTimeout(r, 500)); }
    } catch(e) {}

    console.log('\n[' + street + '] Form filled — please solve CAPTCHA and click Search, then press Enter here...');
    await new Promise(r => process.stdin.once('data', r));

    // המתן לדף תוצאות
    await tab.waitForFunction(
        () => location.href.includes('perutOfDira'),
        { timeout: 120000 }
    ).catch(() => {});

    const url = tab.url();
    const match = url.match(/ProcessKey=([^&]+)/);
    return match ? match[1] : null;
}

// ── main ───────────────────────────────────────────────────────
(async () => {
    console.log('Connecting to Chrome...');
    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' });

    const streets = await getStreetsFromCRM(browser);
    console.log('Streets found in CRM: ' + streets.join(', '));

    const city = 'ירושלים'; // שנה אם צריך
    const buildings = {};
    const tab = await browser.newPage();

    for (const street of streets) {
        const processKey = await searchStreet(tab, street, city);
        if (!processKey) { console.log('No ProcessKey for ' + street + ' — skipping'); continue; }

        console.log('Scraping ' + street + ' (ProcessKey: ' + processKey + ')');
        // קבל מספר רשומות מדויק מדף הסיכום
        const totalUrl = NADLAN_BASE + 'InfoNadlanPerutWithMap.aspx?ProcessKey=' + processKey;
        await tab.goto(totalUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await tab.waitForFunction(
            () => { var e = document.getElementById('ContentUsersPage_lblresh'); return e && e.textContent.trim().length > 0; },
            { timeout: 10000 }
        ).catch(() => {});
        const totalText = await tab.evaluate(() => {
            var e = document.getElementById('ContentUsersPage_lblresh');
            return e ? e.textContent.trim() : '';
        });
        const totalMatch = totalText.match(/\d+/);
        const total = totalMatch ? parseInt(totalMatch[0]) : 150;
        console.log('  Total records: ' + total + ' (' + totalText + ')');

        for (let cur = 1; cur <= total; cur++) {
            const d = await scrapePage(tab, processKey, cur);
            if (!d || !d.rechov) continue;
            const key = d.yeshuv + '|' + d.rechov + '|' + d.bayit;
            const units = parseInt(d.units) || 0;
            if (!buildings[key] || units > (buildings[key].units || 0)) {
                buildings[key] = { address: d.rechov + ' ' + d.bayit, city: d.yeshuv, units, floors: parseInt(d.floors) || 0, year: d.year };
            }
            process.stdout.write('\r  Page ' + cur + '/' + total + ' — ' + Object.keys(buildings).length + ' buildings total');
        }
        console.log('\n  Done with ' + street);
    }

    await browser.disconnect();

    const results = Object.values(buildings);
    console.log('\n\nTotal: ' + results.length + ' unique buildings');
    const outFile = 'nadlan-results.json';
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
    console.log('Saved to ' + outFile);
    console.table(results.slice(0, 15));
})();
