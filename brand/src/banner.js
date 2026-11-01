const { chromium } = require('playwright');
(async () => {
  const N = +process.argv[3];
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 500 } });
  await p.goto('file://' + __dirname + '/banner.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  for (let i = 0; i < N; i++) {
    await p.evaluate((t) => render(t), i / N);
    await p.locator('#b').screenshot({ path: process.argv[2] + '/f' + String(i).padStart(3, '0') + '.png' });
  }
  await b.close();
})();
