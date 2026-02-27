/**
 * AGSIST geo.js — Shared JS: weather, prices, ticker, geo, forecast
 * ─────────────────────────────────────────────────────────────────
 * Loaded on every page that needs live data. index.html script block
 * handles only page-specific UI (theme, nav, drawer, signup).
 *
 * Provides globally:
 *   fetchWeather(lat, lon, label)  — weather + spray + urea + forecast
 *   requestGeo()                   — triggers browser geolocation
 *   showZipEntry()                 — shows manual ZIP fallback
 *   loadWeatherZip()               — geocodes ZIP → fetchWeather
 *   loadCashBids(zip)              — populates #bids-list-area
 *   lookupBids()                   — reads #bids-zip and calls loadCashBids
 *   rebuildTickerLoop()            — clones ticker for seamless scroll
 */

var WX_CODES = {
  0:'Clear Sky',1:'Mainly Clear',2:'Partly Cloudy',3:'Overcast',
  45:'Foggy',48:'Icy Fog',51:'Light Drizzle',53:'Drizzle',55:'Heavy Drizzle',
  61:'Light Rain',63:'Rain',65:'Heavy Rain',71:'Light Snow',73:'Snow',
  75:'Heavy Snow',80:'Rain Showers',81:'Showers',82:'Heavy Showers',
  95:'Thunderstorm',96:'T-Storm w/Hail',99:'Severe T-Storm'
};
var WX_ICONS = {
  0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌧️',55:'🌧️',
  61:'🌦️',63:'🌧️',65:'⛈️',71:'🌨️',73:'❄️',75:'❄️',80:'🌦️',81:'🌧️',
  82:'⛈️',95:'⛈️',96:'⛈️',99:'⛈️'
};

function requestGeo() {
  if (!navigator.geolocation) { showZipEntry(); return; }
  var wl = document.getElementById('wx-loading');
  if (wl) wl.innerHTML = '<div style="font-size:1.5rem;margin-bottom:.5rem">📍</div>'
    + '<div style="font-size:.88rem;color:var(--text-dim)">Detecting location…</div>';
  navigator.geolocation.getCurrentPosition(
    function(pos) { fetchWeather(pos.coords.latitude, pos.coords.longitude, null); },
    function() { showZipEntry(); },
    { timeout: 8000 }
  );
}

function showZipEntry() {
  var wl = document.getElementById('wx-loading');
  var ze = document.getElementById('wx-zip-entry');
  if (wl) wl.style.display = 'none';
  if (ze) ze.style.display = 'block';
}

function loadWeatherZip() {
  var zip = (document.getElementById('wx-zip') || {}).value;
  if (!zip || zip.length !== 5 || isNaN(zip)) return;
  fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + zip + '&count=1&language=en&format=json&countryCode=US')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.results && d.results.length) {
        var r = d.results[0];
        fetchWeather(r.latitude, r.longitude, r.name + (r.admin1 ? ', ' + r.admin1.substring(0,2) : ''));
      }
    }).catch(function() {});
}

function degToCompass(d) {
  var dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(d / 22.5) % 16];
}

function calcUrea(tempF, humid, wind, popPct) {
  function uT(f){return f<40?5:f<50?15:f<60?30:f<70?50:f<80?72:f<90?88:98;}
  function uH(h){return h<30?25:h<50?45:h<70?75:h<85?60:35;}
  function uW(w){return w<2?15:w<5?35:w<10?60:w<15?78:90;}
  function uR(p){return p>=70?10:p>=50?25:p>=30?55:85;}
  var score = Math.round(uT(tempF)*0.35 + uH(humid)*0.25 + uW(wind)*0.20 + uR(popPct)*0.20);
  var level = score<30?'low':score<55?'moderate':score<75?'high':'extreme';
  return { score:score, level:level };
}

