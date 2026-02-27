/**
 * AGSIST Geolocation Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Browser geolocation → reverse geocode → auto-populate ZIP for weather/bids.
 * Include only on pages that need it: weather dashboard, cash bids.
 *
 * Elements it looks for (all optional — skips gracefully if missing):
 *   #wx-loading        — weather loading state
 *   #wx-zip-entry      — fallback ZIP input for weather
 *   #bids-geo-bar      — "detecting location" bar above bids
 *   #bids-zip-row      — manual ZIP row for bids
 *   #bids-zip          — ZIP input value
 */


function requestGeo(){
  if(!navigator.geolocation){showZipEntry();return}
  document.getElementById('wx-loading').innerHTML='<div style="font-size:1.5rem;margin-bottom:.5rem">📍</div><div style="font-size:.88rem;color:var(--text-dim)">Detecting location…</div>';
  navigator.geolocation.getCurrentPosition(
    function(pos){fetchWeather(pos.coords.latitude,pos.coords.longitude,null)},
    function(){showZipEntry()},
    {timeout:8000}
  );
}

function showZipEntry(){
  document.getElementById('wx-loading').style.display='none';
  document.getElementById('wx-zip-entry').style.display='block';
}

function loadWeatherZip(){
  var zip=document.getElementById('wx-zip').value.trim();
  if(zip.length!==5||isNaN(zip))return;
  // Use open-meteo geocoding for ZIP
  fetch('https://geocoding-api.open-meteo.com/v1/search?name='+zip+'&count=1&language=en&format=json&countryCode=US')
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.results&&d.results.length){
        var r=d.results[0];
        fetchWeather(r.latitude,r.longitude,r.name+(r.admin1?', '+r.admin1.substring(0,2):''));
      }
    })
    .catch(function(){});
}

