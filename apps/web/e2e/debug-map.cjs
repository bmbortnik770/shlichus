const { open, wait } = require('./smoke-lib.cjs');
(async () => {
  const { browser, page, errors } = await open('community/map');
  await page.waitForFunction(() => window.__shlichusMap && window.__shlichusMap.getSource('shapes'), { timeout: 60000 }).catch(() => {});
  await wait(6000);
  const info = await page.evaluate(() => {
    const m = window.__shlichusMap;
    const src = m.getSource('shapes');
    const data = src && (src._data || src.serialize?.().data);
    const feats = data?.features || [];
    return {
      zoom: m.getZoom().toFixed(2), center: m.getCenter().toArray().map((x) => x.toFixed(4)),
      shapes: feats.length, firstColor: feats[0]?.properties?.color, firstRing: JSON.stringify(feats[0]?.geometry?.coordinates?.[0]?.slice(0, 2)),
      vis: ['b-fill', 'b-3d', 'b-line', 'terr-mask'].map((l) => `${l}:${m.getLayoutProperty(l, 'visibility') ?? 'visible'}`),
      rendered: m.queryRenderedFeatures({ layers: ['b-fill'] }).length,
      maskOpacity: m.getPaintProperty('terr-mask', 'fill-opacity'),
    };
  });
  console.log(JSON.stringify(info));
  console.log('ERRORS:', errors.join(' | ').slice(0, 600));
  await browser.close();
})();
