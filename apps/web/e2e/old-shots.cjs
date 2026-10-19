// צילומי המערכת הישנה (shlichus-new) עם אותם נתוני בדיקה: הדרייב מדומה בתוך דפדפן הבדיקה בלבד
const puppeteer = require('C:/Users/bmbor/shlichus-new/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/bmbor/shlichus-new';
const out = process.env.OUT || __dirname + '/out';
fs.mkdirSync(out, { recursive: true });
const db = fs.readFileSync(__dirname + '/fixture-db.json', 'utf8');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 150)));
  if (process.env.DEBUG) { page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 160))); page.on('request', (r) => { if (!r.url().startsWith('http://old.test/')) console.log('REQ', r.method(), r.url().slice(0, 140)); }); }
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('http://old.test/')) {
      let p = decodeURIComponent(new URL(u).pathname.slice(1)) || 'index.html';
      const f = path.join(ROOT, p);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return req.respond({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      return req.respond({ status: 404, body: '' });
    }
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (/www.googleapis.com|gmail.googleapis|people.googleapis/.test(u) && req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS, body: '' });
    if (u.includes('googleapis.com/drive') || u.includes('googleapis.com/upload')) {
      if (u.includes('alt=media')) return req.respond({ status: 200, headers: CORS, contentType: 'application/json', body: db });
      if (u.includes('/files?') || u.includes('/files/?')) return req.respond({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ files: [{ id: 'f1', name: 'community_data_final.json', modifiedTime: new Date().toISOString(), headRevisionId: 'r1' }] }) });
      return req.respond({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ id: 'f1', headRevisionId: 'r1', modifiedTime: new Date().toISOString() }) });
    }
    if (u.includes('accounts.google.com/gsi') || u.includes('apis.google.com/js')) return req.respond({ status: 200, contentType: 'application/javascript', body: '' });
    if (u.includes('gmail.googleapis') || u.includes('people.googleapis')) return req.respond({ status: 200, headers: CORS, contentType: 'application/json', body: '{}' });
    req.continue();
  });
  const shots = async (name, w, h) => { await page.setViewport({ width: w, height: h }); await wait(800); await page.screenshot({ path: `${out}/old-${name}.png` }); };
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://old.test/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('gdrive_session', JSON.stringify({ token: 'test', expiresAt: Date.now() + 3600e3 }));
    localStorage.setItem('crm_logged_in', 'true');
    localStorage.setItem('drive_root_folder_id', 'root1');
  });
  await page.goto('http://old.test/index.html', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await wait(4000);
  // משאב חיצוני תקוע מונע את onload בדפדפן הבדיקה — מפעילים את האתחול ידנית
  await page.evaluate(() => { if (document.readyState !== 'complete' && typeof window.onload === 'function') window.onload(new Event('load')); });
  await page.waitForFunction(() => document.getElementById('splash-screen')?.style.display === 'none', { timeout: 40000 }).catch(() => console.log('SPLASH STILL ON'));
  await wait(2000);
  console.log('FAMILIES LOADED:', await page.evaluate(() => Object.keys(window.db || {}).filter((k) => (window.db[k]?.apts || []).length).length));
  if (process.env.DEBUG) { console.log('SPLASH', await page.evaluate(() => [document.readyState, document.getElementById('splash-screen')?.style.display, document.getElementById('auth-overlay')?.style.display].join(' '))); await browser.close(); return; }
  await shots('dashboard', 1440, 900);
  // מעבר בין המסכים לפי כפתורי הניווט הקיימים
  const navs = await page.evaluate(() => [...document.querySelectorAll('[onclick*="switchMainView"]')].map((b) => ({ t: b.textContent.trim().replace(/\s+/g, ' ').slice(0, 30), on: b.getAttribute('onclick') })).filter((x, i, a) => x.t && a.findIndex((y) => y.on === x.on) === i));
  console.log('NAVS:', navs.map((n) => `${n.t} => ${n.on}`).join(' | '));
  for (const n of navs.slice(0, 14)) {
    const view = (n.on.match(/switchMainView\(['"]([^'"]+)/) || [])[1];
    if (!view) continue;
    await page.evaluate((v) => { try { window.switchMainView(v); } catch (e) { /* */ } }, view);
    await wait(2500);
    await shots(view, 1440, 900);
  }
  // כרטיס משפחה
  await page.evaluate(() => { try { window.switchMainView('list'); } catch { /* */ } });
  await wait(1500);
  await page.evaluate(() => { const r = document.querySelector('#tableBody tr, tbody tr[onclick]'); r && r.click(); });
  await wait(2000);
  await shots('familycard', 1440, 900);
  // טלפון
  await page.keyboard.press('Escape');
  await page.evaluate(() => { try { window.switchMainView('dashboard'); } catch { /* */ } });
  await shots('m-dashboard', 390, 844);
  await page.evaluate(() => { try { window.switchMainView('list'); } catch { /* */ } });
  await wait(1500);
  await shots('m-list', 390, 844);
  console.log('ERRORS:', errors.slice(0, 8).join(' | ') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
