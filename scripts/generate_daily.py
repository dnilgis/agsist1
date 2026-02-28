#!/usr/bin/env python3
"""
AGSIST generate_daily.py
════════════════════════
Generates data/daily.json every weekday morning via GitHub Actions.

Data sources (all free, no API keys except ANTHROPIC_API_KEY):
  • data/prices.json    — yfinance futures prices (fetched by prices.yml)
  • USDA RSS            — official USDA news + reports
  • AgWeb RSS           — farm news aggregator
  • Farm Progress RSS   — Informa ag news
  • DTN Progressive RSS — commodity/weather news
  • Reuters RSS         — commodity market news
  • feedparser          — parses all RSS feeds
  • Claude API          — writes the actual briefing narrative

Requires secret: ANTHROPIC_API_KEY
"""

import json
import os
import sys
import re
import socket
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

try:
    import urllib.request as urllib_request
    import urllib.error as urllib_error
except ImportError:
    import urllib2 as urllib_request

# ─────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL   = "claude-opus-4-5"   # use latest available
MAX_TOKENS        = 1800

# Free RSS feeds — no keys needed
RSS_FEEDS = [
    {
        "name": "USDA News",
        "url":  "https://www.usda.gov/rss/home.xml",
        "tags": ["usda", "policy", "official"],
    },
    {
        "name": "AgWeb",
        "url":  "https://www.agweb.com/rss/news",
        "tags": ["markets", "ag news"],
    },
    {
        "name": "Farm Progress",
        "url":  "https://www.farmprogress.com/rss.xml",
        "tags": ["production", "weather", "markets"],
    },
    {
        "name": "DTN Progressive Farmer",
        "url":  "https://www.dtnpf.com/agriculture/web/ag/rss",
        "tags": ["prices", "weather", "analysis"],
    },
    {
        "name": "Reuters Commodities",
        "url":  "https://feeds.reuters.com/reuters/businessNews",
        "tags": ["commodities", "global markets"],
    },
]

# Corn Belt weather location (central Illinois — representative)
WX_LAT = 40.6331
WX_LON = -89.3985
WX_CITY = "Central Illinois (Corn Belt)"

# USDA report schedule keywords — used to flag upcoming reports
USDA_REPORT_KEYWORDS = [
    "WASDE", "World Agricultural", "Crop Progress", "Grain Stocks",
    "Prospective Plantings", "Acreage", "Small Grains", "Cattle on Feed",
    "Cold Storage", "Milk Production", "Export Sales",
]

# ─────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────
def http_get(url, timeout=12):
    """Simple HTTP GET, returns text or None."""
    try:
        req = urllib_request.Request(url, headers={
            "User-Agent": "AGSIST/1.0 (agsist.com; agricultural data aggregator)",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        })
        with urllib_request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  HTTP error {url}: {e}")
        return None

