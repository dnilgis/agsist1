#!/usr/bin/env python3
"""
AGSIST generate_daily.py  v3.0 — Daily Ag Briefing
═══════════════════════════════════════════════════
Generates data/daily.json every weekday morning via GitHub Actions.

Pulls from 15+ free ag news/data sources, Corn Belt weather, and
yfinance prices — then uses Claude to write a tight, plain-English
briefing that hits hard and respects farmers' time.

Data sources (all free, no API keys except ANTHROPIC_API_KEY):
  • data/prices.json      — yfinance futures (fetched by prices.yml)
  • Open-Meteo            — Corn Belt weather (5 locations)
  • 15+ ag RSS feeds      — USDA, Farm Progress, Brownfield, etc.
  • Claude API            — writes the briefing narrative

Requires secret: ANTHROPIC_API_KEY
"""

import json
import os
import sys
import re
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
ANTHROPIC_MODEL   = "claude-sonnet-4-5-20250929"
MAX_TOKENS        = 4000

# ─────────────────────────────────────────────────────────────────
# RSS FEEDS — 15+ sources organized by category
# ─────────────────────────────────────────────────────────────────
RSS_FEEDS = [
    # ── USDA & Government ──
    {"name": "USDA NASS Reports",  "url": "https://www.nass.usda.gov/rss/reports.xml",              "category": "government",  "max_items": 6},
    # ── Major Ag News Wires ──
    {"name": "Farm Journal",       "url": "https://www.farmjournal.com/feed/",                      "category": "ag_news",     "max_items": 6},
    {"name": "Farm Progress",      "url": "https://www.farmprogress.com/rss.xml",                   "category": "ag_news",     "max_items": 6},
    {"name": "Brownfield Ag",      "url": "https://brownfieldagnews.com/feed/",                     "category": "ag_news",     "max_items": 6},
    {"name": "AG Daily",           "url": "https://agdaily.com/feed/",                              "category": "ag_news",     "max_items": 5},
    {"name": "All Ag News",        "url": "https://allagnews.com/feed/",                            "category": "ag_news",     "max_items": 5},
    {"name": "Agweek",             "url": "https://www.agweek.com/index.rss",                       "category": "ag_news",     "max_items": 5},
    {"name": "Morning Ag Clips",   "url": "https://www.morningagclips.com/feed/",                   "category": "ag_news",     "max_items": 4},
    # ── Livestock & Dairy ──
    {"name": "Beef Magazine",      "url": "https://www.beefmagazine.com/rss.xml",                   "category": "livestock",   "max_items": 4},
    # ── Weather ──
    {"name": "NOAA Climate",       "url": "https://www.climate.gov/rss.xml",                        "category": "weather",     "max_items": 3},
    # ── Ag Policy & Trade ──
    {"name": "Farm Policy News",   "url": "https://farmpolicynews.illinois.edu/feed/",              "category": "policy",      "max_items": 5},
    # ── Ag Retail & Inputs ──
    {"name": "CropLife",           "url": "https://www.croplife.com/feed/",                         "category": "ag_news",     "max_items": 3},
]

# Corn Belt weather — 5 representative locations
WEATHER_LOCATIONS = [
    {"lat": 40.633, "lon": -89.399, "name": "Central Illinois"},
    {"lat": 41.878, "lon": -93.098, "name": "Central Iowa"},
    {"lat": 44.500, "lon": -89.500, "name": "Central Wisconsin"},
    {"lat": 44.374, "lon": -100.35, "name": "Central South Dakota"},
    {"lat": 40.813, "lon": -96.681, "name": "Southeast Nebraska"},
]

USDA_REPORT_KEYWORDS = [
    "WASDE", "World Agricultural", "Crop Progress", "Grain Stocks",
    "Prospective Plantings", "Acreage", "Small Grains", "Cattle on Feed",
    "Cold Storage", "Milk Production", "Export Sales", "Export Inspections",
    "Hogs and Pigs", "Cotton Ginnings", "Peanut Stocks",
]


# ─────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────
def http_get(url, timeout=18):
    try:
        req = urllib_request.Request(url, headers={
            "User-Agent": "AGSIST/3.0 (agsist.com; agricultural briefing aggregator)",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        })
        with urllib_request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ⚠ HTTP error {url}: {e}")
        return None