function fetchWeather(lat, lon, label) {
  // Persist location for return visits
  try { localStorage.setItem('agsist-wx-loc', JSON.stringify({lat:lat, lon:lon, label:label})); } catch(e) {}

  var wl = document.getElementById('wx-loading');
  var ze = document.getElementById('wx-zip-entry');
  var wd = document.getElementById('wx-data');
  if (wl) wl.style.display = 'none';
  if (ze) ze.style.display = 'none';
  if (wd) wd.style.display = 'block';

  var wxLoc = document.getElementById('wx-loc');
  if (wxLoc) wxLoc.textContent = '📍 ' + (label || 'Your Location');

  // Update Windy iframe
  var frame = document.getElementById('windy-frame');
  if (frame) {
    var la = lat.toFixed(4), lo = lon.toFixed(4);
    frame.src = 'https://embed.windy.com/embed.html?type=map&location=coordinates'
      + '&metricRain=in&metricTemp=%C2%B0F&metricWind=mph'
      + '&zoom=7&overlay=radar&product=radar&level=surface'
      + '&lat='+la+'&lon='+lo+'&detailLat='+la+'&detailLon='+lo
      + '&detail=false&pressure=false&menu=false&message=false&marker=false'
      + '&calendar=now&thunder=false';
  }

  // Greeting
  (function() {
    var h = new Date().getHours();
    var g = h<12?'Good Morning':h<17?'Good Afternoon':'Good Evening';
    var el = document.getElementById('site-greeting');
    if (el) el.textContent = g;
  })();

  var url = 'https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,dew_point_2m'
    + '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=1';

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var c = d.current;
      var code   = c.weather_code;
      var tempF  = Math.round(c.temperature_2m);
      var feelsF = Math.round(c.apparent_temperature);
      var wind   = Math.round(c.wind_speed_10m);
      var humid  = c.relative_humidity_2m;
      var precip = c.precipitation_probability;
      var dew    = Math.round(c.dew_point_2m);

      // Set values
      var el;
      el = document.getElementById('wx-temp');  if(el) el.textContent = tempF + '°F';
      el = document.getElementById('wx-icon');  if(el) el.textContent = WX_ICONS[code] || '🌡️';
      el = document.getElementById('wx-desc');  if(el) el.textContent = (WX_CODES[code]||'Current Conditions') + ' · Feels ' + feelsF + '°';
      el = document.getElementById('wx-wind');  if(el) el.textContent = degToCompass(c.wind_direction_10m) + ' ' + wind + ' mph';
      el = document.getElementById('wx-humid'); if(el) el.textContent = humid + '%';
      el = document.getElementById('wx-precip');if(el) el.textContent = precip + '%';
      el = document.getElementById('wx-dew');   if(el) el.textContent = dew + '°F';

      // Spray badge
      var spray = document.getElementById('wx-spray');
      if (spray) {
        if (wind > 15) {
          spray.className = 'spray-badge poor';
          spray.textContent = '🚫 Poor Spray Conditions — Wind too high (' + wind + ' mph)';
        } else if (wind > 10 || humid > 90 || humid < 40) {
          spray.className = 'spray-badge caution';
          spray.textContent = '⚠️ Marginal Spray Conditions — Monitor conditions';
        } else {
          spray.className = 'spray-badge good';
          spray.textContent = '✅ Good Spray Conditions';
        }
      }

      // Urea inline widget — FIX: use c.temperature_2m and c.precipitation_probability (not data.*)
      var ureaWrap = document.getElementById('wx-urea');
      if (ureaWrap) {
        var u = calcUrea(tempF, humid, wind, precip);
        var uPalette = {low:'62,207,110',moderate:'230,176,66',high:'240,145,58',extreme:'240,96,96'};
        var uLabels  = {low:'Low',moderate:'Moderate',high:'High',extreme:'Extreme'};
        var uColors  = {low:'var(--green)',moderate:'var(--gold)',high:'#f0913a',extreme:'var(--red)'};
        var sEl = document.getElementById('wx-urea-score');
        var bEl = document.getElementById('wx-urea-badge');
        if (sEl) { sEl.textContent = u.score; sEl.style.color = uColors[u.level]; }
        if (bEl) {
          bEl.textContent = uLabels[u.level];
          bEl.style.color = uColors[u.level];
          bEl.style.background = 'rgba('+uPalette[u.level]+',.12)';
          bEl.style.border = '1px solid rgba('+uPalette[u.level]+',.25)';
        }
        ureaWrap.style.display = 'block';
      }

      // Widget preview panels (spray + urea showcase widgets on homepage)
      updateWidgetPreviews(tempF, humid, wind, precip);

      // Reverse geocode → propagate ZIP to bids, update labels
      propagateLocation(lat, lon, label);
    })
    .catch(function() {
      if (wd) wd.style.display = 'none';
      var wl2 = document.getElementById('wx-loading');
      if (wl2) {
        wl2.innerHTML = '';
        var msg = document.createElement('div');
        msg.style.cssText = 'font-size:.88rem;color:var(--text-dim)';
        msg.textContent = 'Weather unavailable. ';
        var btn = document.createElement('button');
        btn.textContent = 'Try ZIP →';
        btn.setAttribute('style','background:none;border:none;color:var(--gold);cursor:pointer;font-size:.88rem;font-family:inherit');
        btn.onclick = showZipEntry;
        msg.appendChild(btn);
        wl2.appendChild(msg);
        wl2.style.display = 'block';
      }
    });

  // Also fetch 4-day forecast
  renderForecast(lat, lon);
}

