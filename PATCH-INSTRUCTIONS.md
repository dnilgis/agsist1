# PATCH INSTRUCTIONS
# Apply these exact changes to fix spray.html and urea.html

# ════════════════════════════════════════════════════════════════
# SPRAY.HTML — 3 changes
# ════════════════════════════════════════════════════════════════

## CHANGE 1: Add page CSS link in <head>
# Find this line in spray.html:
  <link rel="stylesheet" href="/components/styles.css">
# Replace with:
  <link rel="stylesheet" href="/components/styles.css">
  <link rel="stylesheet" href="/css/spray.css">

## CHANGE 2: Remove redundant font import
# Delete this entire line:
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono...rel="stylesheet">
# (styles.css already @imports these fonts)

## CHANGE 3: Delete inline theme script block
# Find and DELETE this entire block from the page <script>:
  // ── Theme ──────────────────────────────────────────────────────────
  function getTheme(){try{return localStorage.getItem('agsist-theme')||'dark'}catch(e){return'dark'}}
  function setTheme(t){document.documentElement.setAttribute('data-theme',t);try{localStorage.setItem('agsist-theme',t)}catch(e){}document.getElementById('theme-icon').textContent=t==='light'?'☀️':'🌙';}
  setTheme(getTheme());
  var _tb=document.getElementById('theme-btn');if(_tb)_tb.addEventListener('click',function(){setTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark');});
# Reason: loader.js → initNav() handles theme toggle. These elements (#theme-btn, #theme-icon)
# don't exist in DOM when this script runs (they're inside header.html, not yet injected).


# ════════════════════════════════════════════════════════════════
# UREA.HTML — 3 changes (identical pattern)
# ════════════════════════════════════════════════════════════════

## CHANGE 1: Add page CSS link in <head>
# Find this line in urea.html:
  <link rel="stylesheet" href="/components/styles.css">
# Replace with:
  <link rel="stylesheet" href="/components/styles.css">
  <link rel="stylesheet" href="/css/urea.css">

## CHANGE 2: Remove redundant font import
# Delete the font <link> tag (same as spray.html)

## CHANGE 3: Delete inline theme script block (same as spray.html)


# ════════════════════════════════════════════════════════════════
# STYLES.CSS — 1 change: add CSS variables to :root
# ════════════════════════════════════════════════════════════════
# Find :root { in styles.css and add these 5 lines inside it:
  --risk-low:     var(--green);
  --risk-mod:     var(--gold);
  --risk-high:    #f0913a;
  --risk-extreme: var(--red);
  --orange:       #f0913a;

# AND add to bottom of styles.css: (copy from styles-additions.css)
# The .signup--compact block


# ════════════════════════════════════════════════════════════════
# INDEX.HTML — 1 change: progressive signup
# ════════════════════════════════════════════════════════════════
# 1. Add id="signup-section" to the <div class="signup"> wrapper in index.html
# 2. Add id="email-form" to the email <form> element
# 3. Add id="sms-form" to the sms <form> element
# 4. Add id="email-success" to the email success div
# 5. Add id="sms-success" to the sms success div
# 6. Replace existing signup show/hide JS with contents of signup-progressive.js
