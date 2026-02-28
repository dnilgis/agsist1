#!/usr/bin/env python3
"""
AGSIST Daily Briefing Generator
────────────────────────────────
Runs every weekday morning via GitHub Actions (.github/workflows/daily.yml).
1. Fetches closing/overnight prices from Barchart API
2. Sends structured market data to Claude API
3. Writes JSON to data/daily.json
4. GitHub Actions commits the file → site auto-updates

Required environment variables (GitHub Secrets):
  BARCHART_API_KEY   — Barchart OnDemand API key
  ANTHROPIC_API_KEY  — Claude API key

Usage:
  python scripts/generate_daily.py

Output:
  data/daily.json
"""

import os
import json
import sys
import http.client
import urllib.parse
import datetime
from zoneinfo import ZoneInfo  # Python 3.9+

# ── Config ────────────────────────────────────────────────────────
BARCHART_KEY  = os.environ.get('BARCHART_API_KEY', '')
ANTHROPIC_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
OUTPUT_FILE   = os.path.join(os.path.dirname(__file__), '..', 'data', 'daily.json')

# Barchart symbol list for morning briefing
BARCHART_SYMBOLS = [
    '@C*0',   # Corn front month
    'ZCZ26',  # Corn Dec 26
    '@S*0',   # Beans front month
    'ZSX26',  # Beans Nov 26
    '@W*0',   # Wheat front month
    '@LC*0',  # Live Cattle
    '@LH*0',  # Lean Hogs
    '@CL*0',  # Crude WTI
    '@NG*0',  # Natural Gas
]

SYMBOL_LABELS = {
    '@C*0':  'Corn (front)',
    'ZCZ26': "Corn Dec '26",
    '@S*0':  'Soybeans (front)',
    'ZSX26': "Soybeans Nov '26",
    '@W*0':  'Wheat (front)',
    '@LC*0': 'Live Cattle',
    '@LH*0': 'Lean Hogs',
    '@CL*0': 'Crude Oil WTI',
    '@NG*0': 'Natural Gas',
}

CLAUDE_MODEL = 'claude-sonnet-4-20250514'


# ── Barchart fetch ────────────────────────────────────────────────
def fetch_quotes():
    """Fetch futures quotes from Barchart getQuote endpoint."""
    symbols = ','.join(BARCHART_SYMBOLS)
    fields  = 'symbol,name,lastPrice,openPrice,previousClose,netChange,percentChange,tradeTime,low52Week,high52Week'
    params  = urllib.parse.urlencode({
        'apikey':  BARCHART_KEY,
        'symbols': symbols,
        'fields':  fields,
    })
    conn = http.client.HTTPSConnection('ondemand.websol.barchart.com')
    conn.request('GET', f'/getQuote.json?{params}', headers={'User-Agent': 'AGSIST/1.0'})
    resp = conn.getresponse()
    body = resp.read().decode()
    conn.close()

    if resp.status != 200:
        raise RuntimeError(f'Barchart API returned {resp.status}: {body[:200]}')

    data = json.loads(body)
    if data.get('status', {}).get('code') != 200:
        raise RuntimeError(f'Barchart error: {data}')

    results = {}
    for r in data.get('results', []):
        sym = r.get('symbol')
        if sym:
            results[sym] = r
    return results


def format_grain_price(price):
    """Format grain price in dollars with fraction notation (4¼, 9½, etc.)"""
    if price is None:
        return '--'
    whole = int(price)
    frac  = round((price - whole) * 4) / 4
    fracs = {0: '', 0.25: '¼', 0.5: '½', 0.75: '¾'}
    return f"${whole}{fracs.get(frac, '')}"


def format_change(net_chg, pct_chg, is_grain=False):
    """Format change string for the briefing."""
    if net_chg is None:
        return 'unchanged'
    direction = 'up' if net_chg > 0 else 'down'
    if is_grain:
        cents = abs(net_chg) * 100
        return f"{direction} {cents:.1f}¢ ({abs(pct_chg):.2f}%)"
    return f"{direction} {abs(net_chg):.3f} ({abs(pct_chg):.2f}%)"


def build_market_summary(quotes):
    """Build a structured text summary of market conditions for the AI prompt."""
    lines = []
    grain_syms = {'@C*0', 'ZCZ26', '@S*0', 'ZSX26', '@W*0'}

    for sym in BARCHART_SYMBOLS:
        q = quotes.get(sym)
        if not q:
            continue
        label    = SYMBOL_LABELS.get(sym, sym)
        price    = q.get('lastPrice')
        net_chg  = q.get('netChange')
        pct_chg  = q.get('percentChange')
        is_grain = sym in grain_syms

        if is_grain:
            price_str = format_grain_price(price)
        else:
            price_str = f"${price:.2f}" if price else '--'

        chg_str = format_change(net_chg, pct_chg, is_grain)
        lines.append(f"  {label}: {price_str} ({chg_str})")

    return '\n'.join(lines)