function fetchWeather(lat,lon,label){
  document.getElementById('wx-loading').style.display='none';
  document.getElementById('wx-zip-entry').style.display='none';
  // Mark geo as resolved so all ZIP prompts know
  try{ sessionStorage.setItem('agsist-geo-done','1'); }catch(e){}
  document.getElementById('wx-data').style.display='block';
  document.getElementById('wx-loc').textContent='📍 '+(label||'Your Location');

  var url='https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon
    +'&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,dew_point_2m'
    +'&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=1';

  fetch(url)
    .then(function(r){return r.json()})
    .then(function(d){
      var c=d.current;
      var code=c.weather_code;
      var tempF=Math.round(c.temperature_2m);
      var feelsF=Math.round(c.apparent_temperature);
      var wind=Math.round(c.wind_speed_10m);
      var windDir=degToCompass(c.wind_direction_10m);
      var humid=c.relative_humidity_2m;
      var precip=c.precipitation_probability;
      var dew=Math.round(c.dew_point_2m);

      document.getElementById('wx-temp').textContent=tempF+'°F';
      document.getElementById('wx-icon').textContent=WX_ICONS[code]||'🌡️';
      document.getElementById('wx-desc').textContent=(WX_CODES[code]||'Current Conditions')+' · Feels '+feelsF+'°';
      document.getElementById('wx-wind').textContent=windDir+' '+wind+' mph';
      document.getElementById('wx-humid').textContent=humid+'%';
      document.getElementById('wx-precip').textContent=precip+'%';
      document.getElementById('wx-dew').textContent=dew+'°F';

      // Spray conditions logic
      var spray=document.getElementById('wx-spray');
      if(wind>15){
        spray.className='spray-badge poor';spray.textContent='🚫 Poor Spray Conditions — Wind too high ('+wind+' mph)';
      } else if(wind>10||humid>90||humid<40){
        spray.className='spray-badge caution';spray.textContent='⚠️ Marginal Spray Conditions — Monitor conditions';
      } else {
        spray.className='spray-badge good';spray.textContent='✅ Good Spray Conditions';
      }

      // Urea volatilization risk inline widget
      var ureaWrap=document.getElementById('wx-urea');
      if(ureaWrap){
        var tempF=parseFloat(data.temperature_2m)||55;
        var popPct=data.precipitation_probability||0;
        function _uTR(f){return f<40?5:f<50?15:f<60?30:f<70?50:f<80?72:f<90?88:98;}
        function _uHR(h){return h<30?25:h<50?45:h<70?75:h<85?60:35;}
        function _uWR(w){return w<2?15:w<5?35:w<10?60:w<15?78:90;}
        function _uRR(p){return p>=70?10:p>=50?25:p>=30?55:85;}
        var uScore=Math.round(_uTR(tempF)*0.35+_uHR(humid)*0.25+_uWR(wind)*0.20+_uRR(popPct)*0.20);
        var uLevel=uScore<30?'low':uScore<55?'moderate':uScore<75?'high':'extreme';
        var uPalette={low:'62,207,110',moderate:'230,176,66',high:'240,145,58',extreme:'240,96,96'};
        var uLabels={low:'Low',moderate:'Moderate',high:'High',extreme:'Extreme'};
        var uColorVar={low:'var(--green)',moderate:'var(--gold)',high:'#f0913a',extreme:'var(--red)'};
        var sEl=document.getElementById('wx-urea-score');
        var bEl=document.getElementById('wx-urea-badge');
        if(sEl){sEl.textContent=uScore;sEl.style.color=uColorVar[uLevel];}
        if(bEl){
          bEl.textContent=uLabels[uLevel];
          bEl.style.color=uColorVar[uLevel];
          bEl.style.background='rgba('+uPalette[uLevel]+',.12)';
          bEl.style.border='1px solid rgba('+uPalette[uLevel]+',.25)';
        }
        ureaWrap.style.display='block';
      }

      // Reverse geocode for location name if we only have coords
      // Reverse geocode — propagate location name + ZIP to all widgets
      (function propagateLocation(){
        var needsGeo = !label;
        var url = 'https://nominatim.openstreetmap.org/reverse?lat='+lat+'&lon='+lon+'&format=json';
        fetch(url).then(function(r){return r.json()}).then(function(geo){
          var city  = geo.address.city||geo.address.town||geo.address.village||geo.address.county||'';
          var st    = geo.address.state_code||'';
          var zip   = geo.address.postcode||'';
          var name  = city+(st?', '+st:'');
          // Weather card location label
          var wxLoc = document.getElementById('wx-loc');
          if(wxLoc && name) wxLoc.textContent = '📍 '+name;
          // Radar sidebar location label
          var radarLbl = document.getElementById('wx-loc-label');
          if(radarLbl && name) radarLbl.textContent = name;
          // Cash Bids: pre-fill ZIP and auto-load
          if(zip){
            var bidsZip = document.getElementById('bids-zip');
            if(bidsZip && !bidsZip.value) bidsZip.value = zip;
            if(typeof loadCashBids === 'function') loadCashBids(zip);
          } else if(name) {
            // No ZIP from geocode but have city name — update bids detecting label
            var geoTxt = document.getElementById('bids-geo-txt');
            if(geoTxt) geoTxt.textContent = 'Location: ' + name + ' — enter ZIP for bids';
            var geoBar = document.getElementById('bids-geo-bar');
            if(geoBar){
              var manualBtn = geoBar.querySelector('button');
              if(manualBtn) manualBtn.style.display = 'inline';
            }
          }
          // Hide weather ZIP entry — geo resolved it
          var wxZip = document.getElementById('wx-zip-entry');
          if(wxZip) wxZip.style.display = 'none';
          // Save enriched label for return visits
          try{
            var saved = JSON.parse(localStorage.getItem('agsist-wx-loc')||'{}');
            if(name) saved.label = name;
            if(zip)  saved.zip   = zip;
            localStorage.setItem('agsist-wx-loc', JSON.stringify(saved));
          }catch(e){}
        }).catch(function(){});
      })();
    })
    .catch(function(){
      document.getElementById('wx-data').style.display='none';
      var wl=document.getElementById('wx-loading');
      wl.innerHTML='';
      var msg=document.createElement('div');
      msg.style.cssText='font-size:.88rem;color:var(--text-dim)';
      msg.textContent='Weather unavailable. ';
      var btn=document.createElement('button');
      btn.textContent='Try ZIP →';
      btn.setAttribute('style','background:none;border:none;color:var(--gold);cursor:pointer;font-size:.88rem;font-family:inherit');
      btn.onclick=showZipEntry;
      msg.appendChild(btn);
      wl.appendChild(msg);
      wl.style.display='block';
      document.getElementById('wx-loading').style.display='block';
    });
}

function degToCompass(d){var dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];return dirs[Math.round(d/22.5)%16]}

// Auto-request on load (after short delay to not be jarring)
setTimeout(function(){
  try{
    var saved=localStorage.getItem('agsist-wx-loc');
    if(saved){var p=JSON.parse(saved);fetchWeather(p.lat,p.lon,p.label);return}
  }catch(e){}
  requestGeo();
},800);

