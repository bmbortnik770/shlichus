// בדיקת המבנה החדש: תפריט, הקהילה (מפה/אנשים/מעגלים), לוח פקודות, פעילות ועוד בטלפון
const { open, wait, txt, all, clickText } = require('./smoke-lib.cjs');
const out = process.env.OUT || __dirname + '/out';
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const { browser, page, errors } = await open('today');
  console.log('RAIL:', (await all(page, '.rail .nav-item, .rail .nav-sec')).join(' | '));
  console.log('TODAY TASKS:', await txt(page, '.today-tasks'));
  // לוח פקודות: חיפוש משפחה → כרטיס
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await wait(300);
  await page.type('.pal-in input', 'כהן');
  await wait(300);
  console.log('PALETTE:', (await all(page, '.pal-list li[role="option"]')).slice(0, 3).join(' || '));
  await page.keyboard.press('Enter');
  await wait(600);
  console.log('CARD FROM PALETTE:', await txt(page, '.fc-id h2'));
  await page.keyboard.press('Escape');
  await wait(300);
  // פקודה: מעבר למעגלים
  await page.click('.search-trigger');
  await page.type('.pal-in input', 'מעגלים');
  await page.keyboard.press('Enter');
  await wait(600);
  console.log('HASH:', await page.evaluate(() => location.hash), '| H1:', await txt(page, 'h1'), '| CIRCLES:', (await all(page, '.circle header b')).join(', '));
  // אנשים → כתובת → מפה
  await clickText(page, '.com-switch button', 'אנשים');
  await wait(500);
  console.log('PEOPLE ROWS:', (await page.$$('.com-table tbody tr')).length);
  await page.click('.com-table .addr-link');
  await page.waitForFunction(() => document.querySelector('.sheet h2'), { timeout: 60000 }).catch(() => {});
  await wait(1500);
  console.log('HASH AFTER ADDR:', await page.evaluate(() => location.hash), '| MAP CARD:', await txt(page, '.sheet h2'));
  console.log('PROGRESS:', await txt(page, '.map-progress'));
  await page.screenshot({ path: out + '/map-progress.png' });
  // משפחה מכרטיס הבניין
  await page.click('.sheet .fam-open').catch(() => console.log('NO FAMILY IN BUILDING'));
  await wait(500);
  console.log('FAMILY FROM BUILDING:', await txt(page, '.fc-id h2'));
  await page.keyboard.press('Escape');
  await wait(300);
  // טלפון
  await page.setViewport({ width: 400, height: 820, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:4310/shlichus/app/#activity', { waitUntil: 'networkidle2' });
  await wait(800);
  console.log('TABBAR:', (await all(page, '.tabbar button')).join(' | '), '| ACTIVE:', await txt(page, '.tabbar button[aria-current="page"]'));
  console.log('HUB:', (await all(page, '.hub-card')).join(' || '));
  await page.screenshot({ path: out + '/m-activity.png' });
  await clickText(page, '.hub-card', 'אירועים');
  await wait(500);
  console.log('EVENTS ACTIVE TAB:', await txt(page, '.tabbar button[aria-current="page"]'), '| H1:', await txt(page, 'h1'));
  await clickText(page, '.tabbar button', 'עוד');
  await wait(400);
  console.log('MORE:', (await all(page, '.hub-card b')).join(', '), '| SYNC:', await txt(page, '.more-card .sheet-hint'));
  await page.screenshot({ path: out + '/m-more.png' });
  await clickText(page, '.tabbar button', 'הקהילה');
  await wait(4000);
  await page.screenshot({ path: out + '/m-community.png' });
  console.log('M COMMUNITY HASH:', await page.evaluate(() => location.hash));
  console.log('ERRORS:', [...new Set(errors)].filter((e) => !e.includes('gisviewer') && !e.includes('ERR_ABORTED')).join(' | '));
  await browser.close();
})();
