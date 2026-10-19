// אירועים: מדדים, סוג תאריך מותאם, משימה מתאריך, אירוע → הודעה לנרשמים; תיעודים מרוכזים
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

(async () => {
  const { browser, page, errors } = await open('events');
  console.log('KPIS:', (await all(page, '.ev-kpi')).join(' | '));

  // סוג מותאם
  await clickText(page, '.hello-acts .btn', 'סוגי תאריכים');
  await wait(200);
  await setVal(page, '.dialog input[aria-label="שם הסוג"]', 'יום עלייה');
  await clickText(page, '.dialog .btn-primary', 'הוספה');
  await wait(300);
  console.log('TYPES:', (await all(page, '.dialog .fc-list li')).join(' | '));
  await page.keyboard.press('Escape');
  await wait(200);

  // משימה מתאריך של משפחה
  const hadTask = await clickText(page, '.cal-task', 'משימה');
  await wait(300);
  console.log('TASK FROM DATE:', hadTask, await txt(page, '.toast'));

  // אירוע חדש + רישום + הודעה לנרשמים
  await clickText(page, '.hello-acts .btn-primary', 'אירוע חדש');
  await wait(200);
  await setVal(page, '.ev-form input', 'התוועדות י״ט כסלו');
  const d = new Date(); d.setDate(d.getDate() + 10);
  await setVal(page, '.ev-form input[type="date"]', d.toISOString().slice(0, 10));
  await setVal(page, '.ev-form input[type="time"]', '20:00');
  await clickText(page, '.ev-form .btn-primary', 'יצירה');
  await wait(400);
  await setVal(page, 'input[aria-label="רישום לאירוע"]', 'משפחת כהן');
  await clickText(page, '.ev-regs .btn', 'רישום');
  await wait(300);
  console.log('EVENT ACTS:', await txt(page, '.ev-acts'), '| REGS:', await txt(page, '.ev-regs h3'));
  await clickText(page, '.ev-acts .btn', 'הודעה לנרשמים');
  await wait(800);
  console.log('HASH:', await page.evaluate(() => location.hash), '| AUD:', await txt(page, '.aud-head'));
  console.log('TEXT:', await page.$eval('.compose textarea', (t) => t.value).catch(() => 'none'));

  // תיעודים מרוכזים
  await clickText(page, '.msg-tabs button', 'תיעודים');
  await wait(300);
  console.log('ALLDOCS:', await txt(page, '.hist .com-bar .meta'));

  // כרטיס משפחה: הסוג המותאם מופיע
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await wait(200);
  await page.type('.pal-in input', 'כהן');
  await wait(200);
  await page.keyboard.press('Enter');
  await wait(500);
  await clickText(page, '.fc-tabs button', 'חיים ומועדים');
  await wait(300);
  const opts = await page.$$eval('.fc-add-col select[aria-label="סוג"] option', (o) => o.map((x) => x.textContent));
  console.log('MS TYPES:', opts.join(', '));
  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
