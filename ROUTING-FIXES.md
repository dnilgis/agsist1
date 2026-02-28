# AGSIST Routing Fix — Required File Moves
# ==========================================
# GitHub Pages serves files at their actual path.
# pages/about.html is at /pages/about, NOT /about.
# The nav and footer link to /about, /contact, etc.
#
# FIX: Move these files from pages/ to root:
#
#   pages/about.html            → about.html
#   pages/contact.html          → contact.html
#   pages/breakeven.html        → breakeven.html
#   pages/grain-bin-calculator.html → grain-bin-calculator.html
#   pages/fast-facts.html       → fast-facts.html
#   data-sources.html           → stays at root ✅ (already there)
#
# FIX: Move legal pages from legal/ to root OR update all footer links.
# Option A (simpler — move to root):
#   legal/privacy.html      → privacy.html
#   legal/terms.html        → terms.html
#   legal/disclaimer.html   → disclaimer.html
#   legal/cookies.html      → cookies.html
#   legal/accessibility.html → accessibility.html
#   Then update footer.html links from /legal/privacy → /privacy
#
# Option B (keep in legal/, update links):
#   Footer already updated to use /legal/privacy etc. — done in this fix.
#
# STUB PAGES STILL NEEDED (nav links go to these, pages don't exist yet):
#   /spray                   — Spray conditions page
#   /urea                    — Urea risk page
#   /developer               — Developer/embed docs
#   /daily                   — AGSIST Daily archive
#   /corn-futures-prices     — Corn charts
#   /soybean-futures-prices  — Bean charts
#   /wheat-futures-prices    — Wheat charts
#   /cash-bids               — Cash bids lookup
#   /markets                 — All markets overview
#   /drought-monitor         — Drought monitor full page
#   /gdu-calculator          — GDU tracker
#   /usda-calendar           — USDA reports calendar
#   /usda-quick-stats        — USDA quick stats
#
# Use components/page-template.html as the starting point for each.