// Save weather location for return visits
var _origFetchWx=fetchWeather;
fetchWeather=function(lat,lon,label){
  try{localStorage.setItem('agsist-wx-loc',JSON.stringify({lat:lat,lon:lon,label:label}))}catch(e){}
  _origFetchWx(lat,lon,label);
};


// ── Time-based greeting ───────────────────────────────────────────
(function(){
  var h=new Date().getHours();
  var g=h<12?'Good Morning':h<17?'Good Afternoon':'Good Evening';
  var el=document.getElementById('site-greeting');
  if(el)el.textContent=g;
})();

// ── 3-day forecast appended to weather fetch ─────────────────────
function buildDayCard(dname,icon,hi,lo,pop){
  var d=document.createElement('div');
  d.style.cssText='flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:.5rem .4rem;text-align:center';
  d.innerHTML='<div style="font-size:.64rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted);margin-bottom:.2rem">'+dname+'</div>'
    +'<div style="font-size:1.3rem;line-height:1;margin-bottom:.2rem">'+icon+'</div>'
    +'<div style="font-size:.82rem;font-weight:700;color:var(--text)">'+hi+'&#176;</div>'
    +'<div style="font-size:.74rem;color:var(--text-muted)">'+lo+'&#176;</div>'
    +(pop>20?'<div style="font-size:.68rem;color:var(--blue);margin-top:.15rem">&#128167;'+pop+'%</div>':'');
  return d;
}
function renderForecast(lat, lon){
  var url='https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon
    +'&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    +'&temperature_unit=fahrenheit&timezone=auto&forecast_days=4';
  fetch(url).then(function(r){return r.json()}).then(function(d){
    var days=d.daily;
    var fc=document.getElementById('wx-forecast');
    var fcFull=document.getElementById('wx-forecast-full');
    var locLabel=document.getElementById('wx-loc-label');
    if(locLabel&&lat)locLabel.textContent=document.getElementById('wx-loc').textContent.replace('📍 ','');
    var dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    if(fc){
      fc.innerHTML='';
      for(var i=1;i<4;i++){
        var day=new Date(days.time[i]+'T12:00:00');
        var dname=i===1?'Tomorrow':dayNames[day.getDay()];
        var icon=WX_ICONS[days.weather_code[i]]||'&#127777;';
        fc.appendChild(buildDayCard(dname,icon,Math.round(days.temperature_2m_max[i]),Math.round(days.temperature_2m_min[i]),days.precipitation_probability_max[i]));
      }
    }
    // Populate the radar sidebar 4-day card
    if(fcFull){
      var dns2=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      fcFull.innerHTML='';
      for(var j=0;j<4;j++){
        var dj=new Date(days.time[j]+'T12:00:00');
        var dnj=j===0?'Today':dns2[dj.getDay()];
        var el=document.createElement('div');
        el.className='wx-day';
        var popj=days.precipitation_probability_max[j];
        el.innerHTML='<div class="wx-day-name">'+dnj+'</div>'
          +'<div class="wx-day-icon">'+(WX_ICONS[days.weather_code[j]]||'&#127777;')+'</div>'
          +'<div class="wx-day-hi">'+Math.round(days.temperature_2m_max[j])+'&#176;</div>'
          +'<div class="wx-day-lo">'+Math.round(days.temperature_2m_min[j])+'&#176;</div>'
          +(popj>15?'<div class="wx-day-pop">&#128167;'+popj+'%</div>':'');
        fcFull.appendChild(el);
      }
    }
  }).catch(function(){});
}

// Patch fetchWeather to also load forecast
var _origFW=fetchWeather;
fetchWeather=function(lat,lon,label){
  _origFW(lat,lon,label);
  renderForecast(lat,lon);
};



// ═══════════════════════════════════════════════════════════════════════
// LIVE PRICES — replaces ALL hardcoded values
// Sources:
//   • Grain/Livestock/Energy/Metals/Macro → Yahoo Finance (15-min delayed, free)
//   • Crypto → CoinGecko (free, no key)
//   • FFAI   → farmers1st.com API
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// LIVE PRICES — Stooq.com (free, no API key, 15-min delayed)
//   + CoinGecko for crypto
//   + farmers1st.com for FFAI
// Stooq CSV format: Symbol,Date,Time,Open,High,Low,Close,Volume
// ═══════════════════════════════════════════════════════════════════════

