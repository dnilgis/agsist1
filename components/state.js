/**
 * AGSIST State Detection Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight US state detection via browser geolocation + reverse geocoding.
 * Used by: fastfacts, cash-bids, usda-calendar, and any state-aware page.
 *
 * API:
 *   AGSIST_GEO.getState()            → 'WI' (from localStorage or default)
 *   AGSIST_GEO.setState(abbr)        → saves to localStorage, fires event
 *   AGSIST_GEO.detectLocation(ok, fail) → browser geo → state abbr callback
 *
 * Event:
 *   window.dispatchEvent(new CustomEvent('agsist-state-change', {detail: 'MN'}))
 */

window.AGSIST_GEO = (function () {
  'use strict';

  var DEFAULT_STATE = 'WI';
  var STORAGE_KEY   = 'agsist_state';

  function getState() {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_STATE; } catch (e) { return DEFAULT_STATE; }
  }

  function setState(abbr) {
    if (!abbr || abbr.length !== 2) return;
    abbr = abbr.toUpperCase();
    try { localStorage.setItem(STORAGE_KEY, abbr); } catch (e) {}
    window.dispatchEvent(new CustomEvent('agsist-state-change', { detail: abbr }));
  }

  // Lat/lng → US state abbreviation via reverse geocode
  function latLngToState(lat, lng, cb) {
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
              lat.toFixed(3) + ',' + lng.toFixed(3) + '&count=1&language=en&format=json';
    // Use nominatim for reverse geocode (more reliable for state lookup)
    var nominatimUrl = 'https://nominatim.openstreetmap.org/reverse?lat=' +
                       lat + '&lon=' + lng + '&format=json&zoom=5&addressdetails=1';
    fetch(nominatimUrl, { headers: { 'Accept-Language': 'en-US' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var state = d && d.address && d.address.state;
        if (!state) { cb(DEFAULT_STATE); return; }
        var abbr = STATE_NAME_TO_ABBR[state] || DEFAULT_STATE;
        cb(abbr);
      })
      .catch(function () { cb(DEFAULT_STATE); });
  }

  function detectLocation(onSuccess, onFail) {
    if (!navigator.geolocation) { onFail && onFail(); return; }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        latLngToState(pos.coords.latitude, pos.coords.longitude, function (abbr) {
          setState(abbr);
          onSuccess && onSuccess(abbr);
        });
      },
      function () { onFail && onFail(); },
      { timeout: 6000, maximumAge: 300000 }
    );
  }

  var STATE_NAME_TO_ABBR = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
    'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
    'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA',
    'Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD',
    'Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS',
    'Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH',
    'New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC',
    'North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA',
    'Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN',
    'Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA',
    'West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY'
  };

  return { getState: getState, setState: setState, detectLocation: detectLocation };

})();