function propagateLocation(lat, lon, label) {
  fetch('https://nominatim.openstreetmap.org/reverse?lat='+lat+'&lon='+lon+'&format=json')
    .then(function(r) { return r.json(); })
    .then(function(geo) {
      var city = geo.address.city || geo.address.town || geo.address.village || geo.address.county || '';
      var st   = geo.address.state_code || '';
      var zip  = geo.address.postcode || '';
      var name = city + (st ? ', '+st : '');

      var wxLoc = document.getElementById('wx-loc');
      if (wxLoc && name) wxLoc.textContent = '📍 ' + name;

      var radarLbl = document.getElementById('wx-loc-label');
      if (radarLbl && name) radarLbl.textContent = name;

      if (zip) {
        var bidsZip = document.getElementById('bids-zip');
        if (bidsZip && !bidsZip.value) bidsZip.value = zip;
        if (typeof loadCashBids === 'function') loadCashBids(zip);
      } else if (name) {
        var geoTxt = document.getElementById('bids-geo-txt');
        if (geoTxt) geoTxt.textContent = 'Near ' + name + ' — enter ZIP for live bids';
      }

      try {
        var saved = JSON.parse(localStorage.getItem('agsist-wx-loc') || '{}');
        if (name) saved.label = name;
        if (zip)  saved.zip   = zip;
        localStorage.setItem('agsist-wx-loc', JSON.stringify(saved));
      } catch(e) {}
    }).catch(function() {});
}

