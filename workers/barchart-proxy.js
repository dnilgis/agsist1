/**
 * AGSIST Barchart Proxy — Cloudflare Worker
 * ──────────────────────────────────────────
 * Hides the Barchart API key, enables CORS, normalizes response format.
 *
 * Routes:
 *   GET /api/quotes                    → Futures price quotes (ticker + price cards)
 *   GET /api/grain-bids?zip=&commodityCode=  → Local elevator cash bids
 *
 * Barchart API key is set as a Worker secret: BARCHART_API_KEY
 * Deploy: cd workers && wrangler deploy
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Internal key → Barchart continuous contract symbol
// Using *0 suffix for front-month continuous contracts
const SYMBOL_MAP = {
  'corn':       { sym: '@C*0',  label: 'Corn (front)',    dec: 2, grain: true  },
  'corn-dec':   { sym: 'ZCZ26', label: "Corn Dec'26",     dec: 2, grain: true  },
  'beans':      { sym: '@S*0',  label: 'Beans (front)',   dec: 2, grain: true  },
  'beans-nov':  { sym: 'ZSX26', label: "Beans Nov'26",    dec: 2, grain: true  },
  'wheat':      { sym: '@W*0',  label: 'Wheat (front)',   dec: 2, grain: true  },
  'cattle':     { sym: '@LC*0', label: 'Live Cattle',     dec: 3, grain: false },
  'feeders':    { sym: '@GF*0', label: 'Feeder Cattle',   dec: 3, grain: false },
  'hogs':       { sym: '@LH*0', label: 'Lean Hogs',       dec: 3, grain: false },
  'meal':       { sym: '@SM*0', label: 'Soy Meal',        dec: 2, grain: false },
  'soyoil':     { sym: '@BO*0', label: 'Soy Oil',         dec: 2, grain: false },
  'crude':      { sym: '@CL*0', label: 'Crude WTI',       dec: 2, grain: false },
  'natgas':     { sym: '@NG*0', label: 'Natural Gas',     dec: 3, grain: false },
  'gold':       { sym: '@GC*0', label: 'Gold',            dec: 0, grain: false },
  'silver':     { sym: '@SI*0', label: 'Silver',          dec: 2, grain: false },
  'dollar':     { sym: '@DX*0', label: 'Dollar Index',    dec: 2, grain: false },
  'treasury10': { sym: 'ZNM25', label: '10-Yr Treasury',  dec: 2, grain: false },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── /api/quotes ────────────────────────────────────────────────
    if (url.pathname === '/api/quotes') {
      return handleQuotes(url, env);
    }

    // ── /api/grain-bids ───────────────────────────────────────────
    if (url.pathname === '/api/grain-bids') {
      return handleGrainBids(url, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

// ──────────────────────────────────────────────────────────────────
// QUOTES — fetch futures prices for all mapped symbols
// ──────────────────────────────────────────────────────────────────
async function handleQuotes(url, env) {
  const apiKey = env.BARCHART_API_KEY;
  if (!apiKey) {
    return jsonError('BARCHART_API_KEY not configured', 500);
  }

  // Accept optional ?keys= filter, default to all
  const keysParam = url.searchParams.get('keys');
  const keys = keysParam
    ? keysParam.split(',').filter(k => SYMBOL_MAP[k])
    : Object.keys(SYMBOL_MAP);

  const barchartSyms = keys.map(k => SYMBOL_MAP[k].sym).join(',');
  const fields = 'symbol,name,lastPrice,openPrice,previousClose,netChange,percentChange,tradeTime,contractSymbol';

  const apiUrl = `https://ondemand.websol.barchart.com/getQuote.json`
    + `?apikey=${apiKey}&symbols=${encodeURIComponent(barchartSyms)}&fields=${fields}`;

  try {
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'AGSIST/1.0 (agsist.com)' },
      cf: { cacheTtl: 60, cacheEverything: false }
    });

    if (!resp.ok) {
      return jsonError(`Barchart API ${resp.status}`, 502);
    }

    const data = await resp.json();

    if (!data.results || !data.results.length) {
      return jsonError('No results from Barchart', 502);
    }

    // Build reverse map: Barchart sym → internal key
    const reverseMap = {};
    keys.forEach(k => { reverseMap[SYMBOL_MAP[k].sym] = k; });

    // Normalize to our format
    const quotes = {};
    data.results.forEach(r => {
      const key = reverseMap[r.symbol] || reverseMap[r.contractSymbol];
      if (!key) return;
      const meta = SYMBOL_MAP[key];
      quotes[key] = {
        key,
        label:         meta.label,
        close:         r.lastPrice,
        open:          r.openPrice,
        prevClose:     r.previousClose,
        netChange:     r.netChange,
        percentChange: r.percentChange,
        tradeTime:     r.tradeTime,
        dec:           meta.dec,
        grain:         meta.grain,
        source:        'barchart',
      };
    });

    return new Response(JSON.stringify({ status: 200, quotes, generated: new Date().toISOString() }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
    });

  } catch (err) {
    return jsonError('Worker fetch error: ' + err.message, 502);
  }
}

// ──────────────────────────────────────────────────────────────────
// GRAIN BIDS — local elevator bids by ZIP
// ──────────────────────────────────────────────────────────────────
async function handleGrainBids(url, env) {
  const apiKey = env.BARCHART_API_KEY;
  if (!apiKey) {
    return jsonError('BARCHART_API_KEY not configured', 500);
  }

  const zip           = url.searchParams.get('zip') || '';
  const commodityCode = url.searchParams.get('commodityCode') || 'corn,soybeans';
  const radius        = url.searchParams.get('radius') || '75';

  if (!zip || zip.length !== 5 || isNaN(zip)) {
    return jsonError('Valid 5-digit ZIP required', 400);
  }

  const apiUrl = `https://ondemand.websol.barchart.com/getGrainBids.json`
    + `?apikey=${apiKey}&postalCode=${zip}&commodityCode=${encodeURIComponent(commodityCode)}`
    + `&radius=${radius}&limit=20&fields=locationName,commodityDisplayName,cashPrice,basisPrice,deliveryMonthCode,distance`;

  try {
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'AGSIST/1.0 (agsist.com)' },
      cf: { cacheTtl: 300, cacheEverything: false }
    });

    if (!resp.ok) {
      return jsonError(`Barchart API ${resp.status}`, 502);
    }

    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
    });

  } catch (err) {
    return jsonError('Worker fetch error: ' + err.message, 502);
  }
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