def strip_html(text):
    """Remove HTML tags and extra whitespace."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;",  "<", text)
    text = re.sub(r"&gt;",  ">", text)
    text = re.sub(r"&nbsp;"," ", text)
    text = re.sub(r"&#\d+;","",  text)
    text = re.sub(r"\s+",   " ", text)
    return text.strip()

def parse_rss(xml_text, source_name, max_items=5):
    """Parse RSS/Atom XML, return list of {title, summary, source} dicts."""
    if not xml_text:
        return []
    items = []
    try:
        root = ET.fromstring(xml_text)
        ns   = {"atom": "http://www.w3.org/2005/Atom"}

        # RSS 2.0
        for item in root.findall(".//item"):
            title   = strip_html((item.findtext("title") or "").strip())
            summary = strip_html((item.findtext("description") or "").strip())
            if title:
                items.append({"title": title, "summary": summary[:300], "source": source_name})
            if len(items) >= max_items:
                break

        # Atom
        if not items:
            for entry in root.findall(".//atom:entry", ns):
                title   = strip_html((entry.findtext("atom:title", namespaces=ns) or "").strip())
                summary = strip_html((entry.findtext("atom:summary", namespaces=ns) or "").strip())
                if title:
                    items.append({"title": title, "summary": summary[:300], "source": source_name})
                if len(items) >= max_items:
                    break
    except ET.ParseError as e:
        print(f"  XML parse error ({source_name}): {e}")
    return items

# ─────────────────────────────────────────────────────────────────
# STEP 1 — LOAD PRICES FROM data/prices.json
# ─────────────────────────────────────────────────────────────────
def load_prices():
    """Read prices.json — populated by prices.yml workflow (yfinance)."""
    try:
        with open("data/prices.json", "r") as f:
            data = json.load(f)
        q = data.get("quotes", {})
        fetched = data.get("fetched", "unknown")
        print(f"  Prices loaded from prices.json (fetched: {fetched})")
        return q, fetched
    except Exception as e:
        print(f"  WARNING: could not read prices.json: {e}")
        return {}, None

def format_prices_for_prompt(quotes):
    """Turn price dict into readable text for Claude prompt."""
    if not quotes:
        return "Price data unavailable."

    label_map = {
        "corn":       "Corn (front month)",
        "corn-dec":   "Corn Dec '26",
        "beans":      "Soybeans (front month)",
        "beans-nov":  "Soybeans Nov '26",
        "wheat":      "Chicago Wheat",
        "cattle":     "Live Cattle",
        "feeders":    "Feeder Cattle",
        "hogs":       "Lean Hogs",
        "meal":       "Soybean Meal",
        "soyoil":     "Soybean Oil",
        "crude":      "Crude Oil WTI",
        "natgas":     "Natural Gas",
        "gold":       "Gold",
        "dollar":     "Dollar Index",
        "treasury10": "10-Year Treasury",
        "sp500":      "S&P 500",
    }

    lines = []
    for key, label in label_map.items():
        q = quotes.get(key)
        if not q or q.get("close") is None:
            continue
        close  = q["close"]
        net    = q.get("netChange", 0) or 0
        pct    = q.get("pctChange", 0) or 0
        arrow  = "▲" if net > 0 else "▼" if net < 0 else "—"
        suffix = "%" if key == "treasury10" else ""
        lines.append(f"  {label}: {close}{suffix} ({arrow} {abs(pct):.2f}%)")

    return "\n".join(lines) if lines else "Price data unavailable."

# ─────────────────────────────────────────────────────────────────
# STEP 2 — FETCH CORN BELT WEATHER (Open-Meteo, free)
# ─────────────────────────────────────────────────────────────────
def fetch_cornbelt_weather():
    """Fetch today's weather for Central Illinois corn belt via Open-Meteo."""
    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={WX_LAT}&longitude={WX_LON}"
            f"&current=temperature_2m,relative_humidity_2m,precipitation_probability,"
            f"weather_code,wind_speed_10m"
            f"&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
            f"precipitation_sum,weather_code"
            f"&temperature_unit=fahrenheit&wind_speed_unit=mph"
            f"&precipitation_unit=inch&timezone=America%2FChicago&forecast_days=3"
        )
        raw = http_get(url)
        if not raw:
            return None
        d = json.loads(raw)
        cur = d.get("current", {})
        dai = d.get("daily", {})

        wx_codes = {
            0:"Clear",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",
            45:"Foggy",51:"Light drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",
            71:"Light snow",73:"Snow",80:"Showers",95:"Thunderstorm",
        }
        code = cur.get("weather_code", 0)
        desc = wx_codes.get(code, "Variable conditions")

        # 3-day precip totals
        precip_3day = sum((dai.get("precipitation_sum") or [0,0,0])[:3])
        pop_today   = (dai.get("precipitation_probability_max") or [0])[0]
        hi_today    = round((dai.get("temperature_2m_max") or [0])[0])
        lo_today    = round((dai.get("temperature_2m_min") or [0])[0])

        summary = (
            f"{WX_CITY}: {desc}, {round(cur.get('temperature_2m',0))}°F "
            f"(high {hi_today}°, low {lo_today}°), "
            f"wind {round(cur.get('wind_speed_10m',0))} mph, "
            f"humidity {cur.get('relative_humidity_2m',0)}%, "
            f"precip chance {pop_today}%. "
            f"3-day precip total: {precip_3day:.2f} in."
        )
        print(f"  Weather: {summary[:80]}…")
        return summary
    except Exception as e:
        print(f"  Weather fetch failed: {e}")
        return None