function updateWidgetPreviews(tempF, humid, wind, pop) {
  // Spray preview widget
  var sprayRating = (wind>15||tempF>90||tempF<40||humid<30) ? 'poor'
                  : (wind>10||humid<40||humid>90) ? 'marginal' : 'good';
  var sprayColors  = {good:'rgba(62,207,110,.08)',marginal:'rgba(230,176,66,.08)',poor:'rgba(240,96,96,.08)'};
  var sprayBorders = {good:'rgba(62,207,110,.2)',marginal:'rgba(230,176,66,.2)',poor:'rgba(240,96,96,.2)'};
  var sprayIcons   = {good:'✅',marginal:'⚠️',poor:'🚫'};
  var sprayLabels  = {good:'Good — Apply Now',marginal:'Use Caution',poor:'Do Not Spray'};
  var sprayEl = document.getElementById('wsp-spray-icon');
  var statusEl = document.getElementById('wsp-spray-status');
  var detailEl = document.getElementById('wsp-spray-detail');
  var wrapEl   = document.getElementById('wsp-spray');
  if (sprayEl) sprayEl.textContent = sprayIcons[sprayRating];
  if (statusEl) {
    statusEl.textContent = sprayLabels[sprayRating];
    statusEl.style.color = {good:'var(--green)',marginal:'var(--gold)',poor:'var(--red)'}[sprayRating];
  }
  if (detailEl) detailEl.textContent = 'Wind '+wind+' mph · '+tempF+'°F · Humidity '+humid+'%';
  if (wrapEl) {
    var inner = wrapEl.querySelector('div');
    if (inner) {
      inner.style.background = sprayColors[sprayRating];
      inner.style.borderColor = sprayBorders[sprayRating];
    }
  }

  // Urea preview widget
  var u = calcUrea(tempF, humid, wind, pop);
  var uPalette = {low:'62,207,110',moderate:'230,176,66',high:'240,145,58',extreme:'240,96,96'};
  var uLbls    = {low:'Low Risk',moderate:'Moderate Risk',high:'High Risk',extreme:'Extreme Risk'};
  var uRecs    = {low:'Favorable for application',moderate:'Consider NBPT stabilizer',high:'Use stabilizer or wait',extreme:'Do not apply without stabilizer'};
  var uColors  = {low:'var(--green)',moderate:'var(--gold)',high:'#f0913a',extreme:'var(--red)'};
  var uSc = document.getElementById('wsp-urea-score');
  var uBd = document.getElementById('wsp-urea-badge');
  var uRc = document.getElementById('wsp-urea-rec');
  if (uSc) { uSc.textContent = u.score; uSc.style.color = uColors[u.level]; }
  if (uBd) {
    uBd.textContent = uLbls[u.level];
    uBd.style.color = uColors[u.level];
    uBd.style.background = 'rgba('+uPalette[u.level]+',.12)';
    uBd.style.border = '1px solid rgba('+uPalette[u.level]+',.25)';
  }
  if (uRc) uRc.textContent = uRecs[u.level];
}

function renderForecast(lat, lon) {
  var url = 'https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&temperature_unit=fahrenheit&timezone=auto&forecast_days=4';
  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var days = d.daily;
      var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      var fc = document.getElementById('wx-forecast');
      var fcFull = document.getElementById('wx-forecast-full');
      var locLabel = document.getElementById('wx-loc-label');
      var wxLocEl = document.getElementById('wx-loc');
      if (locLabel && wxLocEl) locLabel.textContent = wxLocEl.textContent.replace('📍 ','');

      if (fc) {
        fc.innerHTML = '';
        for (var i = 1; i < 4; i++) {
          var day = new Date(days.time[i] + 'T12:00:00');
          var dname = i===1 ? 'Tomorrow' : dayNames[day.getDay()];
          var el = document.createElement('div');
          el.style.cssText = 'flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:.5rem .4rem;text-align:center';
          var pop = days.precipitation_probability_max[i];
          el.innerHTML = '<div style="font-size:.64rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted);margin-bottom:.2rem">'+dname+'</div>'
            + '<div style="font-size:1.3rem;line-height:1;margin-bottom:.2rem">'+(WX_ICONS[days.weather_code[i]]||'🌡️')+'</div>'
            + '<div style="font-size:.82rem;font-weight:700;color:var(--text)">'+Math.round(days.temperature_2m_max[i])+'°</div>'
            + '<div style="font-size:.74rem;color:var(--text-muted)">'+Math.round(days.temperature_2m_min[i])+'°</div>'
            + (pop>20?'<div style="font-size:.68rem;color:var(--blue);margin-top:.15rem">💧'+pop+'%</div>':'');
          fc.appendChild(el);
        }
      }

      if (fcFull) {
        fcFull.innerHTML = '';
        for (var j = 0; j < 4; j++) {
          var dj = new Date(days.time[j] + 'T12:00:00');
          var dnj = j===0 ? 'Today' : dayNames[dj.getDay()];
          var elj = document.createElement('div');
          elj.className = 'wx-day';
          var popj = days.precipitation_probability_max[j];
          elj.innerHTML = '<div class="wx-day-name">'+dnj+'</div>'
            + '<div class="wx-day-icon">'+(WX_ICONS[days.weather_code[j]]||'🌡️')+'</div>'
            + '<div class="wx-day-hi">'+Math.round(days.temperature_2m_max[j])+'°</div>'
            + '<div class="wx-day-lo">'+Math.round(days.temperature_2m_min[j])+'°</div>'
            + (popj>15?'<div class="wx-day-pop">💧'+popj+'%</div>':'');
          fcFull.appendChild(elj);
        }
      }
    }).catch(function() {});
}

