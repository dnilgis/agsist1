/**
 * AGSIST Progressive Signup Disclosure
 * ─────────────────────────────────────
 * Drop this block into index.html's page <script> section.
 * Replace the existing signup show/hide logic.
 *
 * Behavior:
 *   Visits 1–3  → Full signup card (current design, high visibility)
 *   Visits 4–6  → Compact inline bar (email + submit, no headline/image)
 *   Visits 7+   → Hidden entirely
 *   Subscribed  → Always hidden (cookie agsist_subscribed=1)
 *
 * Session tracking:
 *   localStorage 'agsist-vc'  = total visit count
 *   sessionStorage 'agsist-vs' = has this session been counted?
 *   (prevents double-counting on single-page refreshes within same session)
 */
(function initSignup() {
  var SIGNUP_EL = document.getElementById('signup-section');
  if (!SIGNUP_EL) return;

  // Check subscribed cookie
  function getCookie(name) {
    var m = document.cookie.match('(?:^|;)\\s*' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : null;
  }
  if (getCookie('agsist_subscribed') === '1') {
    SIGNUP_EL.classList.add('signup--hidden');
    return;
  }

  // Count visits (once per browser session)
  var visited = false;
  try { visited = !!sessionStorage.getItem('agsist-vs'); } catch(e) {}
  var count = 0;
  try { count = parseInt(localStorage.getItem('agsist-vc') || '0', 10) || 0; } catch(e) {}

  if (!visited) {
    count++;
    try { localStorage.setItem('agsist-vc', count); } catch(e) {}
    try { sessionStorage.setItem('agsist-vs', '1'); } catch(e) {}
  }

  // Apply display logic
  if (count >= 7) {
    // 7+ visits: hide entirely
    SIGNUP_EL.classList.add('signup--hidden');
  } else if (count >= 4) {
    // 4–6 visits: compact bar
    SIGNUP_EL.classList.add('signup--compact');
    // Inject compact label if not present
    var form = SIGNUP_EL.querySelector('.signup-form');
    if (form && !SIGNUP_EL.querySelector('.signup--compact-label')) {
      var lbl = document.createElement('span');
      lbl.className = 'signup--compact-label';
      lbl.textContent = '📬 Free Daily';
      form.parentNode.insertBefore(lbl, form);
    }
  }
  // Visits 1–3: full card, nothing to do

  // Signup form submission — sets subscribed cookie on success
  var emailForm = document.getElementById('email-form');
  var smsForm   = document.getElementById('sms-form');
  var emailSucc = document.getElementById('email-success');
  var smsSucc   = document.getElementById('sms-success');

  function markSubscribed() {
    // Cookie: 1 year
    var exp = new Date(Date.now() + 365*24*60*60*1000).toUTCString();
    document.cookie = 'agsist_subscribed=1;expires=' + exp + ';path=/;SameSite=Lax';
    try { localStorage.setItem('agsist-vc', '99'); } catch(e) {}
    // Animate out after short delay
    setTimeout(function() {
      SIGNUP_EL.style.transition = 'max-height .5s, opacity .5s, padding .5s, margin .5s';
      SIGNUP_EL.style.maxHeight  = SIGNUP_EL.offsetHeight + 'px';
      SIGNUP_EL.offsetHeight; // force reflow
      SIGNUP_EL.style.maxHeight  = '0';
      SIGNUP_EL.style.opacity    = '0';
      SIGNUP_EL.style.padding    = '0';
      SIGNUP_EL.style.marginBottom = '0';
      setTimeout(function() { SIGNUP_EL.classList.add('signup--hidden'); }, 520);
    }, 2200);
  }

  if (emailForm) {
    emailForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var email = (emailForm.querySelector('input[type="email"]') || {}).value;
      if (!email) return;
      var btn = emailForm.querySelector('.signup-submit');
      if (btn) btn.textContent = 'Subscribing…';
      fetch('https://formspree.io/f/xnjbwepn', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, _subject: 'AGSIST Daily Email Signup' })
      }).then(function(r) {
        if (emailSucc) { emailSucc.style.display = 'block'; emailForm.style.display = 'none'; }
        markSubscribed();
      }).catch(function() {
        if (btn) btn.textContent = 'Try Again';
      });
    });
  }

  if (smsForm) {
    smsForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var phone = (smsForm.querySelector('input[type="tel"]') || {}).value;
      if (!phone) return;
      var btn = smsForm.querySelector('.signup-submit');
      if (btn) btn.textContent = 'Subscribing…';
      fetch('https://formspree.io/f/xnjbwepn', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone, _subject: 'AGSIST Daily SMS Signup' })
      }).then(function(r) {
        if (smsSucc) { smsSucc.style.display = 'block'; smsForm.style.display = 'none'; }
        markSubscribed();
      }).catch(function() {
        if (btn) btn.textContent = 'Try Again';
      });
    });
  }
})();