# ─────────────────────────────────────────────────────────────────
# STEP 3 — FETCH AG NEWS FROM FREE RSS FEEDS
# ─────────────────────────────────────────────────────────────────
def fetch_all_news():
    """Fetch from all RSS feeds, return combined headline list."""
    all_items = []
    for feed in RSS_FEEDS:
        print(f"  Fetching {feed['name']}…")
        raw = http_get(feed["url"])
        items = parse_rss(raw, feed["name"], max_items=5)
        all_items.extend(items)
        print(f"    → {len(items)} headlines")

    # Deduplicate by title similarity (simple)
    seen = set()
    unique = []
    for item in all_items:
        key = item["title"].lower()[:60]
        if key not in seen:
            seen.add(key)
            unique.append(item)

    print(f"  Total unique headlines: {len(unique)}")
    return unique[:25]  # cap at 25 for prompt size

def format_news_for_prompt(news_items):
    """Format news items as text block for Claude."""
    if not news_items:
        return "No news headlines available."
    lines = []
    for i, item in enumerate(news_items, 1):
        lines.append(f"{i}. [{item['source']}] {item['title']}")
        if item.get("summary"):
            lines.append(f"   {item['summary'][:200]}")
    return "\n".join(lines)

# ─────────────────────────────────────────────────────────────────
# STEP 4 — CHECK FOR UPCOMING USDA REPORTS
# ─────────────────────────────────────────────────────────────────
def get_upcoming_usda_reports(news_items):
    """Scan news for USDA report mentions. Return list of upcoming items."""
    upcoming = []
    for item in news_items:
        text = (item["title"] + " " + item.get("summary", "")).lower()
        for kw in USDA_REPORT_KEYWORDS:
            if kw.lower() in text:
                upcoming.append({"time": "This week", "desc": item["title"]})
                break
    return upcoming[:4]

# ─────────────────────────────────────────────────────────────────
# STEP 5 — CALL CLAUDE API
# ─────────────────────────────────────────────────────────────────
BRIEFING_SYSTEM = """You are the editor of AGSIST Daily, a morning agricultural briefing for
corn, soybean, and grain farmers in the Midwest. Your readers are working farmers, grain
merchandisers, and ag professionals who are pressed for time and need to know exactly what
matters for their operation today.

Write in a direct, confident, plain-English voice — like a sharp farm broadcaster. No fluff,
no hedge words, no "it appears that." Lead with what matters. Use numbers. Be specific.

You will be given: today's futures prices, corn belt weather, and a set of ag news headlines.
Synthesize these into a morning briefing that answers: what moved overnight, what should a
farmer watch today, and what's the key risk or opportunity in the next 48 hours.

NEVER fabricate prices or statistics. Only use what is provided. If data is missing, say so."""

def build_prompt(price_text, weather_text, news_text, today_str):
    return f"""Today is {today_str}. Generate the AGSIST Daily morning briefing from the data below.

═══ FUTURES PRICES (via Yahoo Finance / yfinance) ═══
{price_text}

═══ CORN BELT WEATHER ═══
{weather_text or "Weather data unavailable."}

═══ TODAY'S AG NEWS HEADLINES ═══
{news_text}

═══ OUTPUT FORMAT ═══
Return ONLY valid JSON (no markdown, no backticks, no commentary) matching this exact schema:

{{
  "headline": "Short punchy headline (max 8 words, all caps tone, no quotes)",
  "subheadline": "One-sentence context for the headline (max 20 words)",
  "lead": "Opening paragraph — 2-3 sentences. Most important thing a farmer needs to know today.",
  "date": "{today_str}",
  "teaser": "One sentence to entice a user to read the full briefing (max 18 words)",
  "one_number": {{
    "value": "The single most important number today (price, change, percentage, etc.)",
    "unit": "What that number represents (e.g., 'Corn Dec Futures', 'Soybean Meal', '3-Day Precip')",
    "context": "Why this number matters today (one sentence)"
  }},
  "sections": [
    {{
      "title": "GRAINS & OILSEEDS",
      "body": "2-3 sentences on corn, soybeans, wheat — what moved, why, what to watch."
    }},
    {{
      "title": "WEATHER & FIELD CONDITIONS",
      "body": "2-3 sentences on corn belt weather, planting/harvest implications, spray windows."
    }},
    {{
      "title": "MARKETS & MACRO",
      "body": "2-3 sentences on cattle, energy, dollar, outside markets and their ag implications."
    }}
  ],
  "watch_list": [
    {{"time": "Today", "desc": "Specific item to watch — event, report, price level, weather event"}},
    {{"time": "This Week", "desc": "Longer-horizon item to monitor"}},
    {{"time": "Key Risk", "desc": "The biggest bear risk to grain prices right now"}},
    {{"time": "Key Opportunity", "desc": "The biggest bull opportunity in the next 2 weeks"}}
  ],
  "source": "Yahoo Finance · USDA · Open-Meteo"
}}"""