function lookupBids() {
  var zip = (document.getElementById('bids-zip') || {}).value;
  if (!zip || zip.length !== 5 || isNaN(zip)) return;
  loadCashBids(zip);
}

function loadCashBids(zip) {
  var geoBar = document.getElementById('bids-geo-bar');
  var zipRow = document.getElementById('bids-zip-row');
  var listArea = document.getElementById('bids-list-area');
  if (geoBar) geoBar.style.display = 'none';
  if (zipRow) zipRow.style.display = 'none';
  var bz = document.getElementById('bids-zip');
  if (bz && !bz.value) bz.value = zip;

  if (!listArea) return;

  // Show loading state
  listArea.innerHTML = '<div class="bids-loading">'
    + '<div style="font-size:.75rem;color:var(--text-muted);text-align:center;padding:.75rem 0">'
    + '⏳ Loading bids near ZIP ' + zip + '…</div></div>';

  // Barchart grain bids endpoint via Cloudflare Worker
  var workerUrl = 'https://agsist-prices.workers.dev/api/grain-bids?zip=' + zip + '&commodityCode=corn,soybeans';
  fetch(workerUrl)
    .then(function(r) {
      if (!r.ok) throw new Error('worker ' + r.status);
      return r.json();
    })
    .then(function(data) {
      renderBids(data, zip, listArea);
    })
    .catch(function() {
      // Worker not yet deployed or outside market hours — show helpful placeholder
      listArea.innerHTML = renderBidsPlaceholder(zip);
    });
}

function renderBids(data, zip, container) {
  var bids = (data && data.results) ? data.results : [];
  if (!bids.length) {
    container.innerHTML = renderBidsPlaceholder(zip);
    return;
  }
  var html = '<div style="margin-bottom:.4rem;font-size:.68rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)">Live Bids · Near ' + zip + ' · <span style="color:var(--gold)">Barchart</span></div>';
  var shown = 0;
  bids.forEach(function(bid) {
    if (shown >= 4) return;
    var basis = bid.basisPrice ? (bid.basisPrice > 0 ? '+' : '') + bid.basisPrice + '¢' : '—';
    var dir   = bid.basisPrice > 0 ? 'up' : bid.basisPrice < 0 ? 'dn' : 'nc';
    var last  = shown === Math.min(bids.length, 4) - 1;
    html += '<div class="price-row"' + (last?' style="border-bottom:none;padding-bottom:0"':'') + '>'
      + '<div><div class="p-name"><span class="p-dot"></span>' + (bid.commodityDisplayName||'Commodity') + '</div>'
      + '<div class="p-contract">' + (bid.locationName||'Elevator') + ' · ' + (bid.distance ? Math.round(bid.distance) + ' mi' : '—') + '</div></div>'
      + '<div class="p-right"><span class="p-val">' + (bid.cashPrice ? bid.cashPrice.toFixed(2) : '--') + '</span>'
      + '<span class="p-chg ' + dir + '">Basis ' + basis + '</span></div></div>';
    shown++;
  });
  container.innerHTML = html;
}

