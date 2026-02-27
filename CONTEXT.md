# AGSIST — Project Context
> Read this first in any new chat. Everything you need is here.

## What Is AGSIST
Free agricultural dashboard at **agsist.com** built by Farmers First Agri Service.
Serves corn, soybean, and grain producers: live prices, farm weather, spray advisory, USDA data, tools.
Deployed on **GitHub Pages**. Codebase is static HTML/CSS/JS — no framework, no build step.

---

## Stack & Services
| Layer | Tech | Notes |
|-------|------|-------|
| Hosting | GitHub Pages | `main` branch auto-deploys |
| Prices | Stooq.com (free, 15-min delayed) | CORS proxied via corsproxy.io + allorigins fallback |
| Crypto | CoinGecko free API | No key needed |
| Weather | Open-Meteo (free) | No key needed |
| Geo/Reverse | Nominatim OpenStreetMap | No key needed |
| Grain Bids | Barchart OnDemand API (trial, 30 days) | Via Cloudflare Worker |
| Bids Worker | `agsist-prices.workers.dev` | `workers/barchart-proxy.js` |
| Forms | Formspree `xnjbwepn` | Email + SMS signups |
| Analytics | Google Analytics 4 `G-6KXCTD5Z9H` | In `<head>` of all pages |
| FFAI Index | `farmers1st.com/api/v3/` | Badge + current.json |
| Radar | Windy embed | Geo-updated to user's location |
| Drought | NDMC iframe | droughtmonitor.unl.edu |

---

## File Map
```
agsist/
├── index.html                  ← Homepage (920 lines after audit fixes)
├── CONTEXT.md                  ← This file
├── SECRETS.md                  ← API keys / credentials (gitignored)
├── CNAME                       ← agsist.com
├── robots.txt
├── sitemap.xml
├── manifest.json
│
├── components/
│   ├── geo.js                  ← ALL shared JS: weather, prices, ticker, geo (633 lines)
│   ├── styles.css              ← All shared CSS (dark + light theme)
│   ├── header.html             ← Injected by loader.js into #site-header
│   ├── footer.html             ← Injected by loader.js into #site-footer
│   ├── loader.js               ← Fetches + injects header/footer/analytics
│   ├── analytics.html          ← GA4 snippet (also in each page head directly)
│   └── state.js                ← Shared localStorage state helpers
│
├── pages/                      ← Secondary pages
│   ├── about.html
│   ├── contact.html
│   ├── tools.html
│   ├── data-sources.html
│   ├── fast-facts.html
│   ├── grain-bin-calculator.html
│   └── breakeven.html
│
├── legal/
│   ├── privacy.html
│   ├── terms.html
│   ├── disclaimer.html
│   ├── cookies.html
│   └── accessibility.html
│
├── img/                        ← All images (already extracted from HTML)
│   ├── agsist-logo.png
│   ├── logo-agsist.jpg
│   ├── favicon.ico / favicon-32.png / favicon-16.png / apple-touch-icon.png
│   └── og-agsist.jpg
│
├── data/
│   └── prices.json             ← Seed / cache for GitHub Actions pre-fetch
│
├── scripts/
│   └── fetch_barchart.py       ← GitHub Actions price fetcher (817 lines)
│
├── workers/
│   ├── barchart-proxy.js       ← Cloudflare Worker (hides API key, enables CORS)
│   └── wrangler.toml           ← Worker config
│
├── docs/
│   └── barchart-setup.md       ← Barchart integration guide
│
├── .github/
│   └── workflows/
│       └── prices.yml          ← Runs fetch_barchart.py every 30min M-F 8:30-5pm ET
│
├── .nojekyll                   ← Required for GitHub Pages non-Jekyll
├── _headers                    ← Cloudflare/Netlify headers (security, cache)
└── 404.html
```

---

## Architecture — How Pages Work

### Component Loading
`loader.js` runs on every page. It fetches `header.html` and `footer.html` and injects them into `#site-header` and `#site-footer` divs. This means nav + footer are maintained in one place.

### Shared JS (geo.js)
`/components/geo.js` is the single source of truth for:
- Weather fetching (Open-Meteo) + spray conditions + urea volatilization risk
- Live price fetching (Stooq CORS proxy, with fallback)
- CoinGecko crypto prices
- FFAI Index
- Ticker strip (rebuildTickerLoop)
- Geolocation → reverse geocode → cash bids auto-populate
- 4-day forecast
- Widget preview panel updates

**Page-level `<script>` blocks should only contain:** theme toggle, nav/drawer, Daily dismiss, signup logic, scroll reveal. Nothing else.

### Price Data Flow (3 layers)
1. **GitHub Actions** pre-fetches every 30min → commits `data/prices.json`
2. **Cloudflare Worker** (`agsist-prices.workers.dev`) proxies Barchart API real-time
3. **Client JS** (geo.js) hits Worker → falls back to prices.json → shows error

---

## Key Decisions & Patterns

- **No framework.** Pure HTML/CSS/JS. Keeps load fast and hosting simple.
- **Dark theme default.** Toggle persists to localStorage `agsist-theme`.
- **Signup section hides if:** user has cookie `agsist_subscribed=1` OR visit count ≥ 4. Formspree endpoint: `xnjbwepn`. Visit count increments ONCE per page load.
- **Daily briefing dismiss:** `localStorage[TODAY_KEY]` where `TODAY_KEY` is dynamic (`agsist-daily-YYYY-MM-DD`). Resets every day automatically.
- **Cash bids:** `#bids-list-area` is the injection target. `loadCashBids(zip)` hits Worker, falls back to placeholder. Barchart trial expires ~30 days from activation.
- **Grain prices use fraction notation:** `4¼`, `9½` etc. See `fmtStooqPrice()` in geo.js.
- **Weather:** Open-Meteo free tier, no key, weather codes mapped in `WX_CODES`/`WX_ICONS`.
- **Urea risk:** 4-factor score (temp, humidity, wind, precip). `calcUrea()` in geo.js. Fixed bug where `data.temperature_2m` was used instead of already-parsed `tempF`.

---

## What's Built vs Planned

### ✅ Built & Working
- Homepage with live prices, weather, spray advisory, urea risk, bids skeleton, USDA calendar, radar
- Ticker strip with Stooq + CoinGecko + FFAI
- AGSIST Daily hero with dismiss (daily key, dynamic)
- Email + SMS signup with success states, cookie persistence
- Cloudflare Worker (barchart-proxy.js) — needs deployment
- GitHub Actions price pre-fetch (prices.yml)
- Full component architecture (header, footer, loader)
- All legal pages
- SEO (OG, Twitter Card, JSON-LD structured data)
- Dark/light theme

### 🔧 In Progress / Needs Attention
- Barchart trial active — real cash bids need Worker deployed to Cloudflare
- Daily briefing content is sample/static — needs CMS or data file for real updates
- USDA calendar dates are hardcoded — would benefit from `data/usda-reports.json`
- Secondary pages (crop progress, export sales, ag news) are stubs

---

## Deployment
GitHub Pages — `main` branch. `CNAME` = `agsist.com`.
Push to main → live within ~60 seconds.
Worker deploy: `cd workers && wrangler deploy`

## Contact / Accounts
- Phone: 715-797-2428
- Site: farmers1st.com
- GA4: G-6KXCTD5Z9H
- Formspree: xnjbwepn
- Barchart API key: in SECRETS.md
