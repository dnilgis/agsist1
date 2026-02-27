/**
 * AGSIST Component Loader v1.1
 * ─────────────────────────────────────────────────────────────────────────────
 * Injects shared header, footer, and analytics into every page.
 * Works on static hosting (GitHub Pages) — no server required.
 *
 * USAGE — add to every page's <body>:
 *   <div id="site-header"></div>
 *   ... page content ...
 *   <div id="site-footer"></div>
 *   <script src="/components/loader.js"></script>
 *
 * v1.1 fixes:
 *   - Theme toggle now correctly targets id="theme-btn" (was "theme-toggle")
 *   - Drawer wired here so it works on every page, not just index
 *   - theme-btn-d (drawer theme toggle) also wired
 */

(function () {
  'use strict';

  // ── Theme: apply before first paint to prevent flash ───────────────────────
  (function () {
    try {
      var t = localStorage.getItem('agsist-theme') || 'dark';
      document.documentElement.setAttribute('data-theme', t);
    } catch (e) {}
  })();

  // ── Base path: supports root and subdirectory deploys ──────────────────────
  var BASE = (function () {
    var meta = document.querySelector('meta[name="agsist-base"]');
    return meta ? meta.getAttribute('content').replace(/\/$/, '') : '';
  })();

  // ── Core: fetch component HTML and replace placeholder div ────────────────
  function loadComponent(id, path, onDone) {
    var el = document.getElementById(id);
    if (!el) { onDone && onDone(); return; }

    fetch(BASE + path, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error(path + ' returned ' + r.status);
        return r.text();
      })
      .then(function (html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        // Replace placeholder with all injected children (skip nav + nav + drawer + overlay)
        var frag = document.createDocumentFragment();
        while (tmp.firstChild) frag.appendChild(tmp.firstChild);
        el.replaceWith(frag);
        onDone && onDone();
      })
      .catch(function (e) {
        console.warn('[loader]', e.message);
        onDone && onDone();
      });
  }

  // ── Analytics: append GA4 scripts to <head> once ──────────────────────────
  function loadAnalytics() {
    if (window.__agsistGA) return;
    window.__agsistGA = true;
    fetch(BASE + '/components/analytics.html', { cache: 'no-cache' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        tmp.querySelectorAll('script').forEach(function (s) {
          var ns = document.createElement('script');
          if (s.src)   { ns.src = s.src; ns.async = true; }
          else         { ns.textContent = s.textContent; }
          document.head.appendChild(ns);
        });
      })
      .catch(function () {});
  }

  // ── Active nav link highlight ─────────────────────────────────────────────
  function highlightNav() {
    var path = window.location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('[data-nav-link]').forEach(function (a) {
      var href = (a.getAttribute('href') || '').replace(/\/$/, '') || '/';
      var active = (href === path) || (href !== '/' && path.startsWith(href));
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
    });
  }

  // ── Theme helpers ─────────────────────────────────────────────────────────
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('agsist-theme', t); } catch (e) {}
    // Sync moon/sun icons in both nav and drawer buttons
    ['theme-icon', 'theme-icon-d'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = t === 'dark' ? '🌙' : '☀️';
    });
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  // ── Theme toggle binding ──────────────────────────────────────────────────
  function bindThemeToggle() {
    // Main nav button (id="theme-btn")
    var btn = document.getElementById('theme-btn');
    if (btn) btn.addEventListener('click', toggleTheme);

    // Drawer theme button (id="theme-btn-d")
    var btnD = document.getElementById('theme-btn-d');
    if (btnD) btnD.addEventListener('click', toggleTheme);

    // Sync initial icon state after inject
    var cur = document.documentElement.getAttribute('data-theme') || 'dark';
    ['theme-icon', 'theme-icon-d'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = cur === 'dark' ? '🌙' : '☀️';
    });
  }

  // ── Dropdown menus ────────────────────────────────────────────────────────
  function bindDropdowns() {
    document.querySelectorAll('.nav-dd').forEach(function (dd) {
      var btn = dd.querySelector('.nav-btn');
      if (!btn) return;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = dd.classList.contains('open');
        // Close all others
        document.querySelectorAll('.nav-dd.open').forEach(function (o) { o.classList.remove('open'); });
        if (!isOpen) dd.classList.add('open');
      });
    });
    document.addEventListener('click', function () {
      document.querySelectorAll('.nav-dd.open').forEach(function (dd) { dd.classList.remove('open'); });
    });
  }

  // ── Mobile drawer ─────────────────────────────────────────────────────────
  function bindDrawer() {
    var ham = document.getElementById('hamburger');
    var dr  = document.getElementById('drawer');
    var ov  = document.getElementById('draw-ov');
    var dc  = document.getElementById('draw-close');

    if (!ham || !dr || !ov) return; // not present on this page

    function openDr()  {
      dr.classList.add('open');
      ov.classList.add('vis');
      ham.classList.add('open');
      ham.setAttribute('aria-expanded', 'true');
      dr.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
    function closeDr() {
      dr.classList.remove('open');
      ov.classList.remove('vis');
      ham.classList.remove('open');
      ham.setAttribute('aria-expanded', 'false');
      dr.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    ham.addEventListener('click', openDr);
    if (dc) dc.addEventListener('click', closeDr);
    ov.addEventListener('click', closeDr);

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dr.classList.contains('open')) closeDr();
    });
  }

  // ── Scroll: add shadow to nav ─────────────────────────────────────────────
  function bindScroll() {
    var nav = document.getElementById('topnav');
    if (!nav) return;
    window.addEventListener('scroll', function () {
      nav.classList.toggle('scrolled', window.scrollY > 10);
    }, { passive: true });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    loadComponent('site-header', '/components/header.html', function () {
      highlightNav();
      bindThemeToggle();
      bindDropdowns();
      bindDrawer();
      bindScroll();
    });
    loadComponent('site-footer', '/components/footer.html', null);
    loadAnalytics();
  });

})();
