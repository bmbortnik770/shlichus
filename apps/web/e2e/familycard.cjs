// בדיקת כרטיס המשפחה: ילדים, מעגלים, תיעוד לפי סוג, התחייבות ותשלום, אירוע חיים, תיעוד שיחה
const { open, wait, txt, all, clickText } = require('./smoke-lib.cjs');
const out = process.env.OUT || __dirname + '/out';
require('fs').mkdirSync(out, { recursive: true });
const setVal = (page, sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s);
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return true;
}, sel, v);
const toast = (page) => txt(page, '.toast');
const tab = async (page, t) => { await clickText(page, '.fc-tabs button', t); await wait(300); };

(async () => {
  const { browser, page, errors } = await open('community/people');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await wait(300);
  await page.type('.pal-in input', 'כהן');
  await wait(300);
  await page.keyboard.press('Enter');
  await wait(600);
  console.log('CARD:', await txt(page, '.fc-id h2'), '|', await txt(page, '.fc-status'));

  // פרטים: ילד עם מין ותאריך לידה + מעגל
  await clickText(page, '.fc-sec .btn', 'ילד/ה');
  const k = '.fc-kid:last-of-type';
  await setVal(page, `${k} input[aria-label="שם הילד/ה"]`, 'מנחם');
  await clickText(page, `${k} .seg-s button`, 'בן');
  const dob = new Date(); dob.setFullYear(dob.getFullYear() - 13); dob.setDate(dob.getDate() + 20);
  await setVal(page, `${k} input[type="date"]`, dob.toISOString().slice(0, 10));
  await page.evaluate(() => { const b = [...document.querySelectorAll('.fc-sec')].find((s) => s.querySelector('h3')?.textContent.includes('מעגלים'))?.querySelector('.chip-f[aria-pressed="false"]'); b?.click(); });
  await page.click('.fc-save .btn-primary');
  await wait(500);
  console.log('SAVE:', await toast(page), '| KID HEB:', await txt(page, `${k} .fc-kid-heb`), '| ALERTS:', await txt(page, '.fc-alerts'));

  // פעילות: ביקור בית לאב
  await tab(page, 'פעילות');
  await setVal(page, '.fc-add-col select[aria-label="סוג"]', 'visit');
  await setVal(page, '.fc-add-col select[aria-label="בן משפחה"]', 'father');
  await setVal(page, '.fc-add-col input[aria-label="תיעוד"]', 'ביקור בדיקה');
  await clickText(page, '.fc-add-col .btn-primary', 'תיעוד');
  await wait(400);
  console.log('LOG:', (await all(page, '.timeline li')).slice(0, 1).join(''), '| FILTERS:', (await all(page, '.fc-sec .chips .chip-f')).join(','));
  console.log('ENGAGE:', await txt(page, '.fc-status'));

  // תרומות: התחייבות ותשלום עליה
  await tab(page, 'תרומות');
  await clickText(page, '.fc-h-act', 'התחייבות');
  await wait(300);
  await setVal(page, '.dialog input[inputmode="decimal"]', '1000');
  await clickText(page, '.dialog .btn-primary', 'שמירה');
  await wait(400);
  console.log('PLEDGE:', await txt(page, '.pledge'));
  await clickText(page, '.pledge .btn', 'תשלום');
  await wait(200);
  await clickText(page, '.fc-add-col .btn-primary', 'רישום תרומה');
  await wait(500);
  console.log('PAID:', await toast(page), '|', await txt(page, '.pledge'), '| TOTAL:', await txt(page, '.fc-total'));

  // אירוע חיים: לידה היום → משימות המשך
  await tab(page, 'חיים ומועדים');
  await setVal(page, '.fc-add-col select[aria-label="סוג אירוע"]', 'birth');
  await clickText(page, '.fc-add-col .btn-primary', 'רישום');
  await wait(500);
  console.log('LIFE:', await toast(page), '|', (await all(page, '.fc-sec .fc-list li')).slice(0, 1).join(''));
  await tab(page, 'פעילות');
  console.log('TASKS:', (await all(page, '.fc-sec .fc-list li')).slice(0, 5).join(' || '));

  // תיעוד: הקלטה, עריכה, סינון
  await tab(page, 'תיעוד');
  await setVal(page, '.fc-add-col select[aria-label="סוג תיעוד"]', 'recording_link');
  await setVal(page, '.fc-add-col input[aria-label="קישור להקלטה"]', 'https://example.com/rec.mp3');
  await clickText(page, '.fc-add-col .btn-primary', 'שמירה');
  await wait(300);
  await setVal(page, '.fc-add-col select[aria-label="סוג תיעוד"]', 'summary');
  await setVal(page, '.fc-add-col textarea', 'סיכום ראשון');
  await clickText(page, '.fc-add-col .btn-primary', 'שמירה');
  await wait(300);
  await clickText(page, '.timeline .link', 'עריכה');
  await wait(200);
  await setVal(page, '.fc-add-col textarea', 'סיכום מתוקן');
  await clickText(page, '.fc-add-col .btn-primary', 'עדכון');
  await wait(300);
  console.log('DOCS:', (await all(page, '.timeline li')).join(' || '));
  await setVal(page, '.fc-filters select[aria-label="סינון לפי סוג"]', 'recording_link');
  await wait(200);
  console.log('FILTERED:', (await all(page, '.timeline li')).length);
  await page.screenshot({ path: out + '/familycard.png' });
  await page.setViewport({ width: 390, height: 844 });
  await tab(page, 'פרטים');
  await wait(300);
  await page.screenshot({ path: out + '/m-familycard.png' });

  // נשמר במכשיר?
  const saved = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('shlichus', 1); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('community_data_final'); g.onsuccess = () => { const db = g.result; for (const k of Object.keys(db)) for (const a of db[k]?.apts ?? []) if ((a.convDocs ?? []).length) return res({ kids: a.childrenList, circles: a.connectionCircles, pledges: a.pledges, life: a.lifecycleEvents?.length, log: a.interactions?.[0], docs: a.convDocs.length }); res(null); }; }; }));
  console.log('SAVED:', JSON.stringify(saved));
  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