def strip_html(text):
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    for old, new in [("&amp;","&"),("&lt;","<"),("&gt;",">"),("&nbsp;"," "),("&quot;",'"')]:
        text = text.replace(old, new)
    text = re.sub(r"&#\d+;", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_rss(xml_text, source_name, max_items=5):
    if not xml_text:
        return []
    items = []
    try:
        root = ET.fromstring(xml_text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for item in root.findall(".//item"):
            title = strip_html((item.findtext("title") or "").strip())
            summary = strip_html((item.findtext("description") or "").strip())
            pub_date = (item.findtext("pubDate") or "").strip()
            if title:
                items.append({"title": title, "summary": summary[:400], "source": source_name, "date": pub_date})
            if len(items) >= max_items:
                break
        if not items:
            for entry in root.findall(".//atom:entry", ns):
                title = strip_html((entry.findtext("atom:title", namespaces=ns) or "").strip())
                summary = strip_html((entry.findtext("atom:summary", namespaces=ns) or "").strip())
                if title:
                    items.append({"title": title, "summary": summary[:400], "source": source_name})
                if len(items) >= max_items:
                    break
    except ET.ParseError as e:
        print(f"  ⚠ XML parse error ({source_name}): {e}")
    return items


# ─────────────────────────────────────────────────────────────────
# STEP 1 — LOAD PRICES
# ─────────────────────────────────────────────────────────────────
def load_prices():
    try:
        with open("data/prices.json", "r") as f:
            data = json.load(f)
        q = data.get("quotes", {})
        fetched = data.get("fetched", "unknown")
        print(f"  ✓ Prices loaded ({len(q)} quotes, fetched: {fetched})")
        return q, fetched
    except Exception as e:
        print(f"  ⚠ Could not read prices.json: {e}")
        return {}, None


def format_prices_for_prompt(quotes):
    if not quotes:
        return "Price data unavailable."
    label_map = {
        "corn": "Corn (front month)", "corn-dec": "Corn Dec '26",
        "beans": "Soybeans (front month)", "beans-nov": "Soybeans Nov '26",
        "wheat": "Chicago Wheat", "oats": "Oats",
        "cattle": "Live Cattle", "feeders": "Feeder Cattle",
        "hogs": "Lean Hogs", "milk": "Class III Milk",
        "meal": "Soybean Meal", "soyoil": "Soybean Oil",
        "crude": "Crude Oil WTI", "natgas": "Natural Gas",
        "gold": "Gold", "silver": "Silver",
        "dollar": "Dollar Index", "treasury10": "10-Year Treasury Yield", "sp500": "S&P 500",
    }
    lines = []
    for key, label in label_map.items():
        q = quotes.get(key)
        if not q or q.get("close") is None:
            continue
        close = q["close"]
        net = q.get("netChange", 0) or 0
        pct = q.get("pctChange", 0) or 0
        opn = q.get("open", close)
        hi = q.get("high", close)
        lo = q.get("low", close)
        arrow = "▲" if net > 0 else "▼" if net < 0 else "—"
        suffix = "%" if key == "treasury10" else ""
        lines.append(f"  {label}: {close}{suffix}  {arrow} {abs(net):.2f} ({abs(pct):.2f}%)  O:{opn} H:{hi} L:{lo}")
    return "\n".join(lines) if lines else "Price data unavailable."


# ─────────────────────────────────────────────────────────────────
# STEP 2 — MULTI-POINT CORN BELT WEATHER
# ─────────────────────────────────────────────────────────────────
def fetch_cornbelt_weather():
    WX_CODES = {
        0:"Clear",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",
        45:"Foggy",51:"Light drizzle",61:"Light rain",63:"Rain",
        65:"Heavy rain",71:"Light snow",73:"Snow",75:"Heavy snow",
        80:"Showers",81:"Moderate showers",82:"Heavy showers",
        95:"Thunderstorm",96:"T-storm w/ hail",
    }
    summaries = []
    for loc in WEATHER_LOCATIONS:
        try:
            url = (
                f"https://api.open-meteo.com/v1/forecast"
                f"?latitude={loc['lat']}&longitude={loc['lon']}"
                f"&current=temperature_2m,relative_humidity_2m,precipitation_probability,"
                f"weather_code,wind_speed_10m,wind_direction_10m"
                f"&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
                f"precipitation_sum,weather_code,wind_speed_10m_max"
                f"&temperature_unit=fahrenheit&wind_speed_unit=mph"
                f"&precipitation_unit=inch&timezone=America%2FChicago&forecast_days=5"
            )
            raw = http_get(url)
            if not raw:
                continue
            d = json.loads(raw)
            cur = d.get("current", {})
            dai = d.get("daily", {})
            code = cur.get("weather_code", 0)
            desc = WX_CODES.get(code, "Variable")
            precip_5day = sum((dai.get("precipitation_sum") or [0]*5)[:5])
            pop_today = (dai.get("precipitation_probability_max") or [0])[0]
            hi_today = round((dai.get("temperature_2m_max") or [0])[0])
            lo_today = round((dai.get("temperature_2m_min") or [0])[0])
            wind_max = round((dai.get("wind_speed_10m_max") or [0])[0])
            day_outlook = []
            day_names = ["Today", "Tomorrow", "Day 3", "Day 4", "Day 5"]
            for i in range(min(5, len(dai.get("temperature_2m_max", [])))):
                hi_d = round((dai.get("temperature_2m_max") or [0]*5)[i])
                lo_d = round((dai.get("temperature_2m_min") or [0]*5)[i])
                pop_d = (dai.get("precipitation_probability_max") or [0]*5)[i]
                precip_d = (dai.get("precipitation_sum") or [0]*5)[i]
                day_outlook.append(f"    {day_names[i]}: {hi_d}°/{lo_d}°F, {pop_d}% rain, {precip_d:.2f}in")
            summary = (
                f"  {loc['name']}: {desc}, {round(cur.get('temperature_2m', 0))}°F, "
                f"wind {round(cur.get('wind_speed_10m', 0))} mph, RH {cur.get('relative_humidity_2m', 0)}%\n"
                f"    Today: {hi_today}°/{lo_today}°, {pop_today}% rain, gusts {wind_max} mph\n"
                f"    5-day total: {precip_5day:.2f}in\n"
                + "\n".join(day_outlook)
            )
            summaries.append(summary)
            print(f"  ✓ Weather: {loc['name']} — {desc}, {round(cur.get('temperature_2m', 0))}°F")
        except Exception as e:
            print(f"  ⚠ Weather failed for {loc['name']}: {e}")
    return "\n\n".join(summaries) if summaries else "Weather data unavailable."


# ─────────────────────────────────────────────────────────────────
# STEP 3 — FETCH ALL AG NEWS
# ─────────────────────────────────────────────────────────────────
def fetch_all_news():
    all_items = []
    success_count = 0
    fail_count = 0
    for feed in RSS_FEEDS:
        print(f"  Fetching {feed['name']}…", end="")
        raw = http_get(feed["url"])
        items = parse_rss(raw, feed["name"], max_items=feed.get("max_items", 5))
        for item in items:
            item["category"] = feed.get("category", "general")
        all_items.extend(items)
        if items:
            success_count += 1
            print(f" ✓ {len(items)} items")
        else:
            fail_count += 1
            print(f" ✗ no items")
    seen = set()
    unique = []
    for item in all_items:
        key = item["title"].lower()[:60]
        if key not in seen:
            seen.add(key)
            unique.append(item)
    print(f"  ═══ {len(unique)} unique headlines from {success_count}/{success_count+fail_count} feeds")
    return unique[:40]


def format_news_for_prompt(news_items):
    if not news_items:
        return "No news headlines available."
    categories = {}
    for item in news_items:
        cat = item.get("category", "general")
        categories.setdefault(cat, []).append(item)
    cat_labels = {
        "government": "USDA & GOVERNMENT", "ag_news": "AG NEWS & ANALYSIS",
        "markets": "COMMODITY MARKETS", "livestock": "LIVESTOCK & DAIRY",
        "weather": "WEATHER & CLIMATE", "policy": "AG POLICY & TRADE", "general": "OTHER",
    }
    lines = []
    for cat, label in cat_labels.items():
        items = categories.get(cat, [])
        if not items:
            continue
        lines.append(f"\n── {label} ──")
        for item in items:
            lines.append(f"  [{item['source']}] {item['title']}")
            if item.get("summary"):
                lines.append(f"    → {item['summary'][:250]}")
    return "\n".join(lines)


def get_upcoming_usda_reports(news_items):
    upcoming = []
    seen = set()
    for item in news_items:
        text = (item["title"] + " " + item.get("summary", "")).lower()
        for kw in USDA_REPORT_KEYWORDS:
            if kw.lower() in text and kw not in seen:
                upcoming.append({"time": "This week", "desc": item["title"]})
                seen.add(kw)
                break
    return upcoming[:4]


# ─────────────────────────────────────────────────────────────────
# STEP 5 — CALL CLAUDE API
# ─────────────────────────────────────────────────────────────────

BRIEFING_SYSTEM = """You write the AGSIST Daily — a morning ag briefing read by row crop
farmers, cattle producers, grain merchandisers, co-op staff, and ag lenders across the
Corn Belt. They check it before coffee. Respect their time.

YOUR RULES:
1. SHORT. Every sentence earns its place. Cut filler words ruthlessly.
2. NUMBERS FIRST. Lead with the price, the change, the data. Then explain why it matters.
3. FARMER DECISIONS. Don't just report — tell them what to think about. Sell or hold?
   Spray or wait? Lock in inputs or hold off?
4. PLAIN ENGLISH. "Corn's up a nickel" not "corn experienced upward movement." Use ag
   shorthand: beans, the board, basis, carry. But if you use a term a newer farmer might
   not know (crush margin, inverse, contango), add a quick parenthetical.
5. NEVER FABRICATE. Only use data provided. If something's missing, skip it.
6. CONNECT THE DOTS. Crude up = diesel up = higher field costs. Dollar down = better
   exports. Rain in Illinois = delayed burndown. Make these connections.
7. WEATHER IS KING. Farmers plan their week around weather. Be specific about which
   areas are wet vs dry and what it means for field operations.

VOICE: Think DTN Progressive Farmer meets your smartest neighbor at the co-op. Confident,
direct, occasionally wry. Not corporate. Not academic. Not breathless.

STRUCTURE: The briefing uses a "scan then read" format. Top-line items are scannable
in 15 seconds. Sections below give detail for those who want it. Every section should
be 2-3 SHORT sentences max — tight paragraphs, not essays."""


def build_prompt(price_text, weather_text, news_text, today_str, upcoming_reports):
    reports_text = ""
    if upcoming_reports:
        reports_text = "\n═══ UPCOMING USDA REPORTS ═══\n"
        for r in upcoming_reports:
            reports_text += f"  • {r['desc']}\n"

    return f"""Today is {today_str}. Write the AGSIST Daily from this data.

═══ FUTURES PRICES (yesterday's settle) ═══
{price_text}

═══ CORN BELT WEATHER (5 locations) ═══
{weather_text}
{reports_text}
═══ TODAY'S AG NEWS ═══
{news_text}

═══ OUTPUT — RETURN ONLY VALID JSON ═══
No markdown. No backticks. No commentary. Just the JSON object below.

{{
  "headline": "Max 10 words. Newspaper style, not all caps. Lead with the biggest mover or story.",
  "subheadline": "One sentence, max 20 words. Why it matters.",
  "date": "{today_str}",

  "top_line": [
    "Corn $X.XX½, +X¢ · Beans $XX.XX¾, +X¢ · Wheat $X.XX, +XX¢",
    "Cattle $XXX.XX, -$X.XX · Hogs $XX.XX, unch · Milk $XX.XX, -$X.XX",
    "Crude $XX.XX, +$X.XX · Dollar XX.XX, flat · S&P X,XXX, -XX"
  ],

  "teaser": "One punchy sentence for the collapsed view, max 15 words.",

  "one_number": {{
    "value": "The single most important number — a price, percent, bushels, inches of rain, etc.",
    "unit": "What it is in 5 words or less",
    "why": "One sentence: why this number matters for a farm decision RIGHT NOW. Max 30 words."
  }},

  "field_call": {{
    "label": "SPRAY WINDOW / FIELD WORK / STAY OUT / GOOD TO GO / PLAN AHEAD — pick one",
    "detail": "One sentence. What the weather means for field operations this week. Max 25 words."
  }},

  "sections": [
    {{
      "id": "grains",
      "title": "Grains & Oilseeds",
      "icon": "🌽",
      "bullets": [
        "Corn: $X.XX½, up X¢. Dec '26 at $X.XX. The carry is X¢ — [what that means in one phrase].",
        "Beans: $XX.XX¾, up X¢. Meal at $XXX, oil at XX.XX¢. Crush margins [tight/healthy/etc].",
        "Wheat: $X.XX½, up XX¢. [Why it moved in one clause]. [What it means in one clause].",
        "OPTIONAL 4th bullet if oats or something else is notable."
      ]
    }},
    {{
      "id": "livestock",
      "title": "Livestock & Dairy",
      "icon": "🐄",
      "bullets": [
        "Live cattle $XXX.XX, [move]. Feeders $XXX.XX, [move]. [One sentence on why + what to watch].",
        "Hogs $XX.XX, [move]. [Context if notable].",
        "Class III milk $XX.XX, [move]. [Impact for dairy if notable]."
      ]
    }},
    {{
      "id": "weather",
      "title": "Weather & Fieldwork",
      "icon": "🌦️",
      "bullets": [
        "[Region] gets [X inches] rain [timeframe]. [What it means for fieldwork].",
        "[Region] stays [dry/wet]. [Window for operations].",
        "[Temps]: [range]. [Soil/frost/GDU implication if relevant].",
        "Bottom line: [One sentence summary of the week ahead for field planning]."
      ]
    }},
    {{
      "id": "energy",
      "title": "Energy & Macro",
      "icon": "⛽",
      "bullets": [
        "Crude $XX.XX, [move]. Diesel implication: [one phrase]. Anhydrous: [one phrase].",
        "Dollar at XX.XX, [move]. [Export competitiveness implication in one phrase].",
        "OPTIONAL: S&P, treasuries, natgas if they matter for ag today."
      ]
    }},
    {{
      "id": "policy",
      "title": "Policy & Trade",
      "icon": "🏛️",
      "bullets": [
        "[Most important policy/trade/USDA item]. [Why it matters for producers].",
        "[Second item if notable].",
        "OPTIONAL: upcoming report or deadline to watch."
      ]
    }}
  ],

  "watch_list": [
    {{"label": "Today", "item": "Specific thing to watch today — max 15 words."}},
    {{"label": "This Week", "item": "Key event or report this week — max 15 words."}},
    {{"label": "Horizon", "item": "1-4 weeks out, what smart operators are planning for."}},
    {{"label": "Risk", "item": "Biggest downside risk to prices right now — one sentence."}},
    {{"label": "Opportunity", "item": "Best move a producer should consider — specific and actionable."}}
  ],

  "the_more_you_know": {{
    "title": "Max 6 words — catchy, interesting",
    "body": "A genuinely useful or surprising ag fact in 2 sentences. Something worth sharing at the co-op."
  }},

  "daily_quote": {{
    "text": "A quote about farming, land, hard work, or resilience. Keep it real — no corporate inspiration.",
    "attribution": "Name, brief identifier"
  }},

  "source_summary": "Brief source attribution line"
}}

CRITICAL FORMATTING RULES:
- "top_line" array: exactly 3 strings. Line 1 = grains. Line 2 = livestock. Line 3 = energy/macro.
  Use fraction notation for grains: ½ ¼ ¾. Use $ signs. Keep each line under 70 chars.
- "bullets" arrays: each bullet is one string, 1-2 sentences MAX. Lead with the number.
- "field_call" is a quick-scan weather verdict — farmers look at this first thing.
- Total word count for the entire briefing should be 500-700 words. Not more. Every word earns its spot.
- Keep "one_number.why" to ONE sentence, max 30 words. This is a gut-punch stat, not a paragraph.
- Avoid hedging language: "may", "could potentially", "it remains to be seen". Be direct."""


def call_claude(prompt):
    if not ANTHROPIC_API_KEY:
        print("  ✗ ANTHROPIC_API_KEY not set")
        sys.exit(1)
    payload = json.dumps({
        "model": ANTHROPIC_MODEL, "max_tokens": MAX_TOKENS,
        "system": BRIEFING_SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    req = urllib_request.Request(
        "https://api.anthropic.com/v1/messages", data=payload,
        headers={
            "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01", "User-Agent": "AGSIST/3.0",
        }, method="POST",
    )
    try:
        with urllib_request.urlopen(req, timeout=90) as r:
            resp = json.loads(r.read().decode("utf-8"))
        text = resp["content"][0]["text"].strip()
        usage = resp.get("usage", {})
        print(f"  ✓ Claude response: {len(text)} chars")
        print(f"    Input tokens: {usage.get('input_tokens', '?')}, Output: {usage.get('output_tokens', '?')}")
        return text
    except urllib_error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  ✗ Claude API HTTP {e.code}: {body[:500]}")
        sys.exit(1)
    except Exception as e:
        print(f"  ✗ Claude API error: {e}")
        sys.exit(1)


def parse_briefing_json(raw_text):
    text = raw_text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    text = text.strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group())
            except Exception:
                print(f"  ✗ JSON parse failed: {e}")
                sys.exit(1)
        else:
            print(f"  ✗ No JSON found: {text[:600]}")
            sys.exit(1)

    required = ["headline", "subheadline", "date", "top_line", "teaser",
                "one_number", "field_call", "sections", "watch_list",
                "the_more_you_know", "daily_quote"]
    missing = [k for k in required if k not in data]
    if missing:
        print(f"  ⚠ Missing keys: {missing}")

    # Validate top_line has 3 items
    tl = data.get("top_line", [])
    if len(tl) != 3:
        print(f"  ⚠ top_line has {len(tl)} items, expected 3")

    return data


# ─────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────
def main():
    today = datetime.now(timezone.utc)
    today_str = today.strftime("%A, %B %-d, %Y")
    print(f"\n{'═' * 60}")
    print(f"  AGSIST Daily Generator v3.0")
    print(f"  {today.strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'═' * 60}")

    print("\n[1/5] Loading prices…")
    quotes, fetched = load_prices()
    price_text = format_prices_for_prompt(quotes)

    print("\n[2/5] Fetching Corn Belt weather (5 locations)…")
    weather_text = fetch_cornbelt_weather()

    print(f"\n[3/5] Fetching ag news from {len(RSS_FEEDS)} feeds…")
    news_items = fetch_all_news()
    news_text = format_news_for_prompt(news_items)

    upcoming = get_upcoming_usda_reports(news_items)
    if upcoming:
        print(f"  📋 Found {len(upcoming)} USDA report mentions")

    print("\n[4/5] Calling Claude API…")
    prompt = build_prompt(price_text, weather_text, news_text, today_str, upcoming)
    print(f"  Prompt length: ~{len(prompt)} chars")
    raw_response = call_claude(prompt)

    print("\n[5/5] Parsing briefing JSON…")
    briefing = parse_briefing_json(raw_response)

    # Append USDA reports to watch_list
    if upcoming:
        wl = briefing.get("watch_list", [])
        for report in upcoming[:2]:
            wl.append({"label": "USDA", "item": report["desc"]})
        briefing["watch_list"] = wl[:7]

    # Add metadata
    briefing["generated_utc"] = today.strftime("%Y-%m-%dT%H:%M:%SZ")
    briefing["prices_fetched"] = fetched or "unknown"
    briefing["news_sources"] = list(set(f["name"] for f in RSS_FEEDS))
    briefing["weather_locations"] = [loc["name"] for loc in WEATHER_LOCATIONS]
    briefing["version"] = "3.0"

    os.makedirs("data", exist_ok=True)
    with open("data/daily.json", "w") as f:
        json.dump(briefing, f, indent=2)

    print(f"\n{'═' * 60}")
    print(f"  ✓ data/daily.json written")
    print(f"  Headline:      {briefing.get('headline', '')}")
    print(f"  Sections:      {len(briefing.get('sections', []))}")
    print(f"  Top Line:      {len(briefing.get('top_line', []))} items")
    print(f"  Field Call:    {briefing.get('field_call', {}).get('label', '')}")
    print(f"  More You Know: {briefing.get('the_more_you_know', {}).get('title', '')}")
    print(f"  Quote:         {briefing.get('daily_quote', {}).get('attribution', '')}")
    print(f"{'═' * 60}\nDone.\n")


if __name__ == "__main__":
    main()
