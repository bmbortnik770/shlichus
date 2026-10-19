// מסך היום: ימי הולדת (ילד והורה), בר מצווה מתקרבת, יום שנה לאירוע חיים
const { open, wait, txt, all } = require('./smoke-lib.cjs');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (years, days) => { const d = new Date(); d.setFullYear(d.getFullYear() + years); d.setDate(d.getDate() + days); return iso(d); };

(async () => {
  const { browser, page, errors } = await open('today');
  const dates = { bm: shift(-13, 20), bday: shift(-8, 3), father: shift(-40, 1), wedding: shift(-1, 5) };
  await page.evaluate((dt) => new Promise((res) => {
    const r = indexedDB.open('shlichus', 1);
    r.onsuccess = () => {
      const st = r.result.transaction('kv', 'readwrite').objectStore('kv');
      const g = st.get('community_data_final');
      g.onsuccess = () => {
        const db = g.result;
        const key = Object.keys(db).find((k) => (db[k]?.apts ?? []).some((a) => a.name === 'כהן'));
        const apt = db[key].apts.find((a) => a.name === 'כהן');
        apt.childrenList = [{ name: 'מנחם', gender: 'boy', dob: dt.bm }, { name: 'חיה', gender: 'girl', dob: dt.bday }];
        apt.fatherDob = dt.father;
        apt.lifecycleEvents = [{ type: 'wedding', date: dt.wedding, memberKey: 'family', memberName: '' }];
        db.meta.lastModified = Date.now();
        st.put(db, 'community_data_final').onsuccess = () => res();
      };
    };
  }), dates);
  await page.reload({ waitUntil: 'networkidle2' });
  await wait(1500);
  const people = await all(page, '.person');
  console.log('COHEN:', people.filter((p) => p.includes('כהן')).join(' || ').slice(0, 400));
  console.log('UPCOMING:', (await all(page, '.day')).filter((d) => /מנחם|חיה|אברהם|חתונה/.test(d)).join(' || '));
  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