def call_claude(prompt):
    """Call Anthropic API via urllib (no SDK needed)."""
    if not ANTHROPIC_API_KEY:
        print("  ERROR: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    payload = json.dumps({
        "model":      ANTHROPIC_MODEL,
        "max_tokens": MAX_TOKENS,
        "system":     BRIEFING_SYSTEM,
        "messages":   [{"role": "user", "content": prompt}],
    }).encode("utf-8")

    req = urllib_request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type":      "application/json",
            "x-api-key":         ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "User-Agent":        "AGSIST/1.0",
        },
        method="POST"
    )

    try:
        with urllib_request.urlopen(req, timeout=45) as r:
            resp = json.loads(r.read().decode("utf-8"))
        text = resp["content"][0]["text"].strip()
        print(f"  Claude response: {len(text)} chars, tokens used: {resp.get('usage',{})}")
        return text
    except urllib_error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  Claude API HTTP error {e.code}: {body[:500]}")
        sys.exit(1)
    except Exception as e:
        print(f"  Claude API error: {e}")
        sys.exit(1)

def parse_briefing_json(raw_text):
    """Extract and validate JSON from Claude's response."""
    # Claude should return clean JSON, but strip any accidental markdown
    text = raw_text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$",          "", text, flags=re.MULTILINE)
    text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        # Try to find JSON object in the text
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group())
            except Exception:
                print(f"  JSON parse failed: {e}")
                print(f"  Raw response:\n{text[:500]}")
                sys.exit(1)
        else:
            print(f"  No JSON found in Claude response: {text[:500]}")
            sys.exit(1)

    # Validate required keys
    required = ["headline", "subheadline", "lead", "date", "teaser", "one_number", "sections", "watch_list"]
    for key in required:
        if key not in data:
            print(f"  WARNING: missing key '{key}' in briefing JSON")

    return data

# ─────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────
def main():
    today = datetime.now(timezone.utc)
    today_str = today.strftime("%A, %B %-d, %Y")
    print(f"\nAGSIST generate_daily.py — {today.strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"Date: {today_str}")
    print("=" * 60)

    # 1. Load prices
    print("\n[1] Loading prices from data/prices.json…")
    quotes, fetched = load_prices()
    price_text = format_prices_for_prompt(quotes)
    print(price_text[:200] + "…")

    # 2. Fetch corn belt weather
    print("\n[2] Fetching Corn Belt weather (Open-Meteo)…")
    weather_text = fetch_cornbelt_weather()

    # 3. Fetch ag news
    print("\n[3] Fetching ag news from RSS feeds…")
    news_items = fetch_all_news()
    news_text = format_news_for_prompt(news_items)

    # 4. Check for USDA reports in news
    upcoming = get_upcoming_usda_reports(news_items)

    # 5. Build prompt and call Claude
    print("\n[4] Calling Claude to generate briefing…")
    prompt = build_prompt(price_text, weather_text, news_text, today_str)
    raw_response = call_claude(prompt)

    # 6. Parse response
    print("\n[5] Parsing briefing JSON…")
    briefing = parse_briefing_json(raw_response)

    # 7. Inject upcoming USDA reports into watch_list if found
    if upcoming:
        existing_wl = briefing.get("watch_list", [])
        for report in upcoming[:2]:
            existing_wl.append(report)
        briefing["watch_list"] = existing_wl[:6]

    # 8. Add metadata
    briefing["generated_utc"] = today.strftime("%Y-%m-%dT%H:%M:%SZ")
    briefing["prices_fetched"] = fetched or "unknown"
    briefing["news_sources"]   = [f["name"] for f in RSS_FEEDS]

    # 9. Write output
    os.makedirs("data", exist_ok=True)
    with open("data/daily.json", "w") as f:
        json.dump(briefing, f, indent=2)

    print(f"\n✓ data/daily.json written")
    print(f"  Headline:    {briefing.get('headline','')}")
    print(f"  One Number:  {briefing.get('one_number',{}).get('value','')} — {briefing.get('one_number',{}).get('unit','')}")
    print(f"  Sections:    {len(briefing.get('sections',[]))}")
    print(f"  Watch items: {len(briefing.get('watch_list',[]))}")
    print("\nDone.")

if __name__ == "__main__":
    main()
