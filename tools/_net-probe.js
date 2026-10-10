'use strict';
/* TEMPORARY: can this Node reach the GitHub API, and does it need the proxy? */
const targets = ['https://api.github.com/zen', 'https://api.github.com/rate_limit'];
(async () => {
  for (const url of targets) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'eu4-mod-viewer-probe' } });
      const body = (await r.text()).slice(0, 60).replace(/\s+/g, ' ');
      console.log(`OK   ${r.status}  ${Date.now() - t0}ms  ${url}  ${body}`);
    } catch (e) {
      console.log(`FAIL ${Date.now() - t0}ms  ${url}  ${e.message}`);
    }
  }
  console.log('node ' + process.version);
})();