# ── Claude API call ───────────────────────────────────────────────
def call_claude(prompt, system_prompt):
    """Call Claude API and return the text response."""
    payload = json.dumps({
        'model':      CLAUDE_MODEL,
        'max_tokens': 1200,
        'system':     system_prompt,
        'messages':   [{'role': 'user', 'content': prompt}],
    }).encode()

    conn = http.client.HTTPSConnection('api.anthropic.com')
    conn.request(
        'POST',
        '/v1/messages',
        body=payload,
        headers={
            'Content-Type':      'application/json',
            'x-api-key':         ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
        }
    )
    resp = conn.getresponse()
    body = resp.read().decode()
    conn.close()

    if resp.status != 200:
        raise RuntimeError(f'Claude API returned {resp.status}: {body[:500]}')

    data = json.loads(body)
    for block in data.get('content', []):
        if block.get('type') == 'text':
            return block['text']
    raise RuntimeError('No text in Claude response')


def generate_briefing(quotes):
    """Use Claude to write the daily briefing from market data."""
    ct_now        = datetime.datetime.now(ZoneInfo('America/Chicago'))
    date_str      = ct_now.strftime('%A, %B %-d, %Y')
    market_summary = build_market_summary(quotes)

    system_prompt = """You are the AGSIST Daily Market Briefing writer — a concise, authoritative morning newsletter for corn, soybean, and grain farmers in the Midwest.

Your tone: Direct. Like a trusted agronomist who also reads the markets. Never alarmist, never vague. Ground every statement in the actual price data provided.

Rules:
- Never invent prices, USDA dates, or events not in the data provided
- Keep the headline under 12 words, ALL CAPS
- Keep subheadline under 20 words, title case
- Keep lead paragraph to 2 sentences maximum
- Each section body is 2-3 sentences
- The one_number must be a specific data point directly from the prices provided
- Watch list items are USDA reports or market events that actually occur on a regular schedule
- Output ONLY valid JSON matching the schema exactly — no markdown, no preamble"""

    prompt = f"""Today is {date_str}.

Here are this morning's futures prices:
{market_summary}

Write the AGSIST Daily Briefing as a JSON object matching this exact schema:

{{
  "date": "string — e.g. 'Friday, February 28, 2025'",
  "headline": "string — 12 words max, ALL CAPS, captures the most important market theme",
  "subheadline": "string — 20 words max, title case, elaborates on the headline",
  "lead": "string — 2 sentences summarizing the day's market story for a grain farmer",
  "teaser": "string — 1 sentence preview for users who haven't expanded the briefing",
  "one_number": {{
    "value": "string — e.g. '9½' or '$4.82'",
    "unit": "string — e.g. 'Dec corn' or 'front-month beans'",
    "context": "string — one sentence explaining why this number matters today"
  }},
  "sections": [
    {{
      "title": "string — section heading, e.g. 'Grain Markets'",
      "body":  "string — 2-3 sentences with specific price context"
    }},
    {{
      "title": "string — section heading, e.g. 'Livestock & Energy'",
      "body":  "string — 2-3 sentences with specific price context"
    }},
    {{
      "title": "string — section heading, e.g. 'What to Watch'",
      "body":  "string — forward-looking, practical for a farmer making decisions today"
    }}
  ],
  "watch_list": [
    {{"time": "string — e.g. '7:30am CT'", "desc": "string — event name"}},
    {{"time": "string", "desc": "string"}},
    {{"time": "string", "desc": "string"}}
  ]
}}

Output only the JSON object. No markdown fences."""

    raw = call_claude(prompt, system_prompt)

    # Strip any accidental markdown fences
    raw = raw.strip()
    if raw.startswith('```'):
        raw = raw.split('\n', 1)[1]
        raw = raw.rsplit('```', 1)[0]

    briefing = json.loads(raw)

    # Add metadata
    ct_now = datetime.datetime.now(ZoneInfo('America/Chicago'))
    briefing['generated_at'] = ct_now.isoformat()
    briefing['model']        = CLAUDE_MODEL

    # Embed prices snapshot for reference
    snapshot = {}
    for sym in BARCHART_SYMBOLS:
        q = quotes.get(sym)
        if q:
            snapshot[SYMBOL_LABELS.get(sym, sym)] = {
                'price': q.get('lastPrice'),
                'change': q.get('netChange'),
                'pct': q.get('percentChange'),
            }
    briefing['prices_snapshot'] = snapshot

    return briefing


# ── Main ──────────────────────────────────────────────────────────
def main():
    if not BARCHART_KEY:
        print('ERROR: BARCHART_API_KEY not set', file=sys.stderr)
        sys.exit(1)
    if not ANTHROPIC_KEY:
        print('ERROR: ANTHROPIC_API_KEY not set', file=sys.stderr)
        sys.exit(1)

    print('Fetching Barchart quotes...')
    try:
        quotes = fetch_quotes()
        print(f'  Got {len(quotes)} quotes')
    except Exception as e:
        print(f'ERROR fetching quotes: {e}', file=sys.stderr)
        sys.exit(1)

    print('Generating briefing with Claude...')
    try:
        briefing = generate_briefing(quotes)
    except Exception as e:
        print(f'ERROR generating briefing: {e}', file=sys.stderr)
        sys.exit(1)

    # Write output
    out_path = os.path.abspath(OUTPUT_FILE)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(briefing, f, indent=2)

    print(f'Written: {out_path}')
    print(f'Headline: {briefing.get("headline", "(none)")}')


if __name__ == '__main__':
    main()
