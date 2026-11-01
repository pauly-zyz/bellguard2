const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  await p.goto('file://' + __dirname + '/logo.html');
  await p.locator('#c').screenshot({ path: process.argv[2] });
  await b.close();
})();
