// AGSIST Barchart Proxy — Cloudflare Worker
// Proxies Barchart OnDemand API calls. API key never exposed to browser.
// Routes: /api/quotes  /api/grain-bids  /api/history  /api/expirations

const BASE = 'https://ondemand.websol.barchart.com';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const params = url.searchParams;
    params.set('apikey', env.BARCHART_API_KEY);

    let endpoint = null;

    if (path === '/api/quotes') {
      // ?symbols=ZCN25,ZSN25,...
      endpoint = `${BASE}/getQuote.json?${params}`;
    } else if (path === '/api/grain-bids') {
      // ?zip=50010&commodityCode=corn,soybeans
      endpoint = `${BASE}/getGrainBids.json?${params}`;
    } else if (path === '/api/history') {
      // ?symbol=ZCN25&type=daily&startDate=YYYYMMDD
      endpoint = `${BASE}/getHistory.json?${params}`;
    } else if (path === '/api/expirations') {
      // ?root=ZC
      endpoint = `${BASE}/getFuturesExpirations.json?${params}`;
    } else {
      return new Response('Not found', { status: 404, headers: CORS });
    }

    try {
      const res = await fetch(endpoint, { cf: { cacheTtl: 30 } });
      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  },
};
