#!/usr/bin/env python3
"""
AGSIST fetch_markets.py
═══════════════════════
Fetches agricultural prediction market odds from Kalshi and Polymarket.
Runs server-side in GitHub Actions (no CORS issues).
Writes data/markets.json for the browser to read.

Sources:
  • Kalshi   — https://trading.kalshi.com/trade-api/v2/markets (public, no key)
  • Polymarket — https://gamma-api.polymarket.com/markets (public, no key)

No API keys required.
"""

import json
import re
import os
from datetime import datetime, timezone
try:
    import urllib.request as urllib_request
    import urllib.error as urllib_error
except ImportError:
    import urllib2 as urllib_request

# ─────────────────────────────────────────────────────────────────
# AG KEYWORDS — used to filter both platforms
# ─────────────────────────────────────────────────────────────────
AG_KEYWORDS = [
    "corn", "soybean", "wheat", "grain", "crop", "usda", "wasde",
    "drought", "farm", "cattle", "hog", "livestock", "ethanol",
    "harvest", "planting", "acreage", "export", "fertilizer", "urea",
    "canola", "sorghum", "cotton", "rice", "pork", "beef",
]

def http_get_json(url, timeout=15):
    try:
        req = urllib_request.Request(url, headers={
            "User-Agent": "AGSIST/1.0 (agsist.com; agricultural data aggregator)",
            "Accept": "application/json",
        })
        with urllib_request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"  HTTP error {url[:60]}: {e}")
        return None

def is_ag_related(text):
    t = text.lower()
    return any(kw in t for kw in AG_KEYWORDS)

def time_remaining(close_str):
    if not close_str:
        return ""
    try:
        close = datetime.fromisoformat(close_str.replace("Z", "+00:00"))
        now   = datetime.now(timezone.utc)
        diff  = close - now
        days  = diff.days
        if days < 0:      return "Closed"
        if days == 0:     return "Closes today"
        if days == 1:     return "Closes tomorrow"
        if days <= 30:    return f"Closes in {days}d"
        months = days // 30
        return f"Closes in ~{months}mo"
    except Exception:
        return ""

# ─────────────────────────────────────────────────────────────────
# KALSHI
# ─────────────────────────────────────────────────────────────────
def fetch_kalshi():
    print("\n[Kalshi] Fetching ag prediction markets…")
    markets = []
    seen    = set()

    for kw in ["corn", "soybean", "wheat", "usda", "drought", "crop", "cattle", "grain"]:
        url  = f"https://trading.kalshi.com/trade-api/v2/markets?limit=10&status=open&keyword={kw}"
        data = http_get_json(url)
        if not data:
            continue
        items = data.get("markets", [])
        print(f"  {kw}: {len(items)} results")

        for m in items:
            ticker = m.get("ticker", "")
            if not ticker or ticker in seen:
                continue
            title = m.get("title") or m.get("subtitle") or ticker
            if not is_ag_related(title + " " + ticker):
                continue

            yes_bid = m.get("yes_bid")
            yes_ask = m.get("yes_ask")
            no_bid  = m.get("no_bid")
            if yes_bid is None and yes_ask is None:
                continue

            mid = round((yes_bid + yes_ask) / 2) if (yes_bid and yes_ask) else (yes_bid or yes_ask or 50)
            seen.add(ticker)
            markets.append({
                "platform":    "Kalshi",
                "ticker":      ticker,
                "title":       title,
                "yes":         mid,
                "no":          no_bid,
                "volume_24h":  m.get("volume_24h", 0),
                "close_time":  m.get("close_time", ""),
                "time_left":   time_remaining(m.get("close_time", "")),
                "url":         f"https://kalshi.com/markets/{ticker}",
            })

    markets.sort(key=lambda x: x.get("volume_24h", 0), reverse=True)
    print(f"  → {len(markets)} Kalshi ag markets found")
    return markets[:10]

# ─────────────────────────────────────────────────────────────────
# POLYMARKET
# ─────────────────────────────────────────────────────────────────
def fetch_polymarket():
    print("\n[Polymarket] Fetching ag prediction markets…")
    markets = []
    seen    = set()

    # Polymarket gamma API — search by keyword
    for kw in ["corn", "soybean", "wheat", "usda", "drought", "cattle", "crop", "grain", "farm"]:
        url  = f"https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10&keyword={kw}"
        data = http_get_json(url)
        if not data:
            # Try alternate endpoint
            url2 = f"https://clob.polymarket.com/markets?next_cursor=&keyword={kw}"
            data = http_get_json(url2)
        if not data:
            continue

        # Polymarket returns list directly or wrapped
        items = data if isinstance(data, list) else data.get("results", data.get("markets", []))
        print(f"  {kw}: {len(items)} results")

        for m in items:
            mid_id = m.get("id") or m.get("condition_id") or m.get("marketMakerAddress")
            if not mid_id or mid_id in seen:
                continue
            question = m.get("question") or m.get("title") or m.get("description", "")
            if not question or not is_ag_related(question):
                continue

            # Get probability — Polymarket stores as 0-1 float
            outcomes = m.get("outcomePrices") or m.get("tokens") or []
            prob = None
            if isinstance(outcomes, list) and outcomes:
                try:
                    # outcomePrices is ["0.72", "0.28"] format
                    if isinstance(outcomes[0], str):
                        prob = round(float(outcomes[0]) * 100)
                    elif isinstance(outcomes[0], dict):
                        prob = round(float(outcomes[0].get("price", 0.5)) * 100)
                except Exception:
                    pass
            if prob is None:
                best = m.get("bestBid") or m.get("lastTradePrice")
                prob = round(float(best) * 100) if best else 50

            volume = m.get("volume") or m.get("volumeNum") or 0
            try:
                volume = float(volume)
            except Exception:
                volume = 0

            end_date = m.get("endDate") or m.get("end_date_iso") or ""
            seen.add(mid_id)
            markets.append({
                "platform":   "Polymarket",
                "ticker":     str(mid_id)[:20],
                "title":      question[:120],
                "yes":        prob,
                "no":         100 - prob,
                "volume_24h": volume,
                "close_time": end_date,
                "time_left":  time_remaining(end_date),
                "url":        m.get("url") or f"https://polymarket.com/event/{mid_id}",
            })

    markets.sort(key=lambda x: x.get("volume_24h", 0), reverse=True)
    print(f"  → {len(markets)} Polymarket ag markets found")
    return markets[:10]

# ─────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────
def main():
    now = datetime.now(timezone.utc)
    print(f"\nAGSIST fetch_markets.py — {now.strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    kalshi     = fetch_kalshi()
    polymarket = fetch_polymarket()

    # Merge and sort by volume
    combined = kalshi + polymarket
    combined.sort(key=lambda x: x.get("volume_24h", 0), reverse=True)

    output = {
        "fetched":    now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count":      len(combined),
        "markets":    combined,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/markets.json", "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n✓ data/markets.json written — {len(combined)} total markets")
    print(f"  Kalshi: {len(kalshi)}, Polymarket: {len(polymarket)}")
    for m in combined[:5]:
        print(f"  [{m['platform']:10s}] {m['yes']:3d}% — {m['title'][:60]}")

if __name__ == "__main__":
    main()