// Stooq symbol → { label, priceId, chgId, decimals, isGrain }
var STOOQ_QUOTES = [
  {sym:'zc.f',  label:'Corn (front)',   priceEl:'pcp-corn-near', chgEl:'pcc-corn-near', dec:2, grain:true},
  {sym:'zcz26.cbt',label:"Corn Dec'26", priceEl:'pcp-corn-dec',  chgEl:'pcc-corn-dec',  dec:2, grain:true},
  {sym:'zs.f',  label:'Beans (front)',  priceEl:'pcp-bean-near', chgEl:'pcc-bean-near', dec:2, grain:true},
  {sym:'zsx26.cbt',label:"Beans Nov'26",priceEl:'pcp-bean-nov',  chgEl:'pcc-bean-nov',  dec:2, grain:true},
  {sym:'zw.f',  label:'Wheat (front)',  priceEl:null,            chgEl:null,            dec:2, grain:true},
  {sym:'le.f',  label:'Live Cattle',    priceEl:null,            chgEl:null,            dec:3, grain:false},
  {sym:'gf.f',  label:'Feeder Cattle',  priceEl:null,            chgEl:null,            dec:3, grain:false},
  {sym:'he.f',  label:'Lean Hogs',      priceEl:null,            chgEl:null,            dec:3, grain:false},
  {sym:'zm.f',  label:'Soy Meal',       priceEl:null,            chgEl:null,            dec:2, grain:false},
  {sym:'zl.f',  label:'Soy Oil',        priceEl:null,            chgEl:null,            dec:2, grain:false},
  {sym:'cl.f',  label:'Crude WTI',      priceEl:null,            chgEl:null,            dec:2, grain:false},
  {sym:'ng.f',  label:'Natural Gas',    priceEl:null,            chgEl:null,            dec:3, grain:false},
  {sym:'gc.f',  label:'Gold',           priceEl:'pc-gold',       chgEl:'pcc-gold',      dec:0, grain:false},
  {sym:'si.f',  label:'Silver',         priceEl:'pc-silver',     chgEl:'pcc-silver',    dec:2, grain:false},
  {sym:'dx.f',  label:'Dollar Index',   priceEl:null,            chgEl:null,            dec:2, grain:false},
  {sym:'%5etnx',label:'10-Yr Treasury', priceEl:null,            chgEl:null,            dec:2, grain:false, suffix:'%'}
];

// Label → stooq sym for ticker lookup
var STOOQ_BY_LABEL = {};
STOOQ_QUOTES.forEach(function(q){ STOOQ_BY_LABEL[q.label] = q; });

function fmtStooqPrice(val, dec, grain, suffix){
  var p = parseFloat(val);
  if(isNaN(p)) return '--';
  if(grain){
    var whole = Math.floor(p);
    var frac  = Math.round((p - whole) * 4) / 4;
    var fracs = {'0':'', '0.25':'¼', '0.5':'½', '0.75':'¾'};
    return whole + (fracs[frac.toFixed(2)] !== undefined ? fracs[frac.toFixed(2)] : frac.toFixed(2));
  }
  if(dec === 0) return p.toLocaleString('en-US', {maximumFractionDigits:0});
  return p.toFixed(dec) + (suffix||'');
}

function fmtStooqChg(close, open, grain){
  var c = parseFloat(close), o = parseFloat(open);
  if(isNaN(c)||isNaN(o)) return {text:'--', cls:'nc'};
  var diff = c - o;
  var pct  = o !== 0 ? (diff/o)*100 : 0;
  var dir  = diff > 0 ? 'up' : diff < 0 ? 'dn' : 'nc';
  var arrow= diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
  var abs  = Math.abs(diff);
  var txt;
  if(grain){
    txt = arrow + ' ' + (abs*100).toFixed(1) + '¢ (' + (diff>0?'+':'') + pct.toFixed(2) + '%)';
  } else {
    txt = arrow + ' ' + abs.toFixed(abs<1?4:abs<10?3:2) + ' (' + (diff>0?'+':'') + pct.toFixed(2) + '%)';
  }
  return {text:txt, cls:dir};
}

function updatePriceEl(id, txt, cls){
  var el = document.getElementById(id);
  if(!el) return;
  el.textContent = txt;
  if(cls) el.className = el.className.replace(/\b(up|dn|nc)\b/g,'').trim() + ' ' + cls;
}

