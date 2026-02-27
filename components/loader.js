// AGSIST Component Loader — injects header, footer, analytics into every page
(function () {
  'use strict';

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

  function highlightNav() {
    var path = window.location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('[data-nav-link]').forEach(function (a) {
      var href = (a.getAttribute('href') || '').replace(/\/$/, '') || '/';
      var active = (href === path) || (href !== '/' && path.startsWith(href));
      if (active) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadComponent('site-header', '/components/header.html', function () {
      highlightNav();
      var btn = document.getElementById('theme-toggle');
      if (btn) btn.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('agsist-theme', next); } catch (e) {}
      });
    });
    loadComponent('site-footer', '/components/footer.html', null);
  });
})();
