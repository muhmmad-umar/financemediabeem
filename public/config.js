/* Where the Media Beem API (Cloudflare Worker) lives.
   Local dev:  http://localhost:8787
   Production: set this to your deployed Worker URL, e.g. https://mediabeem-api.<your-subdomain>.workers.dev */
window.MB_CONFIG = {
  API_BASE: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8787'
    : 'https://mediabeem-api.REPLACE-ME.workers.dev'
};
