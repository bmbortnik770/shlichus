// סידור התפריט: גרירה בין קבוצות, חצים, הסתרה, קבוצה חדשה, סרגל טלפון, הוספה מהירה, הגדרות חדשות
const { open, wait, txt, all, clickText } = require('./smoke-lib.cjs');
const out = process.env.OUT || __dirname + '/out';
require('fs').mkdirSync(out, { recursive: true });
const rail = (page) => all(page, '.rail .nav-sec, .rail .nav-item');
/** גרירה אמיתית (HTML5) של שורה לשורה אחרת */
const dnd = (page, fromText, toText) => page.evaluate((a, b) => {
  const rows = [...document.querySelectorAll('.ne-items li')];
  const src = rows.find((r) => r.textContent.includes(a));
  const dst = rows.find((r) => r.textContent.includes(b));
  const dt = new DataTransfer();
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  return !!(src && dst);
}, fromText, toText);

(async () => {
  const { browser, page, errors } = await open('today');
  console.log('RAIL BEFORE:', (await rail(page)).join(' | '));
  await clickText(page, '.rail .nav-edit', 'סידור התפריט');
  await wait(300);
  // גרירה: אירועים אל לפני "הודעות" (מחוץ לקבוצת "פעילות")
  console.log('DND:', await dnd(page, 'אירועים', 'הודעות'));
  await wait(200);
  // חץ: תרומות למעלה (עובר לראש הקבוצה)
  await page.evaluate(() => document.querySelector('button[aria-label="תרומות למעלה"]').click());
  // הסתרה: חיבורים
  await page.evaluate(() => document.querySelector('button[aria-label="הסתרת חיבורים"]').click());
  // קבוצה חדשה + גרירה אליה
  await clickText(page, '.ne .btn', 'קבוצה חדשה');
  await wait(200);
  await page.evaluate(() => {
    const g = [...document.querySelectorAll('.ne-group')].find((x) => x.querySelector('.ne-glabel')?.value === 'קבוצה חדשה');
    const i = g.querySelector('.ne-glabel'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'כספים'); i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    const src = [...document.querySelectorAll('.ne-items li')].find((r) => r.textContent.includes('תרומות'));
    const g = [...document.querySelectorAll('.ne-group')].find((x) => x.querySelector('.ne-glabel')?.value === 'כספים');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    g.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    g.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await wait(200);
  // סרגל טלפון: הוספת אירועים במקום הקבוצה
  await page.evaluate(() => document.querySelector('button[aria-label="הסרה מהסרגל: פעילות"]').click());
  await page.evaluate(() => { const el = document.querySelector('select[aria-label="הוספה לסרגל"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, 'events'); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(200);
  console.log('EDITOR MOBILE:', (await all(page, '.ne-mobile li')).join(' | '));
  await page.screenshot({ path: out + '/nav-editor.png' });
  await clickText(page, '.ne .btn-primary', 'שמירה');
  await wait(500);
  console.log('RAIL AFTER:', (await rail(page)).join(' | '));
  console.log('HIDDEN STILL IN PALETTE:', await (async () => {
    await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
    await wait(200); await page.type('.pal-in input', 'חיבורים'); await wait(200);
    const t = (await all(page, '.pal-list li[role="option"]')).join(' ');
    await page.keyboard.press('Escape'); return t.includes('חיבורים');
  })());

  // טלפון: הסרגל לפי הסידור, "עוד" עם השאר
  await page.setViewport({ width: 390, height: 844 });
  await wait(400);
  console.log('TABBAR:', (await all(page, '.tabbar button')).join(' | '));
  await clickText(page, '.tabbar button', 'עוד');
  await wait(400);
  console.log('MORE:', (await all(page, '.more-grp')).join(' || '));
  await page.screenshot({ path: out + '/m-more.png' });
  console.log('FAB:', !!(await page.$('.qa-btn')));
  await page.click('.qa-btn');
  await wait(200);
  console.log('QA MENU:', await txt(page, '.qa-menu'));
  await clickText(page, '.qa-menu button', 'משימה');
  await wait(200);
  await page.type('.dialog input[list="qa-fams"]', 'משפחת כהן');
  await page.type('.dialog .fld:nth-of-type(2) input', 'להתקשר לברך');
  await clickText(page, '.dialog .btn-primary', 'שמירה');
  await wait(300);
  console.log('QA TOAST:', await txt(page, '.toast'));

  // חזרה לברירת מחדל
  await page.setViewport({ width: 1440, height: 900 });
  await wait(300);
  await clickText(page, '.rail .nav-edit', 'סידור התפריט');
  await wait(200);
  await clickText(page, '.ne .btn', 'חזרה לברירת המחדל');
  await clickText(page, '.ne .btn-primary', 'שמירה');
  await wait(400);
  console.log('RAIL RESET:', (await rail(page)).join(' | '));

  // הגדרות: סוגי פעילות, שינוי שם לתגית, לוגו, גוגל שיטס
  await page.evaluate(() => { location.hash = 'settings'; });
  await wait(500);
  await clickText(page, '.msg-tabs button', 'ניקוד');
  await wait(300);
  console.log('ITYPES ROWS:', (await page.$$('.it-tbl tbody tr')).length);
  await clickText(page, '.msg-tabs button', 'רשימות');
  await wait(300);
  await clickText(page, '.mchip-name', 'מקורב');
  await wait(200);
  await page.evaluate(() => { const i = document.querySelector('.dialog input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'מקורב מאוד'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await clickText(page, '.dialog .btn-primary', 'שמירה');
  await wait(300);
  console.log('RENAME:', await txt(page, '.toast'));
  await clickText(page, '.msg-tabs button', 'ייבוא וגיבוי');
  await wait(300);
  console.log('SHEETS CARD:', (await txt(page, '.set-grid')).includes('גוגל שיטס'));
  await clickText(page, '.msg-tabs button', 'כללי');
  await wait(300);
  console.log('LOGO CARD:', (await txt(page, '.set-grid')).includes('לוגו'));
  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