function updateRangeBar(priceElId, price){
  if(!priceElId) return;
  var priceEl = document.getElementById(priceElId);
  if(!priceEl) return;
  var card = priceEl.closest ? priceEl.closest('.pc') : null;
  if(!card) return;
  var fill   = card.querySelector('.pc-range-fill');
  var dot    = card.querySelector('.pc-range-dot');
  var labels = card.querySelectorAll('.pc-range-labels span');
  if(!fill || labels.length < 3) return;
  var lo = parseFloat(labels[0].textContent.replace(/,/g,''));
  var hi = parseFloat(labels[2].textContent.replace(/,/g,''));
  if(isNaN(lo)||isNaN(hi)||hi===lo) return;
  var pct = Math.min(100, Math.max(0, ((parseFloat(price)-lo)/(hi-lo))*100));
  fill.style.width = pct + '%';
  if(dot) dot.style.left = pct + '%';
}

// Fetch one Stooq symbol via CORS proxy
function fetchStooqSym(q, cb){
  var proxyBase = 'https://corsproxy.io/?';
  var stooqUrl  = 'https://stooq.com/q/l/?s=' + q.sym + '&f=sd2t2ohlcv&h&e=csv';
  fetch(proxyBase + encodeURIComponent(stooqUrl), {cache:'no-store'})
    .then(function(r){ return r.text(); })
    .then(function(csv){
      var lines = csv.trim().split('\n');
      if(lines.length < 2) throw new Error('no data');
      var cols = lines[1].split(',');
      // Symbol,Date,Time,Open,High,Low,Close,Volume
      var open  = cols[3], close = cols[6];
      cb(null, {sym:q.sym, open:open, close:close, q:q});
    })
    .catch(function(e){
      // Try backup proxy
      var backup = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(stooqUrl);
      fetch(backup, {cache:'no-store'})
        .then(function(r){ return r.text(); })
        .then(function(csv){
          var lines = csv.trim().split('\n');
          if(lines.length < 2) throw new Error('no data');
          var cols = lines[1].split(',');
          cb(null, {sym:q.sym, open:cols[3], close:cols[6], q:q});
        })
        .catch(function(){ cb(e, null); });
    });
}

// Track fetch status
var _stooqTotal = 0, _stooqOk = 0;
function updatePriceStatus(){
  var statusEl = document.getElementById('price-data-status');
  if(!statusEl) return;
  if(_stooqOk > 0){
    statusEl.textContent = '15-min delayed · Stooq';
    statusEl.style.color = 'var(--text-muted)';
  } else if(_stooqTotal >= STOOQ_QUOTES.length){
    statusEl.textContent = '⚠ Price data unavailable — refresh to retry';
    statusEl.style.color = 'var(--gold)';
  }
}

function applyStooqResult(data){
  var q = data.q;
  var close = data.close, open = data.open;
  var priceTxt = fmtStooqPrice(close, q.dec, q.grain, q.suffix);
  var chgObj   = fmtStooqChg(close, open, q.grain);

  // Price cards
  if(q.priceEl) updatePriceEl(q.priceEl, priceTxt);
  if(q.chgEl)   updatePriceEl(q.chgEl, chgObj.text, chgObj.cls);
  if(q.priceEl) updateRangeBar(q.priceEl, close);

  // Ticker strip — match by data-sym (Stooq sym) or by label
  document.querySelectorAll('[data-sym]').forEach(function(el){
    var ds = el.getAttribute('data-sym').toLowerCase();
    if(ds !== q.sym) return;
    var pe = el.querySelector('.t-price');
    var ce = el.querySelector('.t-chg');
    if(pe) pe.textContent = priceTxt;
    if(ce){ ce.textContent = chgObj.text; ce.className = 't-chg ' + chgObj.cls; }
  });
  rebuildTickerLoop();
}

function fetchAllStooq(){
  _stooqTotal = 0; _stooqOk = 0;
  STOOQ_QUOTES.forEach(function(q){
    fetchStooqSym(q, function(err, data){
      _stooqTotal++;
      if(err){
        // Silent in console — show status indicator instead
        updatePriceStatus();
        return;
      }
      _stooqOk++;
      applyStooqResult(data);
      updatePriceStatus();
    });
  });
}