function renderBidsPlaceholder(zip) {
  return '<div style="text-align:center;padding:1.25rem .5rem">'
    + '<div style="font-size:1.5rem;margin-bottom:.4rem">💵</div>'
    + '<div style="font-size:.88rem;font-weight:600;color:var(--text);margin-bottom:.25rem">Live bids coming soon</div>'
    + '<div style="font-size:.78rem;color:var(--text-muted);line-height:1.5">The Cloudflare Worker is being deployed.<br>Use <a href="/cash-bids" style="color:var(--gold)">Cash Bids →</a> for manual lookup near ' + zip + '.</div>'
    + '</div>';
}

var STOOQ_QUOTES = [
  {sym:'zc.f',      label:'Corn (front)',   priceEl:'pcp-corn-near', chgEl:'pcc-corn-near', dec:2, grain:true},
  {sym:'zcz26.cbt', label:"Corn Dec'26",    priceEl:'pcp-corn-dec',  chgEl:'pcc-corn-dec',  dec:2, grain:true},
  {sym:'zs.f',      label:'Beans (front)',  priceEl:'pcp-bean-near', chgEl:'pcc-bean-near', dec:2, grain:true},
  {sym:'zsx26.cbt', label:"Beans Nov'26",   priceEl:'pcp-bean-nov',  chgEl:'pcc-bean-nov',  dec:2, grain:true},
  {sym:'zw.f',      label:'Wheat (front)',  priceEl:null,            chgEl:null,            dec:2, grain:true},
  {sym:'le.f',      label:'Live Cattle',    priceEl:null,            chgEl:null,            dec:3, grain:false},
  {sym:'gf.f',      label:'Feeder Cattle',  priceEl:null,            chgEl:null,            dec:3, grain:false},
  {sym:'he.f',      label:'Lean Hogs',      priceEl:null,            chgEl:null,            dec:3, grain:false},
  {sym:'zm.f',      label:'Soy Meal',       priceEl:null,            chgEl:null,            dec:2, grain:false},
  {sym:'zl.f',      label:'Soy Oil',        priceEl:null,            chgEl:null,            dec:2, grain:false},
  {sym:'cl.f',      label:'Crude WTI',      priceEl:null,            chgEl:null,            dec:2, grain:false},
  {sym:'ng.f',      label:'Natural Gas',    priceEl:null,            chgEl:null,            dec:3, grain:false},
  {sym:'gc.f',      label:'Gold',           priceEl:'pc-gold',       chgEl:'pcc-gold',      dec:0, grain:false},
  {sym:'si.f',      label:'Silver',         priceEl:'pc-silver',     chgEl:'pcc-silver',    dec:2, grain:false},
  {sym:'dx.f',      label:'Dollar Index',   priceEl:null,            chgEl:null,            dec:2, grain:false},
  {sym:'%5etnx',    label:'10-Yr Treasury', priceEl:null,            chgEl:null,            dec:2, grain:false, suffix:'%'}
];

function fmtStooqPrice(val, dec, grain, suffix) {
  var p = parseFloat(val);
  if (isNaN(p)) return '--';
  if (grain) {
    var whole = Math.floor(p);
    var frac  = Math.round((p - whole) * 4) / 4;
    var fracs = {'0':'','0.25':'¼','0.50':'½','0.75':'¾'};
    var fracStr = fracs[frac.toFixed(2)];
    return whole + (fracStr !== undefined ? fracStr : frac.toFixed(2));
  }
  if (dec === 0) return p.toLocaleString('en-US', {maximumFractionDigits:0});
  return p.toFixed(dec) + (suffix||'');
}

function fmtStooqChg(close, open, grain) {
  var c = parseFloat(close), o = parseFloat(open);
  if (isNaN(c) || isNaN(o)) return {text:'--', cls:'nc'};
  var diff  = c - o;
  var pct   = o !== 0 ? (diff/o)*100 : 0;
  var dir   = diff > 0 ? 'up' : diff < 0 ? 'dn' : 'nc';
  var arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
  var abs   = Math.abs(diff);
  var txt;
  if (grain) {
    txt = arrow + ' ' + (abs*100).toFixed(1) + '¢ (' + (diff>0?'+':'') + pct.toFixed(2) + '%)';
  } else {
    txt = arrow + ' ' + abs.toFixed(abs<1?4:abs<10?3:2) + ' (' + (diff>0?'+':'') + pct.toFixed(2) + '%)';
  }
  return {text:txt, cls:dir};
}

