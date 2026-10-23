/* Runtime config for all three portals.
   API_BASE — the Media Beem API (Cloudflare Worker). Local dev talks to `npm run dev` on :8787.
   PORTALS  — where each role lives after login. */
(function () {
  var h = location.hostname, dev = h === 'localhost' || h === '127.0.0.1' || /\.localhost$/.test(h);
  window.MB_CONFIG = {
    API_BASE: dev ? 'http://localhost:8787' : 'https://mediabeem-api.muhammadumarr4.workers.dev',
    PORTALS: { admin: 'https://admin.mediabeem.com', employee: 'https://employee.mediabeem.com', client: 'https://client.mediabeem.com' }
  };
})();
