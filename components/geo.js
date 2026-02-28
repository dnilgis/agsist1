/**
 * AGSIST geo.js — Shared JS: weather, prices, ticker, geo, forecast
 * ─────────────────────────────────────────────────────────────────
 * Price fetch order (free-first):
 *   1. Stooq CORS proxy (free, 15-min delayed) — primary for all futures
 *   2. data/prices.json (pre-fetched by GitHub Action via yfinance) — fallback
 *   3. Error state if both fail
 *
 * Barchart Worker is used ONLY for /api/grain-bids (local elevator bids).
 * It is NOT used for futures prices — those are all free via Stooq.
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
  try { localStorage.setItem('agsist-wx-loc', JSON.stringify({lat:lat, lon:lon, label:label})); } catch(e) {}

  var wl = document.getElementById('wx-loading');
  var ze = document.getElementById('wx-zip-entry');
  var wd = document.getElementById('wx-data');
  if (wl) wl.style.display = 'none';
  if (ze) ze.style.display = 'none';
  if (wd) wd.style.display = 'block';

  var wxLoc = document.getElementById('wx-loc');
  if (wxLoc) wxLoc.textContent = '📍 ' + (label || 'Your Location');

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

      var el;
      el = document.getElementById('wx-temp');  if(el) el.textContent = tempF + '°F';
      el = document.getElementById('wx-icon');  if(el) el.textContent = WX_ICONS[code] || '🌡️';
      el = document.getElementById('wx-desc');  if(el) el.textContent = (WX_CODES[code]||'Current Conditions') + ' · Feels ' + feelsF + '°';
      el = document.getElementById('wx-wind');  if(el) el.textContent = degToCompass(c.wind_direction_10m) + ' ' + wind + ' mph';
      el = document.getElementById('wx-humid'); if(el) el.textContent = humid + '%';
      el = document.getElementById('wx-precip');if(el) el.textContent = precip + '%';
      el = document.getElementById('wx-dew');   if(el) el.textContent = dew + '°F';

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

      updateWidgetPreviews(tempF, humid, wind, precip);
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
  var sprayRating = (wind>15||tempF>90||tempF<40||humid<30) ? 'poor'
                  : (wind>10||humid<40||humid>90) ? 'marginal' : 'good';
  var sprayColors  = {good:'rgba(62,207,110,.08)',marginal:'rgba(230,176,66,.08)',poor:'rgba(240,96,96,.08)'};
  var sprayBorders = {good:'rgba(62,207,110,.2)',marginal:'rgba(230,176,66,.2)',poor:'rgba(240,96,96,.2)'};
  var sprayIcons   = {good:'✅',marginal:'⚠️',poor:'🚫'};
  var sprayLabels  = {good:'Good — Apply Now',marginal:'Use Caution',poor:'Do Not Spray'};
  var sprayEl  = document.getElementById('wsp-spray-icon');
  var statusEl = document.getElementById('wsp-spray-status');
  var detailEl = document.getElementById('wsp-spray-detail');
  var wrapEl   = document.getElementById('wsp-spray');
  if (sprayEl)  sprayEl.textContent = sprayIcons[sprayRating];
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
      var wxLocEl  = document.getElementById('wx-loc');
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

// ─────────────────────────────────────────────────────────────────
// CASH BIDS — Barchart Worker (grain bids only, not futures prices)
// ─────────────────────────────────────────────────────────────────
var WORKER_URL = 'https://agsist-prices.workers.dev';

function lookupBids() {
  var zip = (document.getElementById('bids-zip') || {}).value;
  if (!zip || zip.length !== 5 || isNaN(zip)) return;
  loadCashBids(zip);
}

function loadCashBids(zip) {
  var geoBar   = document.getElementById('bids-geo-bar');
  var zipRow   = document.getElementById('bids-zip-row');
  var listArea = document.getElementById('bids-list-area');
  if (geoBar) geoBar.style.display = 'none';
  if (zipRow) zipRow.style.display = 'none';
  var bz = document.getElementById('bids-zip');
  if (bz && !bz.value) bz.value = zip;

  if (!listArea) return;

  listArea.innerHTML = '<div class="bids-loading">'
    + '<div style="font-size:.75rem;color:var(--text-muted);text-align:center;padding:.75rem 0">'
    + '⏳ Loading bids near ZIP ' + zip + '…</div></div>';

  fetch(WORKER_URL + '/api/grain-bids?zip=' + zip + '&commodityCode=corn,soybeans')
    .then(function(r) {
      if (!r.ok) throw new Error('worker ' + r.status);
      return r.json();
    })
    .then(function(data) { renderBids(data, zip, listArea); })
    .catch(function() {
      listArea.innerHTML = renderBidsPlaceholder(zip);
    });
}

function renderBids(data, zip, container) {
  var bids = (data && data.results) ? data.results : [];
  if (!bids.length) { container.innerHTML = renderBidsPlaceholder(zip); return; }
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
    + '<div style="font-size:.78rem;color:var(--text-muted);line-height:1.5">Deploy the Cloudflare Worker to enable live bids.<br>Use <a href="/cash-bids" style="color:var(--gold)">Cash Bids →</a> for manual lookup near ' + zip + '.</div>'
    + '</div>';
}

// ─────────────────────────────────────────────────────────────────
// PRICE CONFIGURATION
// ─────────────────────────────────────────────────────────────────
// HTML data-sym MUST match PRICE_MAP keys exactly.
// stooq: Stooq symbol (15-min delayed, free, no key).
// priceEl / chgEl: element IDs in the page for price cards.
//   null = no dedicated card (ticker-only).
// suffix: appended to price string (e.g. '%' for treasury).
// ─────────────────────────────────────────────────────────────────
var PRICE_MAP = {
  // key           label                priceEl            chgEl               dec    grain   stooq            suffix
  'corn':       { label:'Corn (front)', priceEl:'pcp-corn-near',   chgEl:'pcc-corn-near',   dec:2, grain:true,  stooq:'zc.f'      },
  'corn-dec':   { label:"Corn Dec'26",  priceEl:'pcp-corn-dec',    chgEl:'pcc-corn-dec',    dec:2, grain:true,  stooq:'zcz26.cbt' },
  'beans':      { label:'Beans (front)',priceEl:'pcp-bean-near',   chgEl:'pcc-bean-near',   dec:2, grain:true,  stooq:'zs.f'      },
  'beans-nov':  { label:"Beans Nov'26", priceEl:'pcp-bean-nov',    chgEl:'pcc-bean-nov',    dec:2, grain:true,  stooq:'zsx26.cbt' },
  'wheat':      { label:'Wheat (front)',priceEl:'pcp-wheat',       chgEl:'pcc-wheat',       dec:2, grain:true,  stooq:'zw.f'      },
  'cattle':     { label:'Live Cattle',  priceEl:'pcp-cattle',      chgEl:'pcc-cattle',      dec:3, grain:false, stooq:'le.f'      },
  'feeders':    { label:'Feeder Cattle',priceEl:'pcp-feeders',     chgEl:'pcc-feeders',     dec:3, grain:false, stooq:'gf.f'      },
  'hogs':       { label:'Lean Hogs',    priceEl:'pcp-hogs',        chgEl:'pcc-hogs',        dec:3, grain:false, stooq:'he.f'      },
  'meal':       { label:'Soy Meal',     priceEl:'pcp-meal',        chgEl:'pcc-meal',        dec:2, grain:false, stooq:'zm.f'      },
  'soyoil':     { label:'Soy Oil',      priceEl:'pcp-soyoil',      chgEl:'pcc-soyoil',      dec:2, grain:false, stooq:'zl.f'      },
  'crude':      { label:'Crude WTI',    priceEl:'pcp-crude',       chgEl:'pcc-crude',       dec:2, grain:false, stooq:'cl.f'      },
  'natgas':     { label:'Natural Gas',  priceEl:'pcp-natgas',      chgEl:'pcc-natgas',      dec:3, grain:false, stooq:'ng.f'      },
  'gold':       { label:'Gold',         priceEl:'pc-gold',         chgEl:'pcc-gold',        dec:0, grain:false, stooq:'gc.f'      },
  'silver':     { label:'Silver',       priceEl:'pc-silver',       chgEl:'pcc-silver',      dec:2, grain:false, stooq:'si.f'      },
  'dollar':     { label:'Dollar Index', priceEl:'pcp-dollar',      chgEl:'pcc-dollar',      dec:2, grain:false, stooq:'dx.f'      },
  'treasury10': { label:'10-Yr Tsy',    priceEl:'pcp-treasury',    chgEl:'pcc-treasury',    dec:2, grain:false, stooq:'%5etnx',   suffix:'%' },
  'sp500':      { label:'S&P 500',      priceEl:'pcp-sp500',       chgEl:'pcc-sp500',       dec:0, grain:false, stooq:'%5espx'    },
};

// ─────────────────────────────────────────────────────────────────
// PRICE FORMATTING
// ─────────────────────────────────────────────────────────────────
function fmtPrice(val, dec, grain, suffix) {
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

function fmtChange(close, open, grain, netChg, pctChg) {
  var c = parseFloat(close), o = parseFloat(open);
  if (isNaN(c) || isNaN(o)) return {text:'--', cls:'nc'};
  var diff  = netChg !== undefined ? parseFloat(netChg) : (c - o);
  var pct   = pctChg !== undefined ? parseFloat(pctChg) : (o !== 0 ? (diff/o)*100 : 0);
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

// Apply a normalized price result to the DOM + ticker
function applyPriceResult(result) {
  var key = result.key;
  var q   = PRICE_MAP[key];
  if (!q) return;

  var priceTxt = fmtPrice(result.close, q.dec, q.grain, q.suffix);
  var chgObj   = fmtChange(result.close, result.open, q.grain, result.netChg, result.pctChg);

  if (q.priceEl) { updatePriceEl(q.priceEl, priceTxt); updateRangeBar(q.priceEl, result.close); }
  if (q.chgEl)   updatePriceEl(q.chgEl, chgObj.text, chgObj.cls);

  // Update ticker items — data-sym matches PRICE_MAP key
  document.querySelectorAll('[data-sym="' + key + '"]').forEach(function(el) {
    var pe = el.querySelector('.t-price');
    var ce = el.querySelector('.t-chg');
    if (pe) pe.textContent = priceTxt;
    if (ce) { ce.textContent = chgObj.text; ce.className = 't-chg ' + chgObj.cls; }
  });
  rebuildTickerLoop();
}

// ─────────────────────────────────────────────────────────────────
// TIER 1 — Stooq CORS proxy (primary, free, 15-min delayed)
// Fan out all symbols in parallel; call cb when each resolves.
// ─────────────────────────────────────────────────────────────────
function fetchStooqSym(key, q, cb) {
  var stooqUrl = 'https://stooq.com/q/l/?s=' + q.stooq + '&f=sd2t2ohlcv&h&e=csv';
  var proxy1   = 'https://corsproxy.io/?' + encodeURIComponent(stooqUrl);
  var proxy2   = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(stooqUrl);

  function tryProxy(url, fallback) {
    fetch(url, {cache:'no-store'})
      .then(function(r) { return r.text(); })
      .then(function(csv) {
        var lines = csv.trim().split('\n');
        if (lines.length < 2) throw new Error('no data');
        var cols = lines[1].split(',');
        // CSV columns: Symbol, Date, Time, Open, High, Low, Close, Volume
        var open  = parseFloat(cols[3]);
        var close = parseFloat(cols[6]);
        if (isNaN(close) || close <= 0) throw new Error('invalid price');
        cb(null, { key:key, open:open, close:close, source:'stooq' });
      })
      .catch(function(e) {
        if (fallback) { tryProxy(fallback, null); } else { cb(e, null); }
      });
  }
  tryProxy(proxy1, proxy2);
}

// ─────────────────────────────────────────────────────────────────
// TIER 2 — data/prices.json (GitHub Action pre-fetch via yfinance)
// Used only for symbols that Stooq failed to return.
// ─────────────────────────────────────────────────────────────────
function fetchPricesJson(skipKeys, cb) {
  fetch('/data/prices.json', { cache: 'no-store' })
    .then(function(r) {
      if (!r.ok) throw new Error('prices.json ' + r.status);
      return r.json();
    })
    .then(function(data) {
      var quotes = data.quotes || {};
      var filled = {};
      Object.keys(quotes).forEach(function(key) {
        if (skipKeys && skipKeys[key]) return;
        var q = quotes[key];
        if (!q || !q.close) return;
        applyPriceResult({ key:key, close:q.close, open:q.open, netChg:q.netChange, source:'cache' });
        filled[key] = true;
      });
      cb(filled);
    })
    .catch(function() { cb({}); });
}

// ─────────────────────────────────────────────────────────────────
// MAIN PRICE FETCH — Stooq first, prices.json for gaps
// ─────────────────────────────────────────────────────────────────
var _priceSource = null;

function updatePriceStatus(source, count) {
  // Don't downgrade from a better source
  if (_priceSource === 'stooq' && source === 'cache') return;
  _priceSource = source;
  var el = document.getElementById('price-data-status');
  if (!el) return;
  if (source === 'stooq') {
    el.textContent = '15-min delayed · Stooq';
    el.style.color = 'var(--text-muted)';
  } else if (source === 'cache') {
    el.textContent = 'Cached · Updated 30min';
    el.style.color = 'var(--text-muted)';
  } else {
    el.textContent = '⚠ Price data unavailable — refresh to retry';
    el.style.color = 'var(--gold)';
  }
}

function fetchAllPrices() {
  var keys = Object.keys(PRICE_MAP).filter(function(k) { return PRICE_MAP[k].stooq; });
  var filled = {};
  var done   = 0;
  var total  = keys.length;

  keys.forEach(function(key) {
    fetchStooqSym(key, PRICE_MAP[key], function(err, result) {
      done++;
      if (!err && result) {
        applyPriceResult(result);
        filled[key] = true;
      }

      // All Stooq attempts done
      if (done === total) {
        var okCount = Object.keys(filled).length;
        if (okCount > 0) updatePriceStatus('stooq', okCount);

        // Fill any gaps from prices.json cache
        var missing = keys.filter(function(k) { return !filled[k]; });
        if (missing.length) {
          fetchPricesJson(filled, function(jsonFilled) {
            var jsonCount = Object.keys(jsonFilled).length;
            if (jsonCount > 0 && okCount === 0) updatePriceStatus('cache', jsonCount);
            // If everything still failed, show error
            var totalFilled = okCount + jsonCount;
            if (totalFilled === 0) updatePriceStatus('error', 0);
          });
        } else if (okCount === 0) {
          updatePriceStatus('error', 0);
        }
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// CRYPTO — CoinGecko (free, real-time, no key)
// ─────────────────────────────────────────────────────────────────
function fetchCryptoLive() {
  fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ripple,kaspa&vs_currencies=usd&include_24hr_change=true&precision=4')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var cmap = {
        bitcoin:{ priceEl:'pc-btc',    chgEl:'pcc-btc',    dec:0 },
        ripple: { priceEl:'pc-xrp',    chgEl:'pcc-xrp',    dec:4 },
        kaspa:  { priceEl:'pc-kas',    chgEl:'pcc-kas',    dec:4 },
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
        // Ticker
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

// ─────────────────────────────────────────────────────────────────
// FFAI INDEX — Farmers First Agri Service (free)
// ─────────────────────────────────────────────────────────────────
function fetchFFAILive() {
  fetch('https://farmers1st.com/api/v3/current.json')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var score = d.composite;
      var prev  = d.previous ? d.previous.composite : null;
      var diff  = prev !== null ? parseFloat((score - prev).toFixed(1)) : null;
      var dir   = diff && diff > 0 ? 'up' : 'dn';
      var sign  = diff && diff > 0 ? '▲' : '▼';
      var priceTxt = score.toFixed(1);
      var chgTxt   = diff ? sign + ' ' + Math.abs(diff) + ' pts' : '--';

      // Ticker
      document.querySelectorAll('[data-sym="ffai"]').forEach(function(el) {
        var pe = el.querySelector('.t-price');
        var ce = el.querySelector('.t-chg');
        if (pe) { pe.textContent = priceTxt; pe.style.color = 'var(--blue)'; }
        if (ce && diff) { ce.className = 't-chg ' + dir; ce.textContent = chgTxt; }
      });

      // Hero sidebar score card
      var scoreEl = document.getElementById('ffai-score');
      if (scoreEl) scoreEl.textContent = priceTxt;
      var chgEl = document.getElementById('ffai-change');
      if (chgEl && diff) { chgEl.className = 'ffai-change ' + dir; chgEl.textContent = chgTxt; }

      // Compact card in metals/crypto section
      var compactEl = document.getElementById('ffai-score-compact');
      if (compactEl) compactEl.textContent = priceTxt;
    }).catch(function() {});
}

// ─────────────────────────────────────────────────────────────────
// TICKER
// ─────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────
// KALSHI PREDICTION MARKETS — ag-related odds (free, no key)
// ─────────────────────────────────────────────────────────────────
var KALSHI_KEYWORDS = ['USDA', 'corn', 'soybean', 'wheat', 'drought', 'farm', 'crop', 'WASDE'];
var KALSHI_BASE     = 'https://trading.kalshi.com/trade-api/v2/markets';

function fetchKalshiMarkets() {
  var grid    = document.getElementById('kalshi-grid');
  var loading = document.getElementById('kalshi-loading');
  if (!grid) return;

  var seen    = {};
  var markets = [];
  var pending = KALSHI_KEYWORDS.length;

  function onDone() {
    pending--;
    if (pending > 0) return;

    markets.sort(function(a, b) { return (b.volume_24h || 0) - (a.volume_24h || 0); });
    var top = markets.slice(0, 6);

    if (!top.length) {
      if (loading) loading.innerHTML = '<span style="color:var(--text-muted);font-size:.78rem">No active ag markets on Kalshi right now — check back later.</span>';
      return;
    }

    if (loading) loading.remove();
    top.forEach(function(m) { grid.appendChild(buildKalshiCard(m)); });
  }

  KALSHI_KEYWORDS.forEach(function(kw) {
    var url = KALSHI_BASE + '?limit=10&status=open&keyword=' + encodeURIComponent(kw);
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function(r) {
        // Handle CORS failure gracefully
        if (!r.ok) throw new Error('kalshi ' + r.status);
        return r.json();
      })
      .then(function(data) {
        var list = data.markets || [];
        list.forEach(function(m) {
          if (!m.ticker || seen[m.ticker]) return;
          var yes = m.yes_bid !== undefined ? m.yes_bid : m.yes_ask;
          if (yes === undefined) return;
          seen[m.ticker] = true;
          markets.push(m);
        });
        onDone();
      })
      .catch(function() {
        // CORS or network failure — just skip this keyword silently
        onDone();
      });
  });

  // Safety timeout — if all requests silently fail (e.g. CORS block), clear loading state
  setTimeout(function() {
    if (loading && loading.parentNode && markets.length === 0) {
      loading.innerHTML = '<span style="color:var(--text-muted);font-size:.78rem">Prediction market data unavailable. <a href="https://kalshi.com" target="_blank" rel="noopener" style="color:var(--gold)">View on Kalshi →</a></span>';
    }
  }, 8000);
}

function buildKalshiCard(m) {
  var yesBid  = m.yes_bid  !== undefined ? m.yes_bid  : null;
  var yesAsk  = m.yes_ask  !== undefined ? m.yes_ask  : null;
  var noBid   = m.no_bid   !== undefined ? m.no_bid   : null;
  var mid     = (yesBid !== null && yesAsk !== null) ? Math.round((yesBid + yesAsk) / 2) : (yesBid || yesAsk || 50);
  var vol24   = m.volume_24h || 0;
  var closeTs = m.close_time ? new Date(m.close_time) : null;

  var color   = mid >= 60 ? 'var(--green)' : mid <= 40 ? 'var(--red)' : 'var(--gold)';
  var bgAlpha = mid >= 60 ? 'rgba(62,207,110,.06)' : mid <= 40 ? 'rgba(240,96,96,.06)' : 'rgba(230,176,66,.06)';
  var borderC = mid >= 60 ? 'rgba(62,207,110,.2)'  : mid <= 40 ? 'rgba(240,96,96,.2)'  : 'rgba(230,176,66,.2)';

  var closeStr = '';
  if (closeTs) {
    var now   = new Date();
    var diffD = Math.ceil((closeTs - now) / 86400000);
    if (diffD <= 0)       closeStr = 'Closes today';
    else if (diffD === 1) closeStr = 'Closes tomorrow';
    else if (diffD <= 30) closeStr = 'Closes in ' + diffD + ' days';
    else                  closeStr = 'Closes ' + closeTs.toLocaleDateString('en-US', {month:'short', day:'numeric'});
  }

  var volStr = vol24 >= 1000 ? '$' + (vol24/1000).toFixed(1) + 'k 24h vol' : (vol24 > 0 ? '$' + vol24 + ' 24h vol' : '');
  var title  = (m.title || m.ticker || 'Market');
  var titleD = title.length > 80 ? title.slice(0, 77) + '…' : title;

  var div = document.createElement('div');
  div.style.cssText = 'background:' + bgAlpha + ';border:1px solid ' + borderC + ';border-radius:10px;padding:1rem;display:flex;flex-direction:column;gap:.5rem';
  div.innerHTML =
    '<div style="font-size:.78rem;font-weight:600;color:var(--text);line-height:1.4">' + titleD + '</div>' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:.15rem">' +
      '<div><span style="font-size:1.6rem;font-weight:700;color:' + color + ';font-family:\'Oswald\',sans-serif">' + mid + '&#162;</span>' +
      '<span style="font-size:.72rem;color:var(--text-muted);margin-left:.35rem">YES</span></div>' +
      '<div style="text-align:right"><div style="font-size:.75rem;font-weight:700;color:' + color + '">' + mid + '% chance</div>' +
      (noBid !== null ? '<div style="font-size:.68rem;color:var(--text-muted)">NO: ' + noBid + '&#162;</div>' : '') + '</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border);padding-top:.4rem;margin-top:.1rem">' +
      '<span style="font-size:.65rem;color:var(--text-muted)">' + closeStr + '</span>' +
      (volStr ? '<span style="font-size:.65rem;color:var(--text-muted)">' + volStr + '</span>' : '') +
    '</div>' +
    '<a href="https://kalshi.com/markets/' + (m.ticker || '') + '" target="_blank" rel="noopener" ' +
      'style="font-size:.7rem;color:' + color + ';text-align:center;padding:.3rem;border:1px solid currentColor;border-radius:5px;text-decoration:none;margin-top:.1rem;opacity:.8">' +
      'Trade on Kalshi &#8594;</a>';
  return div;
}

// ─────────────────────────────────────────────────────────────────
// DAILY BRIEFING — load from data/daily.json (generated by GitHub Action)
// ─────────────────────────────────────────────────────────────────
function loadDailyBriefing() {
  fetch('/data/daily.json', { cache: 'no-store' })
    .then(function(r) {
      if (!r.ok) throw new Error('daily.json ' + r.status);
      return r.json();
    })
    .then(function(d) {
      var el;

      // Main briefing elements
      el = document.getElementById('daily-headline');    if (el && d.headline)    el.textContent = d.headline;
      el = document.getElementById('daily-subheadline'); if (el && d.subheadline) el.textContent = d.subheadline;
      el = document.getElementById('daily-lead');        if (el && d.lead)        el.textContent = d.lead;
      el = document.getElementById('daily-date');        if (el && d.date)        el.textContent = d.date;

      // Teaser bar — update the text AND the date badge
      el = document.getElementById('daily-teaser-text'); if (el && d.teaser)      el.textContent = d.teaser;
      el = document.getElementById('daily-teaser-date'); if (el && d.date)        el.textContent = '📰 AGSIST Daily · ' + d.date;

      // One Number
      if (d.one_number) {
        el = document.getElementById('daily-number-value');   if (el) el.textContent = d.one_number.value;
        el = document.getElementById('daily-number-unit');    if (el) el.textContent = d.one_number.unit;
        el = document.getElementById('daily-number-context'); if (el) el.textContent = d.one_number.context;
      }

      // Sections
      if (d.sections && Array.isArray(d.sections)) {
        d.sections.forEach(function(sec, i) {
          el = document.getElementById('daily-section-' + (i+1) + '-title'); if (el && sec.title) el.textContent = sec.title;
          el = document.getElementById('daily-section-' + (i+1) + '-body');  if (el && sec.body)  el.textContent = sec.body;
        });
      }

      // Watch list
      var wl = document.getElementById('daily-watch-list');
      if (wl && d.watch_list && d.watch_list.length) {
        wl.innerHTML = '';
        d.watch_list.forEach(function(item) {
          var li = document.createElement('li');
          li.innerHTML = '<strong>' + (item.time||'') + '</strong> — ' + (item.desc||'');
          wl.appendChild(li);
        });
      }

      // Source badge
      el = document.getElementById('daily-source'); if (el) el.textContent = 'AI · Barchart · USDA';

      // Show content
      el = document.getElementById('daily-loading'); if (el) el.style.display = 'none';
      el = document.getElementById('daily-content'); if (el) el.style.display = 'block';
    })
    .catch(function() {
      // daily.json missing — show whatever static content is in the HTML
      var loading = document.getElementById('daily-loading');
      var content = document.getElementById('daily-content');
      if (loading) loading.style.display = 'none';
      if (content) content.style.display = 'block';
    });
}

// ─────────────────────────────────────────────────────────────────
// BOOT — runs on DOM ready
// ─────────────────────────────────────────────────────────────────
(function boot() {
  function init() {
    rebuildTickerLoop();

    // Free price sources — fan out in parallel
    fetchAllPrices();
    fetchCryptoLive();
    fetchFFAILive();

    // Homepage-only features
    if (document.getElementById('daily-headline')) loadDailyBriefing();
    if (document.getElementById('kalshi-grid'))    fetchKalshiMarkets();

    // Refresh prices every 5 minutes
    setInterval(function() {
      fetchAllPrices();
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
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
