// בדיקת רשימת הקהילה: יעד, תצוגה חכמה, חסרים פרטים, מיון בכותרת, צפיפות, פעולות על מסומנות → הודעות
const { open, wait, txt, all, clickText } = require('./smoke-lib.cjs');
const out = process.env.OUT || __dirname + '/out';
require('fs').mkdirSync(out, { recursive: true });
const setVal = (page, sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return true;
}, sel, v);
const rowsN = (page) => page.$$eval('.com-table tbody tr', (r) => r.length);

(async () => {
  const { browser, page, errors } = await open('community/people');
  console.log('ROWS:', await rowsN(page));

  // יעד
  await page.click('.goal');
  await wait(200);
  await setVal(page, '.dialog input', 'דוד ניב');
  await setVal(page, '.dialog input[inputmode="numeric"]', '20');
  console.log('GOAL DLG:', await txt(page, '.dialog'));
  await clickText(page, '.dialog .btn-primary', 'שמירה');
  await wait(300);
  console.log('GOAL:', await txt(page, '.goal'));

  // תצוגה חכמה חדשה: בלי ביקור 3 חודשים
  await setVal(page, 'select[aria-label="תצוגה חכמה"]', '__manage__');
  await wait(300);
  await setVal(page, '.dialog input', 'בלי ביקור');
  await setVal(page, '.dialog select', 'no_visit_months');
  await wait(200);
  console.log('SV PREVIEW:', await txt(page, '.dialog .dialog-note'));
  await clickText(page, '.dialog .btn-primary', 'שמירה');
  await wait(400);
  console.log('SV ACTIVE:', await txt(page, '.com-active'), '| ROWS:', await rowsN(page));
  await page.click('.com-active .ib-s');
  await wait(200);

  // חסרים פרטים: מייל
  await clickText(page, '.com-bar .btn', 'חסרים פרטים');
  await wait(200);
  await page.evaluate(() => [...document.querySelectorAll('.cols-pop label')].find((l) => l.textContent.includes('מייל'))?.querySelector('input').click());
  await wait(300);
  console.log('MISSING EMAIL ROWS:', await rowsN(page), '|', await txt(page, '.com-active'));
  await page.click('.com-active .ib-s');
  await page.mouse.click(10, 10);
  await wait(200);

  // מיון בכותרת
  await clickText(page, '.th-sort', 'קשר אחרון');
  await wait(200);
  const first = await all(page, '.com-table tbody tr td.c-lastContact');
  await clickText(page, '.th-sort', 'קשר אחרון');
  await wait(200);
  const firstDesc = await all(page, '.com-table tbody tr td.c-lastContact');
  console.log('SORT ASC:', first.slice(0, 2).join(','), '| DESC:', firstDesc.slice(0, 2).join(','), '| HEADER:', await txt(page, 'th[aria-sort]'));

  // צפיפות
  await clickText(page, '.com-bar .btn', 'תצוגה');
  await wait(200);
  await clickText(page, '.cols-pop .seg-s button', 'צפוף');
  await wait(300);
  console.log('DENSITY:', await page.$eval('.com-table', (t) => t.className));
  await page.mouse.click(10, 10);

  // תפריט שורה
  await page.click('.com-table tbody tr .row-more');
  await wait(200);
  console.log('ROW MENU:', await txt(page, '.row-menu'));
  await page.mouse.click(10, 10);

  // סימון 3 → רשימת טלפונים → שליחת הודעה
  const boxes = await page.$$('.com-table tbody td.chk input');
  for (const b of boxes.slice(0, 3)) await b.click();
  await wait(200);
  console.log('BULK:', await txt(page, '.bulk'));
  await clickText(page, '.bulk .btn', 'רשימת טלפונים');
  await wait(300);
  console.log('PHONES:', (await txt(page, '.dialog')).slice(0, 160));
  await clickText(page, '.dialog .btn', 'סגירה');
  await page.screenshot({ path: out + '/community.png' });
  await clickText(page, '.bulk .btn', 'שליחת הודעה');
  await wait(800);
  console.log('HASH:', await page.evaluate(() => location.hash), '| AUD:', await txt(page, '.aud-head'));

  // משתני מיזוג + טיוטה + נמען ידני
  await clickText(page, '.merge-chips .chip-f', '[שם האב]');
  await setVal(page, '.compose textarea', 'שלום [שם האב], משפחת [שם] מ[כתובת]');
  await wait(200);
  console.log('PREVIEW:', await txt(page, '.preview'));
  await setVal(page, 'input[aria-label="נמען ידני"]', '0521234567');
  await clickText(page, '.manual-add .btn', 'הוספה');
  await wait(200);
  console.log('SEND BTN:', await txt(page, '.send-go'));
  await page.screenshot({ path: out + '/messages.png' });
  await page.reload({ waitUntil: 'networkidle2' });
  await wait(1000);
  console.log('DRAFT AFTER RELOAD:', await page.$eval('.compose textarea', (t) => t.value).catch(() => 'none'));

  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
