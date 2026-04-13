/**
 * AGSIST Sparklines — Price Card Mini Charts
 * ─────────────────────────────────────────────────────────────────
 * DEPLOY: /components/sparklines.js
 *
 * Wires to every .pc-spark[data-spark="KEY"] div in the page.
 * Reads from window.AGSIST_PRICE_DATA (set by geo.js after prices.json
 * loads) and draws a canvas mini-chart showing today's price position
 * within the 52-week range.
 *
 * Data used (all present in prices.json):
 *   q.wk52_lo   — 52-week low
 *   q.wk52_hi   — 52-week high
 *   q.open      — today's open
 *   q.close     — current/last price
 *   q.netChange — day's net change direction
 *   q.grain     — true = divide by 100 (stored in cents)
 *
 * Chart type: 3-point intraday trend (lo → open → close) normalised
 * against the 52-week range, with a gradient fill. Gives immediate
 * visual direction (up/down) and range context without needing
 * historical arrays.
 *
 * v1 — 2026-04-13
 */

(function () {
  'use strict';

  // Colour constants matching AGSIST design system
  var CLR_UP   = 'rgba(58,139,60,';    // var(--green)
  var CLR_DN   = 'rgba(184,76,42,';    // var(--red)
  var CLR_FLAT = 'rgba(218,165,32,';   // var(--gold)

  // Which data-spark keys are grain (stored in cents → divide by 100)
  var GRAIN_KEYS = {
    'corn':1,'corn-dec':1,'beans':1,'beans-nov':1,
    'wheat':1,'oats':1,'corn-may':1,'beans-jul':1
  };

  // ── Draw one sparkline canvas ─────────────────────────────────────
  function drawSparkline(canvas, lo52, hi52, open, close, isUp) {
    var W = canvas.width  || canvas.offsetWidth  || 120;
    var H = canvas.height || canvas.offsetHeight ||  36;
    canvas.width  = W;
    canvas.height = H;

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    var range = hi52 - lo52;
    if (!range || range <= 0) return;

    // Build 3 normalised Y points: 52-wk-lo baseline, open, close
    // We map lo52→H (bottom) and hi52→0 (top)
    function yOf(val) {
      var clamped = Math.max(lo52, Math.min(hi52, val));
      return H - ((clamped - lo52) / range) * (H * 0.82) - H * 0.09;
    }

    var clr = isUp ? CLR_UP : (close < open ? CLR_DN : CLR_FLAT);

    // Points: x spread across full width
    var pts = [
      { x: 0,       y: yOf(lo52 + range * 0.5) },  // midpoint anchor (left edge)
      { x: W * 0.4, y: yOf(open)  },
      { x: W,       y: yOf(close) }
    ];

    // Smooth line via quadratic bezier
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) {
      var prev = pts[i - 1];
      var curr = pts[i];
      var cpX  = (prev.x + curr.x) / 2;
      ctx.quadraticCurveTo(cpX, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
    }
    ctx.quadraticCurveTo(pts[pts.length - 2].x + (W - pts[pts.length - 2].x) / 2,
                         pts[pts.length - 1].y,
                         pts[pts.length - 1].x, pts[pts.length - 1].y);

    ctx.strokeStyle = clr + '0.9)';
    ctx.lineWidth   = 1.8;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.stroke();

    // Gradient fill below line
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0,   clr + '0.18)');
    grad.addColorStop(0.7, clr + '0.04)');
    grad.addColorStop(1,   clr + '0.00)');

    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Current-price dot at right edge
    var dotY = yOf(close);
    ctx.beginPath();
    ctx.arc(W - 2, dotY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = clr + '0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(14,14,12,0.7)';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  // ── Wire one .pc-spark element ────────────────────────────────────
  function wireElement(el, quotes) {
    var sym = el.getAttribute('data-spark');
    if (!sym) return;

    var q = quotes[sym];
    if (!q) return;

    var isGrain = !!GRAIN_KEYS[sym];
    var divisor = isGrain ? 100 : 1;

    var close = q.close != null ? q.close / divisor : null;
    var open  = q.open  != null ? q.open  / divisor : close;
    var lo52  = q.wk52_lo != null ? q.wk52_lo / divisor : null;
    var hi52  = q.wk52_hi != null ? q.wk52_hi / divisor : null;

    // Need at least close and 52-wk range to draw anything useful
    if (close == null || lo52 == null || hi52 == null) return;
    if (hi52 <= lo52) return;

    // Compute canvas size from CSS (parent width, fixed height)
    var parentW = el.parentElement ? el.parentElement.offsetWidth : 0;
    var W = Math.max(parentW > 10 ? parentW : 0, 80);
    var H = 36;

    var canvas = el.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width  = W || 120;
      canvas.height = H;
      canvas.style.cssText = 'display:block;width:100%;height:' + H + 'px;border-radius:2px';
      canvas.setAttribute('aria-hidden', 'true');
      el.appendChild(canvas);
    }

    var isUp = (q.netChange != null) ? q.netChange >= 0 : (close >= open);

    try {
      drawSparkline(canvas, lo52, hi52, open, close, isUp);
      el.classList.add('loaded');
    } catch (e) {
      // Canvas draw failed silently — don't show empty div
    }
  }

  // ── Main wiring function — exported for index.html inline call ───
  function wireAll(quotes) {
    if (!quotes || typeof quotes !== 'object') return;
    document.querySelectorAll('.pc-spark[data-spark]').forEach(function (el) {
      wireElement(el, quotes);
    });
  }

  // ── Listen for geo.js price data ─────────────────────────────────
  // geo.js stores loaded quotes in window.AGSIST_PRICE_DATA (set below),
  // or fires 'agsist-prices-loaded' custom event.
  function tryFromGlobal() {
    var q = window.AGSIST_PRICE_DATA;
    if (q && typeof q === 'object' && Object.keys(q).length > 3) {
      wireAll(q);
      return true;
    }
    return false;
  }

  window.addEventListener('agsist-prices-loaded', function (e) {
    if (e.detail && e.detail.quotes) {
      wireAll(e.detail.quotes);
    }
  });

  // Patch geo.js fetchAllPrices to expose data and fire event
  // We do this BEFORE geo.js runs (sparklines.js is loaded first via <script src> in <head>)
  // geo.js calls applyPriceResult() per quote — we intercept the final store.
  var _origApply = window.applyPriceResult;

  // Alternative: Poll for data after a short delay
  var _attempts = 0;
  function pollForData() {
    if (tryFromGlobal()) return;
    _attempts++;
    if (_attempts < 20) setTimeout(pollForData, 300);
  }

  // ── Expose AGSIST_WIRE_SPARKS for manual calls from index.html ───
  window.AGSIST_WIRE_SPARKS = wireAll;

  // ── Also expose drawSparkline for custom use ─────────────────────
  window.AGSIST_SPARKLINE = drawSparkline;

  // ── Boot: run after DOM ready ─────────────────────────────────────
  function boot() {
    // Try immediately if data is already loaded (set by index.html or geo.js)
    if (!tryFromGlobal()) {
      // Primary fallback: fetch prices.json directly
      fetch('/data/prices.json', { cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data) return;
          var q = data.quotes || {};
          window.AGSIST_PRICE_DATA = q;
          wireAll(q);
        })
        .catch(function() {
          // Last resort: poll for data set by geo.js
          setTimeout(pollForData, 600);
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
