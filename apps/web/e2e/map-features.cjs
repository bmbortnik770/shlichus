// בדיקת המפה וכרטיס הבניין: מצבי צבע, לוויין, הביתה, פרטי בניין, ניווט, כרטיס מוסד, שיבוץ לדירה, בניין ידני
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
  const { browser, page, errors } = await open('community/people');
  // בניין עם משפחות — דרך "הצגה במפה" מהרשימה
  await page.click('.com-table .addr-link');
  await page.waitForFunction(() => window.__shlichusMap && window.__shlichusMap.loaded() && document.querySelector('.sheet h2'), { timeout: 90000 }).catch(() => {});
  await wait(1500);
  console.log('MODES:', (await all(page, '.map-top .seg button')).join(' | '));
  console.log('TOP BTNS:', (await all(page, '.map-top .map-btn')).join(' | '));
  console.log('CARD:', await txt(page, '.sheet h2'), '| NAV:', await txt(page, '.sheet .nav-row'));
  const waze = await page.$eval('.sheet .nav-row a', (a) => a.href).catch(() => 'none');
  console.log('WAZE:', waze);

  // פרטי בניין
  await clickText(page, '.bd .link', 'הוספה');
  await wait(200);
  await setVal(page, '.bd-form input[dir="ltr"]', '1234#');
  await page.evaluate(() => { const f = [...document.querySelectorAll('.bd-form .fld')].find((l) => l.textContent.includes('נציג')); const i = f.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'ישראל'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await clickText(page, '.bd-form .btn-primary', 'שמירה');
  await wait(400);
  console.log('DETAILS:', await txt(page, '.bd-list'));

  // שיבוץ: לחיצה על משבצת ריקה
  const empty = await page.$('.floors button.apt:not(.known)');
  if (empty) {
    await empty.click();
    await wait(200);
    console.log('SLOT PICK:', await txt(page, '.slot-pick'));
    await clickText(page, '.slot-pick .chip-f', 'משפחה חדשה');
    await wait(200);
    console.log('ADD FORM NUM:', await page.$eval('.add-fam input[aria-label="מספר דירה"]', (i) => i.value).catch(() => 'none'));
  } else console.log('NO EMPTY SLOT');
  await page.screenshot({ path: out + '/bcard.png' });

  // סוג: בית כנסת → כרטיס מוסד
  await clickText(page, '.cat-pick button', 'דת ובית כנסת');
  await wait(500);
  console.log('INSTITUTION:', (await txt(page, '.inst')).slice(0, 120));

  // מצבי צבע + מקרא
  await clickText(page, '.map-top .seg button', 'סוג בניין');
  await wait(400);
  console.log('LEGEND CAT:', (await txt(page, '.legend')).slice(0, 200));
  await clickText(page, '.map-top .seg button', 'סגנון');
  await wait(400);
  console.log('LEGEND STYLE:', await txt(page, '.legend'));
  await clickText(page, '.map-top .seg button', 'תגית');
  await wait(400);
  console.log('TAG SELECT:', await txt(page, '.map-sel'), '| LEGEND:', await txt(page, '.legend'));
  await clickText(page, '.map-top .map-btn', 'לוויין');
  await wait(2500);
  console.log('SAT:', await page.evaluate(() => window.__shlichusMap.getLayoutProperty('sat', 'visibility')));
  await page.screenshot({ path: out + '/map-sat.png' });
  await clickText(page, '.map-top .map-btn', 'לוויין');
  console.log('HOME MARK:', !!(await page.$('.home-mark')));

  // בניין ידני: נקודה ריקה במפה
  await page.click('.sheet .icon-btn[aria-label="סגירה"]').catch(() => {});
  await clickText(page, '.map-top .map-btn', 'בניין ידני');
  await wait(300);
  const pt = await page.evaluate(() => {
    const m = window.__shlichusMap; const c = m.getCanvas();
    for (let y = 200; y < c.clientHeight - 100; y += 25) for (let x = 100; x < c.clientWidth - 100; x += 25) {
      if (!m.queryRenderedFeatures([x, y], { layers: ['b-fill', 'b-fam', 'orphans'] }).length) return [x, y];
    }
    return null;
  });
  const box = await page.$eval('.map-box', (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top]; });
  await page.mouse.click(box[0] + pt[0], box[1] + pt[1]);
  await wait(400);
  await setVal(page, '.dialog input', 'הרב ניסים 99');
  await page.evaluate(() => { const i = document.querySelectorAll('.dialog input')[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '6'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await clickText(page, '.dialog .btn-primary', 'הוספה');
  await wait(1500);
  console.log('MANUAL CARD:', await txt(page, '.sheet h2'), '|', await txt(page, '.sheet .facts'));
  await page.screenshot({ path: out + '/map-manual.png' });

  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
