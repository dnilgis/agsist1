# AGSIST Full Audit Report
Generated: 2026-02-27

---

## 🚨 CRITICAL: spray.html + urea.html — ALL Page-Specific CSS is MISSING

Both pages use dozens of classes that don't exist in `styles.css` and have **no `/css/spray.css`
or `/css/urea.css` linked in their `<head>`**. The pages render with zero styling on their
custom elements. This is why they look "weird."

### spray.html — Missing CSS classes (not in styles.css):
.hero, .hero-inner, .hero-eyebrow, .hero-title, .hero-sub
.status-panel, .status-lbl, .status-icon, .status-main(.good/.marginal/.poor), .status-sub, .status-loc
.loc-setup, .btn-g, .btn-q, .zip-row, .zip-in
.pg (two-column page grid)
.factors, .fcard, .fcard-head, .fcard-name, .fcard-icon, .fchip(.good/.marginal/.poor), .fcard-val, .fcard-desc, .fcard-bar, .fcard-bar-fill
.hr-item(.good/.marginal/.poor), .hr-time, .hr-icon, .hr-wind, .hr-badge
.window-head, .hourly-scroll
.edu, .edu-title, .edu-grid, .edu-card, .edu-card-icon, .edu-card-title, .edu-card-text, .edu-card-tip
.inv-box, .inv-title, .inv-diagram, .inv-layer(.warm/.cool/.ground), .inv-arrow
.sidebar, .sc, .sc-title
.rec(.good/.marginal/.poor), .rec-h, .rec-t
.day-strip, .day-item, .day-name, .day-icon, .day-rating, .day-wind
.cross-link, .cross-link-icon, .cross-link-title, .cross-link-text, .cross-link-arrow

### urea.html — Missing CSS classes:
.hero (same as spray — shared)
.risk-panel, .risk-panel-lbl, .risk-badge(.low/.moderate/.high/.extreme), .risk-verdict, .risk-location
.gauge-wrap, .gauge-svg, .gauge-track, .gauge-fill, .gauge-score, .gauge-num, .gauge-unit
.loc-setup, .loc-btn-row, .btn-primary, .btn-secondary, .zip-row, .zip-input
.page-grid
.factors-grid, .factor, .factor-head, .factor-title, .factor-icon, .factor-score(.low/.mod/.hig), .factor-val, .factor-desc, .factor-bar, .factor-bar-fill
.edu-section, .edu-head, .chem-box, .chem-eq, .molecule, .arrow, .loss, .chem-note
.edu-grid, .edu-card, .edu-card-icon, .edu-card-title, .edu-card-text, .edu-card-risk
.sidebar, .s-card, .s-card-title
.rec-box(.low/.moderate/.high/.extreme), .rec-head(.low/.moderate/.high/.extreme), .rec-text, .rec-detail
.forecast-strip, .fc-day, .fc-day-name, .fc-day-icon, .fc-day-risk, .fc-day-temp
.stabilizer-cta, .stab-badge, .stab-title, .stab-text

### urea.html — Missing CSS variables (used in JS + HTML, not defined anywhere):
--risk-low     → should be var(--green)   #3ecf6e
--risk-mod     → should be var(--gold)    #e6b042
--risk-high    → should be              #f0913a (orange)
--risk-extreme → should be var(--red)    #f06060
--orange       → #f0913a (used in urea sidebar CTA)

FIX: Add to :root in styles.css. Create /css/spray.css and /css/urea.css.
Also add <link rel="stylesheet" href="/css/spray.css"> to spray.html
and <link rel="stylesheet" href="/css/urea.css"> to urea.html.

---

## ⚠️ BUGS: spray.html + urea.html — Inline Theme Script Conflict

Both pages have this block at the top of their `<script>`:
  function setTheme(t) { ... document.getElementById('theme-icon').textContent = ... }
  setTheme(getTheme());
  var _tb = document.getElementById('theme-btn');
  if (_tb) _tb.addEventListener('click', ...)

Problems:
1. `#theme-btn` and `#theme-icon` are INSIDE header.html, which hasn't been injected yet
   when this runs (loader.js runs on DOMContentLoaded). The addEventListener is always skipped.
2. loader.js ALREADY handles theme toggle in initNav() — this code is dead duplicate.
3. setTheme(getTheme()) does run but the icon update silently fails (element not in DOM).

FIX: Delete the theme block from both page scripts. loader.js handles it completely.

---

## ⚠️ REDUNDANT: spray.html + urea.html — Duplicate Font Import

Both pages have:
  <link href="https://fonts.googleapis.com/...JetBrains+Mono+Oswald..." rel="stylesheet">

styles.css already has @import at the top for these same fonts.
This causes a second HTTP request for the same fonts.

FIX: Remove the <link> font tags from both pages. styles.css handles it.

---

## ✅ FINE: usda-calendar.html
- Inline <style> block contains all custom CSS — working correctly
- No missing dependencies
- loader.js placed correctly at bottom
- No redundant theme script

## ✅ FINE: usda-quick-stats.html
- Inline <style> block contains all custom CSS — working correctly  
- USDA iframe sandbox is correct
- No issues

---

## 📋 SIGNUP CTA — Progressive Disclosure Plan

Current behavior: signup shows if visit count < 4 AND no subscribed cookie.
Requested behavior:
- Visits 1–3: Full signup card (current size)
- Visits 4–6: Compact inline bar (email only, minimal height)
- Visits 7+: Hidden entirely (or tiny ghost text link in footer area)
- Subscribed: Always hidden

Implementation: localStorage key `agsist-vc` (visit count, set once per session).
Add `.signup--compact` CSS variant. JS reads count and applies class or hides.

---

## FIXES NEEDED (priority order):
1. Add --risk-* vars to styles.css :root ← urea.html broken without these
2. Create /css/spray.css ← spray.html unstyled
3. Create /css/urea.css ← urea.html unstyled  
4. Add <link> for page CSS in spray.html and urea.html
5. Remove duplicate theme scripts from spray.html and urea.html
6. Remove duplicate font imports from spray.html and urea.html
7. Add progressive signup disclosure logic
