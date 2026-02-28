#!/usr/bin/env python3
"""
AGSIST Price Fetcher
Runs via GitHub Actions (.github/workflows/prices.yml)
Uses yfinance — completely free, no API key required.
Writes data/prices.json in the format geo.js expects.
"""
import json, sys, os
from datetime import datetime, timezone

try:
    import yfinance as yf
except ImportError:
    print("ERROR: yfinance not installed. Run: pip install yfinance", file=sys.stderr)
    sys.exit(1)

# ── Symbol map ────────────────────────────────────────────────────
# key = PRICE_MAP key in geo.js
# sym = Yahoo Finance ticker
# label, unit, type = metadata (informational only)
SYMBOLS = [
    # Grains
    {'key': 'corn',       'sym': 'ZC=F',      'label': 'Corn (front)',    'unit': '¢/bu',   'type': 'grain'},
    {'key': 'corn-dec',   'sym': 'ZCZ26.CBT', 'label': "Corn Dec '26",   'unit': '¢/bu',   'type': 'grain'},
    {'key': 'beans',      'sym': 'ZS=F',      'label': 'Beans (front)',   'unit': '¢/bu',   'type': 'grain'},
    {'key': 'beans-nov',  'sym': 'ZSX26.CBT', 'label': "Beans Nov '26",  'unit': '¢/bu',   'type': 'grain'},
    {'key': 'wheat',      'sym': 'ZW=F',      'label': 'Wheat (front)',   'unit': '¢/bu',   'type': 'grain'},
    {'key': 'meal',       'sym': 'ZM=F',      'label': 'Soy Meal',        'unit': '$/ton',  'type': 'grain'},
    {'key': 'soyoil',     'sym': 'ZL=F',      'label': 'Soy Oil',         'unit': '¢/lb',   'type': 'grain'},
    # Livestock
    {'key': 'cattle',     'sym': 'LE=F',      'label': 'Live Cattle',     'unit': '¢/lb',   'type': 'livestock'},
    {'key': 'feeders',    'sym': 'GF=F',      'label': 'Feeder Cattle',   'unit': '¢/lb',   'type': 'livestock'},
    {'key': 'hogs',       'sym': 'HE=F',      'label': 'Lean Hogs',       'unit': '¢/lb',   'type': 'livestock'},
    # Energy
    {'key': 'crude',      'sym': 'CL=F',      'label': 'Crude WTI',       'unit': '$/bbl',  'type': 'energy'},
    {'key': 'natgas',     'sym': 'NG=F',      'label': 'Natural Gas',     'unit': '$/MMBtu','type': 'energy'},
    # Metals / Macro
    {'key': 'gold',       'sym': 'GC=F',      'label': 'Gold',            'unit': '$/oz',   'type': 'metal'},
    {'key': 'silver',     'sym': 'SI=F',      'label': 'Silver',          'unit': '$/oz',   'type': 'metal'},
    {'key': 'dollar',     'sym': 'DX-Y.NYB',  'label': 'Dollar Index',    'unit': 'pts',    'type': 'macro'},
    {'key': 'treasury10', 'sym': '^TNX',      'label': '10-Yr Treasury',  'unit': '%',      'type': 'macro'},
    {'key': 'sp500',      'sym': '^GSPC',     'label': 'S&P 500',         'unit': 'pts',    'type': 'macro'},
]


def fetch_quotes():
    """Fetch all quotes from Yahoo Finance via yfinance."""
    syms = [s['sym'] for s in SYMBOLS]
    print(f"Fetching {len(syms)} symbols from Yahoo Finance (yfinance)...")

    # Download 2 days of daily data — gives us prev close + latest close
    data = yf.download(syms, period='2d', interval='1d', group_by='ticker',
                       auto_adjust=True, progress=False)

    results = {}
    for s in SYMBOLS:
        sym = s['sym']
        key = s['key']
        try:
            if len(syms) == 1:
                # Single symbol returns flat DataFrame
                df = data
            elif sym in data.columns.get_level_values(0):
                df = data[sym]
            else:
                print(f"  WARN: {sym} not in response", file=sys.stderr)
                continue

            if df.empty or len(df) < 1:
                continue

            latest = df.iloc[-1]
            prev   = df.iloc[-2] if len(df) >= 2 else df.iloc[-1]

            close     = float(latest['Close'])  if not hasattr(latest['Close'], 'isna') else float(latest['Close'].iloc[0])
            open_px   = float(latest['Open'])   if not hasattr(latest['Open'],  'isna') else float(latest['Open'].iloc[0])
            prev_close= float(prev['Close'])    if not hasattr(prev['Close'],   'isna') else float(prev['Close'].iloc[0])
            net_chg   = round(close - prev_close, 4)
            pct_chg   = round((net_chg / prev_close) * 100, 4) if prev_close else 0.0

            results[key] = {
                'sym':       sym,
                'label':     s['label'],
                'unit':      s['unit'],
                'type':      s['type'],
                'close':     round(close, 4),
                'open':      round(open_px, 4),
                'prevClose': round(prev_close, 4),
                'netChange': net_chg,
                'pctChange': pct_chg,
                'time':      datetime.now(timezone.utc).isoformat(),
            }
            print(f"  ✓ {key:12s} ({sym:14s}) = {close:.4f}  {'+' if net_chg>=0 else ''}{net_chg:.4f}")

        except Exception as e:
            print(f"  WARN: {sym} ({key}) failed: {e}", file=sys.stderr)

    return results


def main():
    quotes = fetch_quotes()

    if not quotes:
        print("ERROR: No quotes fetched — aborting to avoid overwriting good data", file=sys.stderr)
        sys.exit(1)

    output = {
        'fetched': datetime.now(timezone.utc).isoformat(),
        'source':  'Yahoo Finance (yfinance) — free, no API key',
        'quotes':  quotes,
    }

    out_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'prices.json')
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✓ Wrote data/prices.json — {len(quotes)}/{len(SYMBOLS)} symbols fetched")


if __name__ == '__main__':
    main()
