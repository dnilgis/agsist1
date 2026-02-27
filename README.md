# AGSIST — Agricultural Support Services

Free agricultural dashboard for corn, soybean, and grain producers.  
Live at **[agsist.com](https://agsist.com)**

Built by [Farmers First Agri Service](https://farmers1st.com) — crop insurance, Wisconsin & Minnesota.

---

## Repo Structure

```
agsist/
├── index.html                  # Main dashboard
├── spray.html                  # Spray timing advisor
├── urea.html                   # Urea volatilization risk
├── developer.html              # Embed / API docs
├── 404.html                    # Custom not-found page
│
├── pages/                      # Content & info pages
│   ├── about.html
│   ├── contact.html
│   └── data-sources.html
│
├── legal/                      # Legal pages
│   ├── privacy.html
│   ├── terms.html
│   ├── disclaimer.html
│   ├── cookies.html
│   └── accessibility.html
│
├── components/                 # ← Shared across every page
│   ├── loader.js               # Injects header/footer/analytics
│   ├── header.html             # Nav bar (edit once = updates everywhere)
│   ├── footer.html             # Footer + email signup
│   ├── styles.css              # All shared CSS
│   ├── analytics.html          # GA4 (update G-6KXCTD5Z9H here)
│   ├── geo.js                  # Geolocation (weather + bids pages only)
│   ├── page-template.html      # ← Start every new page from this
│   └── seo-template.html       # SEO block reference for new pages
│
├── img/                        # All images — NO base64 in HTML
│   ├── logo-agsist.jpg
│   ├── icon-chart.jpg
│   ├── icon-nav-*.png
│   ├── favicon.ico
│   ├── favicon-32.png
│   ├── favicon-16.png
│   ├── apple-touch-icon.png
│   ├── icon-192.png
│   ├── icon-512.png
│   └── og/                     # Open Graph share images (1200×630)
│       ├── agsist.jpg
│       ├── spray.jpg
│       └── ...
│
├── css/                        # Page-specific CSS (as needed)
│
├── sitemap.xml
├── robots.txt
├── manifest.json               # PWA manifest
├── CNAME                       # agsist.com
├── .nojekyll                   # Prevents Jekyll processing
├── _headers                    # Security headers (Cloudflare)
└── .github/
    └── workflows/
        └── deploy.yml          # Auto-deploy on push to main
```

## How the Component System Works

Every page contains just two placeholder divs + one script:

```html
<body>
  <div id="site-header"></div>

  <!-- page content -->

  <div id="site-footer"></div>
  <script src="/components/loader.js"></script>
</body>
```

`loader.js` fetches `header.html`, `footer.html`, and `analytics.html` and injects them automatically. **Change the nav once in `header.html` and it updates on every page instantly.**

## Adding a New Page

1. Copy `components/page-template.html` → `pages/new-page.html`
2. Fill in the SEO block (title, description, canonical URL)
3. Add your content between `<main>` tags
4. Add the URL to `sitemap.xml`
5. Push to `dev` branch → test → merge to `main`

## Before Going Live Checklist

- [ ] Replace `G-6KXCTD5Z9H` in `components/analytics.html` with real GA4 ID
- [ ] Submit `sitemap.xml` to [Google Search Console](https://search.google.com/search-console)
- [ ] Verify CNAME DNS record points to GitHub Pages
- [ ] Test all pages on mobile
- [ ] Run [PageSpeed Insights](https://pagespeed.web.dev) on homepage
- [ ] Wire email form to real Formspree ID in `components/footer.html`

## Data Sources

| Data | Provider | Delay |
|------|----------|-------|
| Grain/energy futures | Stooq.com | 15 min |
| Crypto | CoinGecko | Real-time |
| Weather | Open-Meteo | Hourly |
| Radar | Windy.com | Near real-time |
| Drought | NOAA Drought Monitor | Weekly |
| FFAI | Farmers First Agri Service | Weekly |

## Branches

| Branch | URL | Purpose |
|--------|-----|---------|
| `main` | agsist.com | Production |
| `dev`  | dev.agsist.com | Staging |

---

*AGSIST is free, ad-free, and always will be.*
