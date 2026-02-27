/**
 * AGSIST Component Loader v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Injects shared header, footer, and analytics into every page.
 * Works on static hosting (GitHub Pages) — no server required.
 *
 * USAGE — add to every page's <body>:
 *   <div id="site-header"></div>
 *   ... page content ...
 *   <div id="site-footer"></div>
 *   <script src="/components/loader.js"></script>
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
        // Replace the placeholder div with injected HTML
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        el.replaceWith(tmp.firstElementChild || tmp);
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

  // ── Theme toggle binding (called after header injects) ───────────────────
  function bindThemeToggle() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur  = document.documentElement.getAttribute('data-theme') || 'dark';
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('agsist-theme', next); } catch (e) {}
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    loadComponent('site-header', '/components/header.html', function () {
      highlightNav();
      bindThemeToggle();
    });
    loadComponent('site-footer', '/components/footer.html', null);
    loadAnalytics();
  });

})();