// CoinGecko crypto (no key, CORS-enabled)
function fetchCryptoLive(){
  fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ripple,kaspa&vs_currencies=usd&include_24hr_change=true&precision=4')
    .then(function(r){ return r.json(); })
    .then(function(d){
      var cmap = {
        bitcoin:{ priceEl:'pc-btc', chgEl:'pcc-btc', sym:'bitcoin', dec:0 },
        ripple: { priceEl:'pc-xrp', chgEl:'pcc-xrp', sym:'ripple',  dec:4 },
        kaspa:  { priceEl:'pc-kas', chgEl:'pcc-kas', sym:'kaspa',   dec:4 }
      };
      Object.keys(cmap).forEach(function(id){
        var info  = cmap[id];
        var price = d[id] && d[id].usd;
        var chgP  = d[id] && d[id].usd_24h_change;
        if(!price) return;
        var priceTxt = price < 1 ? price.toFixed(4) : price.toLocaleString('en-US',{maximumFractionDigits:2});
        updatePriceEl(info.priceEl, priceTxt);
        if(chgP !== undefined){
          var c = parseFloat(chgP);
          updatePriceEl(info.chgEl, (c>0?'▲':'▼')+' '+Math.abs(c).toFixed(2)+'%', c>0?'up':'dn');
        }
        // Ticker
        document.querySelectorAll('[data-sym="'+id+'"]').forEach(function(el){
          var pe = el.querySelector('.t-price');
          var ce = el.querySelector('.t-chg');
          if(pe) pe.textContent = priceTxt;
          if(ce && chgP !== undefined){
            var c2 = parseFloat(chgP);
            ce.textContent = (c2>0?'▲':'▼')+' '+Math.abs(c2).toFixed(2)+'%';
            ce.className = 't-chg '+(c2>0?'up':'dn');
          }
        });
      });
      rebuildTickerLoop();
    })
    .catch(function(){ /* silent — crypto unavailable in this env */ });
}

// FFAI
function fetchFFAILive(){
  fetch('https://farmers1st.com/api/v3/current.json')
    .then(function(r){ return r.json(); })
    .then(function(d){
      var score = d.composite;
      var prev  = d.previous ? d.previous.composite : null;
      var diff  = prev !== null ? parseFloat((score - prev).toFixed(1)) : null;
      var dir   = diff && diff > 0 ? 'up' : 'dn';
      var sign  = diff && diff > 0 ? '▲' : '▼';
      document.querySelectorAll('.t-item').forEach(function(el){
        var lbl = el.querySelector('.t-label');
        if(lbl && lbl.textContent === 'FFAI Index'){
          var pe = el.querySelector('.t-price');
          var ce = el.querySelector('.t-chg');
          if(pe) pe.textContent = score.toFixed(1);
          if(ce && diff){ ce.className='t-chg '+dir; ce.textContent=sign+' '+Math.abs(diff)+' pts'; }
        }
      });
    }).catch(function(){});
}

// Update Windy iframe center when geo fires
var _windyGeoHook = fetchWeather;
fetchWeather = function(lat, lon, label){
  _windyGeoHook(lat, lon, label);
  var frame = document.getElementById('windy-frame');
  if(frame){
    var la = lat.toFixed(4), lo = lon.toFixed(4);
    frame.src = 'https://embed.windy.com/embed.html?type=map&location=coordinates'
      +'&metricRain=in&metricTemp=%C2%B0F&metricWind=mph'
      +'&zoom=7&overlay=radar&product=radar&level=surface'
      +'&lat='+la+'&lon='+lo+'&detailLat='+la+'&detailLon='+lo
      +'&detail=false&pressure=false&menu=false&message=false&marker=false'
      +'&calendar=now&thunder=false';
  }
};

// Duplicate ticker items for seamless scroll
function rebuildTickerLoop(){
  var single = document.getElementById('ticker-items-single');
  var track  = document.getElementById('ticker-track');
  if(!single || !track) return;
  var old = document.getElementById('ticker-items-clone');
  if(old) old.remove();
  var c = single.cloneNode(true);
  c.id = 'ticker-items-clone';
  c.setAttribute('aria-hidden','true');
  track.appendChild(c);
}


// Boot: fetch all on load, refresh every 5 minutes
(function boot(){
  fetchAllStooq();      // Grain, livestock, energy, metals, macro — Stooq.com
  fetchCryptoLive();    // Crypto — CoinGecko
  fetchFFAILive();      // FFAI — farmers1st.com
  rebuildTickerLoop();  // Render "--" placeholders while loading
  setInterval(function(){
    fetchAllStooq();
    fetchCryptoLive();
    fetchFFAILive();
  }, 5 * 60 * 1000);
})();



<!-- FFAI Badge Script (renders all data-ffai divs) -->