function updatePriceEl(id, txt, cls) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = txt;
  if (cls) el.className = el.className.replace(/\b(up|dn|nc)\b/g,'').trim() + ' ' + cls;
}

function updateRangeBar(priceElId, price) {
  if (!priceElId) return;
  var priceEl = document.getElementById(priceElId);
  if (!priceEl) return;
  var card = priceEl.closest ? priceEl.closest('.pc') : null;
  if (!card) return;
  var fill   = card.querySelector('.pc-range-fill');
  var dot    = card.querySelector('.pc-range-dot');
  var labels = card.querySelectorAll('.pc-range-labels span');
  if (!fill || labels.length < 3) return;
  var lo = parseFloat(labels[0].textContent.replace(/,/g,''));
  var hi = parseFloat(labels[2].textContent.replace(/,/g,''));
  if (isNaN(lo) || isNaN(hi) || hi === lo) return;
  var pct = Math.min(100, Math.max(0, ((parseFloat(price)-lo)/(hi-lo))*100));
  fill.style.width = pct + '%';
  if (dot) dot.style.left = pct + '%';
}

function fetchStooqSym(q, cb) {
  var stooqUrl = 'https://stooq.com/q/l/?s=' + q.sym + '&f=sd2t2ohlcv&h&e=csv';
  var proxy1 = 'https://corsproxy.io/?' + encodeURIComponent(stooqUrl);
  var proxy2 = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(stooqUrl);
  function tryProxy(url, fallback) {
    fetch(url, {cache:'no-store'})
      .then(function(r) { return r.text(); })
      .then(function(csv) {
        var lines = csv.trim().split('\n');
        if (lines.length < 2) throw new Error('no data');
        var cols = lines[1].split(',');
        cb(null, {sym:q.sym, open:cols[3], close:cols[6], q:q});
      })
      .catch(function(e) {
        if (fallback) { tryProxy(fallback, null); } else { cb(e, null); }
      });
  }
  tryProxy(proxy1, proxy2);
}

var _stooqTotal = 0, _stooqOk = 0;
function updatePriceStatus() {
  var el = document.getElementById('price-data-status');
  if (!el) return;
  if (_stooqOk > 0) {
    el.textContent = '15-min delayed · Stooq';
    el.style.color = 'var(--text-muted)';
  } else if (_stooqTotal >= STOOQ_QUOTES.length) {
    el.textContent = '⚠ Price data unavailable — refresh to retry';
    el.style.color = 'var(--gold)';
  }
}

function applyStooqResult(data) {
  var q = data.q;
  var priceTxt = fmtStooqPrice(data.close, q.dec, q.grain, q.suffix);
  var chgObj   = fmtStooqChg(data.close, data.open, q.grain);
  if (q.priceEl) { updatePriceEl(q.priceEl, priceTxt); updateRangeBar(q.priceEl, data.close); }
  if (q.chgEl)   updatePriceEl(q.chgEl, chgObj.text, chgObj.cls);
  document.querySelectorAll('[data-sym]').forEach(function(el) {
    if (el.getAttribute('data-sym').toLowerCase() !== q.sym) return;
    var pe = el.querySelector('.t-price');
    var ce = el.querySelector('.t-chg');
    if (pe) pe.textContent = priceTxt;
    if (ce) { ce.textContent = chgObj.text; ce.className = 't-chg ' + chgObj.cls; }
  });
  rebuildTickerLoop();
}

function fetchAllStooq() {
  _stooqTotal = 0; _stooqOk = 0;
  STOOQ_QUOTES.forEach(function(q) {
    fetchStooqSym(q, function(err, data) {
      _stooqTotal++;
      if (!err) { _stooqOk++; applyStooqResult(data); }
      updatePriceStatus();
    });
  });
}

