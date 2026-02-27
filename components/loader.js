// AGSIST Component Loader — injects header, footer; initialises nav after inject
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
        el.replaceWith(tmp.firstElementChild || tmp);
        if (onDone) onDone();
      })
      .catch(function () { if (onDone) onDone(); });
  }

  function initNav() {
    // ── Theme toggle ────────────────────────────────────────────
    function applyTheme(th) {
      document.documentElement.setAttribute('data-theme', th);
      try { localStorage.setItem('agsist-theme', th); } catch (e) {}
      var lbl = th === 'light' ? '☀️' : '🌙';
      ['theme-btn', 'theme-btn-d', 'theme-icon', 'theme-icon-d'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
          if (el.tagName === 'BUTTON') el.setAttribute('aria-label', lbl);
          else el.textContent = lbl;
        }
      });
    }
    // Sync icon to current theme
    applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');

    ['theme-btn', 'theme-btn-d'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', function () {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      });
    });

    // ── Dropdowns ────────────────────────────────────────────────
    document.querySelectorAll('.nav-dd').forEach(function (dd) {
      var trigger = dd.querySelector('.nav-btn');
      if (!trigger) return;
      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var wasOpen = dd.classList.contains('open');
        document.querySelectorAll('.nav-dd').forEach(function (d) { d.classList.remove('open'); });
        if (!wasOpen) dd.classList.add('open');
      });
    });
    document.addEventListener('click', function () {
      document.querySelectorAll('.nav-dd').forEach(function (d) { d.classList.remove('open'); });
    });

    // ── Mobile drawer ────────────────────────────────────────────
    var ham = document.getElementById('hamburger');
    var dr  = document.getElementById('drawer');
    var ov  = document.getElementById('draw-ov');
    var dc  = document.getElementById('draw-close');

    function openDr() {
      if (dr)  dr.classList.add('open');
      if (ov)  ov.classList.add('vis');
      if (ham) { ham.classList.add('open'); ham.setAttribute('aria-expanded', 'true'); }
      document.body.style.overflow = 'hidden';
    }
    function closeDr() {
      if (dr)  dr.classList.remove('open');
      if (ov)  ov.classList.remove('vis');
      if (ham) { ham.classList.remove('open'); ham.setAttribute('aria-expanded', 'false'); }
      document.body.style.overflow = '';
    }

    // Expose closeDr globally so ESC key handler in page scripts can call it
    window.closeDr = closeDr;

    if (ham) ham.addEventListener('click', openDr);
    if (dc)  dc.addEventListener('click', closeDr);
    if (ov)  ov.addEventListener('click', closeDr);

    // ── Active nav link highlight ─────────────────────────────────
    var path = window.location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('[data-nav-link], .nav-panel a, .drawer-link').forEach(function (a) {
      var href = (a.getAttribute('href') || '').replace(/\/$/, '') || '/';
      var active = (href === path) || (href !== '/' && path.startsWith(href));
      if (active) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
    });

    // ── Keyboard: Escape closes drawer/dropdowns ─────────────────
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.nav-dd').forEach(function (d) { d.classList.remove('open'); });
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
    loadComponent('site-header', '/components/header.html', initNav);
    loadComponent('site-footer', '/components/footer.html', null);
  });
})();
