#!/usr/bin/env python3
"""
AGSIST Price Fetcher
Runs via GitHub Actions, writes data/prices.json
Required env: BARCHART_API_KEY
"""
import json, os, sys, urllib.request, urllib.parse
from datetime import datetime, timezone

API_KEY = os.environ.get('BARCHART_API_KEY', '')
BASE    = 'https://ondemand.websol.barchart.com'

# Barchart continuous front-month symbols
SYMBOLS = [
    # Grains
    {'sym': '@C*0',  'key': 'corn',    'label': 'Corn',         'unit': '¢/bu',  'type': 'grain'},
    {'sym': '@S*0',  'key': 'beans',   'label': 'Soybeans',     'unit': '¢/bu',  'type': 'grain'},
    {'sym': '@W*0',  'key': 'wheat',   'label': 'Wheat (CHI)',  'unit': '¢/bu',  'type': 'grain'},
    {'sym': '@SM*0', 'key': 'meal',    'label': 'Soy Meal',     'unit': '$/ton', 'type': 'grain'},
    {'sym': '@BO*0', 'key': 'oil',     'label': 'Soy Oil',      'unit': '¢/lb',  'type': 'grain'},
    # New crop corn/beans
    {'sym': 'ZCZ25', 'key': 'corn_dec','label': "Corn Dec'25",  'unit': '¢/bu',  'type': 'grain'},
    {'sym': 'ZSX25', 'key': 'bean_nov','label': "Beans Nov'25", 'unit': '¢/bu',  'type': 'grain'},
    # Livestock
    {'sym': '@LC*0', 'key': 'cattle',  'label': 'Live Cattle',  'unit': '¢/lb',  'type': 'livestock'},
    {'sym': '@FC*0', 'key': 'feeder',  'label': 'Feeder Cattle','unit': '¢/lb',  'type': 'livestock'},
    {'sym': '@LH*0', 'key': 'hogs',    'label': 'Lean Hogs',    'unit': '¢/lb',  'type': 'livestock'},
    # Energy
    {'sym': '@CL*0', 'key': 'crude',   'label': 'Crude WTI',    'unit': '$/bbl', 'type': 'energy'},
    {'sym': '@NG*0', 'key': 'natgas',  'label': 'Natural Gas',  'unit': '$/MMBtu','type': 'energy'},
    # Metals / Macro
    {'sym': '@GC*0', 'key': 'gold',    'label': 'Gold',         'unit': '$/oz',  'type': 'metal'},
    {'sym': '@SI*0', 'key': 'silver',  'label': 'Silver',       'unit': '$/oz',  'type': 'metal'},
    {'sym': 'DXY',   'key': 'dxy',     'label': 'Dollar Index', 'unit': 'pts',   'type': 'macro'},
    {'sym': '^TNX',  'key': 'tnx',     'label': '10-Yr Treasury','unit': '%',    'type': 'macro'},
]

def fetch_quotes(symbols):
    syms = ','.join(s['sym'] for s in symbols)
    url  = f"{BASE}/getQuote.json?apikey={API_KEY}&symbols={urllib.parse.quote(syms)}&fields=symbol,name,lastPrice,priceChange,percentChange,open,high,low,tradeTime"
    req  = urllib.request.Request(url, headers={'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())

def build_output(raw_results):
    lookup = {r['symbol']: r for r in raw_results}
    out = {}
    for s in SYMBOLS:
        r = lookup.get(s['sym'], {})
        out[s['key']] = {
            'sym':     s['sym'],
            'label':   s['label'],
            'unit':    s['unit'],
            'type':    s['type'],
            'price':   r.get('lastPrice'),
            'change':  r.get('priceChange'),
            'pct':     r.get('percentChange'),
            'open':    r.get('open'),
            'high':    r.get('high'),
            'low':     r.get('low'),
            'time':    r.get('tradeTime'),
        }
    return out

def main():
    if not API_KEY:
        print("ERROR: BARCHART_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    print(f"Fetching {len(SYMBOLS)} symbols from Barchart...")
    try:
        data = fetch_quotes(SYMBOLS)
        results = data.get('results', [])
        print(f"  Got {len(results)} quotes")
    except Exception as e:
        print(f"ERROR fetching quotes: {e}", file=sys.stderr)
        sys.exit(1)

    output = {
        'fetched': datetime.now(timezone.utc).isoformat(),
        'source':  'Barchart OnDemand',
        'quotes':  build_output(results),
    }

    out_path = os.path.join(os.path.dirname(__file__), '../data/prices.json')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(output, f, indent=2)

    print(f"✓ Wrote data/prices.json ({len(results)} quotes, {len(output['quotes'])} mapped)")

if __name__ == '__main__':
    main()