function fetchCryptoLive() {
  fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ripple,kaspa&vs_currencies=usd&include_24hr_change=true&precision=4')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var cmap = {
        bitcoin:{priceEl:'pc-btc',  chgEl:'pcc-btc', sym:'bitcoin', dec:0},
        ripple: {priceEl:'pc-xrp',  chgEl:'pcc-xrp', sym:'ripple',  dec:4},
        kaspa:  {priceEl:'pc-kas',  chgEl:'pcc-kas', sym:'kaspa',   dec:4}
      };
      Object.keys(cmap).forEach(function(id) {
        var info  = cmap[id];
        var price = d[id] && d[id].usd;
        var chgP  = d[id] && d[id].usd_24h_change;
        if (!price) return;
        var priceTxt = price < 1 ? price.toFixed(4) : price.toLocaleString('en-US',{maximumFractionDigits:2});
        updatePriceEl(info.priceEl, priceTxt);
        if (chgP !== undefined) {
          var cv = parseFloat(chgP);
          updatePriceEl(info.chgEl, (cv>0?'▲':'▼')+' '+Math.abs(cv).toFixed(2)+'%', cv>0?'up':'dn');
        }
        document.querySelectorAll('[data-sym="'+id+'"]').forEach(function(el) {
          var pe = el.querySelector('.t-price');
          var ce = el.querySelector('.t-chg');
          if (pe) pe.textContent = priceTxt;
          if (ce && chgP !== undefined) {
            var cv2 = parseFloat(chgP);
            ce.textContent = (cv2>0?'▲':'▼')+' '+Math.abs(cv2).toFixed(2)+'%';
            ce.className = 't-chg '+(cv2>0?'up':'dn');
          }
        });
      });
      rebuildTickerLoop();
    }).catch(function() {});
}

function fetchFFAILive() {
  fetch('https://farmers1st.com/api/v3/current.json')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var score = d.composite;
      var prev  = d.previous ? d.previous.composite : null;
      var diff  = prev !== null ? parseFloat((score - prev).toFixed(1)) : null;
      var dir   = diff && diff > 0 ? 'up' : 'dn';
      var sign  = diff && diff > 0 ? '▲' : '▼';
      document.querySelectorAll('.t-item').forEach(function(el) {
        var lbl = el.querySelector('.t-label');
        if (lbl && lbl.textContent === 'FFAI Index') {
          var pe = el.querySelector('.t-price');
          var ce = el.querySelector('.t-chg');
          if (pe) pe.textContent = score.toFixed(1);
          if (ce && diff) { ce.className='t-chg '+dir; ce.textContent=sign+' '+Math.abs(diff)+' pts'; }
        }
      });
    }).catch(function() {});
}

function rebuildTickerLoop() {
  var single = document.getElementById('ticker-items-single');
  var track  = document.getElementById('ticker-track');
  if (!single || !track) return;
  var old = document.getElementById('ticker-items-clone');
  if (old) old.remove();
  var c = single.cloneNode(true);
  c.id = 'ticker-items-clone';
  c.setAttribute('aria-hidden','true');
  track.appendChild(c);
}

(function boot() {
  // Prices
  fetchAllStooq();
  fetchCryptoLive();
  fetchFFAILive();
  rebuildTickerLoop();
  setInterval(function() {
    fetchAllStooq();
    fetchCryptoLive();
    fetchFFAILive();
  }, 5 * 60 * 1000);

  // Weather — restore saved location or request geo
  setTimeout(function() {
    try {
      var saved = localStorage.getItem('agsist-wx-loc');
      if (saved) {
        var p = JSON.parse(saved);
        if (p.lat && p.lon) { fetchWeather(p.lat, p.lon, p.label); return; }
      }
    } catch(e) {}
    requestGeo();
  }, 800);
})();
