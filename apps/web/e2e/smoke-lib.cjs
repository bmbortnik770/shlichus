// עזר לבדיקות מסכים: דפדפן בדיקה עם נתוני בדיקה סינתטיים (fixture-db.json)
const puppeteer = require('C:/Users/bmbor/shlichus-new/node_modules/puppeteer-core');
const fs = require('fs');
exports.wait = (ms) => new Promise((r) => setTimeout(r, ms));
exports.txt = (page, sel) => page.$eval(sel, (e) => e.innerText.split(String.fromCharCode(10)).join(' ')).catch(() => 'none');
exports.all = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.innerText.split(String.fromCharCode(10)).join(' ')));
exports.clickText = (page, sel, text) => page.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((b) => b.textContent.includes(t)); if (el) el.click(); return !!el; }, sel, text);
exports.open = async (hash, { base = 'http://localhost:4310', width = 1440, height = 900 } = {}) => {
  const db = JSON.parse(fs.readFileSync(__dirname + '/fixture-db.json', 'utf8'));
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36');
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.setViewport({ width, height });
  await page.goto(`${base}/shlichus/app/`, { waitUntil: 'networkidle2' });
  await page.evaluate((db) => new Promise((res) => { const r = indexedDB.open('shlichus', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(db, 'community_data_final'); tx.oncomplete = () => res(); }; }), db);
  await page.goto(`${base}/shlichus/app/#${hash}`, { waitUntil: 'networkidle2' });
  await page.reload({ waitUntil: 'networkidle2' });
  await exports.wait(1200);
  return { browser, page, errors };
};
