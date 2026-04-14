// AGSIST Component Loader — injects header (+ drawer), footer, analytics; initialises nav after inject
(function () {
  'use strict';

  // Apply saved theme immediately (before paint)
  try {
    var t = localStorage.getItem('agsist-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}

  var BASE = (function () {
    var m = document.querySelector('meta[name="agsist-base"]');
    return m ? m.getAttribute('content').replace(/\/$/, '') : '';
  })();

  function loadComponent(id, path, onDone) {
    var el = document.getElementById(id);
    if (!el) { if (onDone) onDone(); return; }
    fetch(BASE + path, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        // Insert ALL child nodes — header.html has <nav> + <div.drawer> + <div.draw-ov> as siblings.
        // replaceWith(firstElementChild) only injected <nav>, dropping drawer + overlay.
        var frag = document.createDocumentFragment();
        while (tmp.firstChild) frag.appendChild(tmp.firstChild);
        el.replaceWith(frag);
        if (onDone) onDone();
      })
      .catch(function () { if (onDone) onDone(); });
  }

  // Inject GA4 analytics unless the page already has gtag loaded inline
  function injectAnalytics() {
    if (typeof window.gtag === 'function') return;
    fetch(BASE + '/components/analytics.html', { cache: 'no-cache' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        tmp.querySelectorAll('script').forEach(function (oldScript) {
          var s = document.createElement('script');
          if (oldScript.src) { s.src = oldScript.src; s.async = true; }
          else { s.textContent = oldScript.textContent; }
          document.head.appendChild(s);
        });
      })
      .catch(function () {});
  }

  function initNav() {

    // ── Theme toggle ─────────────────────────────────────────────
    function applyTheme(th) {
      document.documentElement.setAttribute('data-theme', th);
      try { localStorage.setItem('agsist-theme', th); } catch (e) {}
      var icon = th === 'light' ? '☀️' : '🌙';
      var lbl  = th === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
      ['theme-btn', 'theme-btn-d'].forEach(function (id) {
        var btn = document.getElementById(id);
        if (btn) btn.setAttribute('aria-label', lbl);
      });
      ['theme-icon', 'theme-icon-d'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.textContent = icon;
      });
    }
    applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');

    ['theme-btn', 'theme-btn-d'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', function () {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      });
    });

    // ── Dropdowns — with aria-haspopup + aria-expanded ───────────
    // FIX P10: screen readers now know these buttons control popup menus
    document.querySelectorAll('.nav-dd').forEach(function (dd) {
      var trigger = dd.querySelector('.nav-btn');
      if (!trigger) return;

      // Set ARIA attributes on first load
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var wasOpen = dd.classList.contains('open');
        // Close all dropdowns and reset their aria-expanded
        document.querySelectorAll('.nav-dd').forEach(function (d) {
          d.classList.remove('open');
          var t = d.querySelector('.nav-btn');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
        if (!wasOpen) {
          dd.classList.add('open');
          trigger.setAttribute('aria-expanded', 'true');
        }
      });
    });

    document.addEventListener('click', function () {
      document.querySelectorAll('.nav-dd').forEach(function (d) {
        d.classList.remove('open');
        var t = d.querySelector('.nav-btn');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    });

    // ── Mobile drawer — with inert + aria-hidden focus trap fix ──
    // FIX P10: inert attribute prevents keyboard focus reaching hidden drawer elements
    // FIX P08: hamburger gets min-height:44px for touch target compliance
    var ham = document.getElementById('hamburger');
    var dr  = document.getElementById('drawer');
    var ov  = document.getElementById('draw-ov');
    var dc  = document.getElementById('draw-close');

    // Apply 44px min-height to hamburger after injection (P08 fix)
    if (ham) {
      ham.style.minHeight = '44px';
      ham.style.minWidth  = '44px';
      // Initial ARIA state
      ham.setAttribute('aria-expanded', 'false');
      ham.setAttribute('aria-controls', 'drawer');
      if (!ham.getAttribute('aria-label')) ham.setAttribute('aria-label', 'Open navigation menu');
    }

    // Set initial inert state on drawer (closed at load)
    if (dr) {
      dr.setAttribute('aria-hidden', 'true');
      dr.setAttribute('inert', '');
    }

    function openDr() {
      if (dr) {
        dr.classList.add('open');
        dr.setAttribute('aria-hidden', 'false');
        dr.removeAttribute('inert');
        // Move focus into drawer for keyboard users
        var firstLink = dr.querySelector('a, button, [tabindex="0"]');
        if (firstLink) { setTimeout(function(){ firstLink.focus(); }, 50); }
      }
      if (ov)  ov.classList.add('vis');
      if (ham) {
        ham.classList.add('open');
        ham.setAttribute('aria-expanded', 'true');
        ham.setAttribute('aria-label', 'Close navigation menu');
      }
      document.body.style.overflow = 'hidden';
    }

    function closeDr() {
      if (dr) {
        dr.classList.remove('open');
        dr.setAttribute('aria-hidden', 'true');
        dr.setAttribute('inert', '');
      }
      if (ov)  ov.classList.remove('vis');
      if (ham) {
        ham.classList.remove('open');
        ham.setAttribute('aria-expanded', 'false');
        ham.setAttribute('aria-label', 'Open navigation menu');
      }
      document.body.style.overflow = '';
    }

    window.closeDr = closeDr;

    if (ham) ham.addEventListener('click', openDr);
    if (dc)  dc.addEventListener('click', closeDr);
    if (ov)  ov.addEventListener('click', closeDr);

    // ── Active nav link highlight ─────────────────────────────────
    var path = window.location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('[data-nav-link], .nav-panel a, .drawer-link, .draw-item').forEach(function (a) {
      var href = (a.getAttribute('href') || '').replace(/\/$/, '') || '/';
      var active = (href === path) || (href !== '/' && path.startsWith(href));
      if (active) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
    });

    // ── Keyboard: Escape closes drawer/dropdowns ──────────────────
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.nav-dd').forEach(function (d) {
          d.classList.remove('open');
          var t = d.querySelector('.nav-btn');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
        closeDr();
      }
    });

    // ── Sticky nav scroll class ───────────────────────────────────
    window.addEventListener('scroll', function () {
      var nav = document.getElementById('topnav');
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 10);
    }, { passive: true });

    // ── Call any page-level post-nav hook ─────────────────────────
    if (typeof window.onNavReady === 'function') window.onNavReady();
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectAnalytics();
    loadComponent('site-header', '/components/header.html', initNav);
    loadComponent('site-footer', '/components/footer.html', null);
  });
})();
