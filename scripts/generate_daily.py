#!/usr/bin/env python3
"""
AGSIST generate_daily.py  v2.0 — Gold-Standard Daily Ag Briefing
═════════════════════════════════════════════════════════════════
Generates data/daily.json every weekday morning via GitHub Actions.

Pulls from 15+ free news/data sources across ag markets, USDA, global
trade, weather, livestock, dairy, energy, and policy — then uses Claude
to synthesize a plain-English briefing written for working farmers.

Data sources (all free, no API keys except ANTHROPIC_API_KEY):
  • data/prices.json      — yfinance futures (fetched by prices.yml)
  • Open-Meteo            — Corn Belt weather (5 locations)
  • 15+ ag RSS feeds      — USDA, AgWeb, DTN, Farm Progress, Brownfield,
                            Successful Farming, World-Grain, Beef Magazine,
                            Hoard's Dairyman, NOAA, Pro Farmer, etc.
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
MAX_TOKENS        = 3500

# ─────────────────────────────────────────────────────────────────
# RSS FEEDS — 15+ sources organized by category
# ─────────────────────────────────────────────────────────────────
RSS_FEEDS = [
    # ── USDA & Government (NASS reports feed is reliable) ──
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
            "User-Agent": "AGSIST/2.0 (agsist.com; agricultural briefing aggregator)",
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
        lines.append(f"  {label}: {close}{suffix}  {arrow} {abs(net):.2f} ({abs(pct):.2f}%)  Open: {opn}  High: {hi}  Low: {lo}")
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
                day_outlook.append(f"    {day_names[i]}: Hi {hi_d}°F / Lo {lo_d}°F, rain chance {pop_d}%, precip {precip_d:.2f}in")
            summary = (
                f"  {loc['name']}: Currently {desc}, {round(cur.get('temperature_2m', 0))}°F, "
                f"wind {round(cur.get('wind_speed_10m', 0))} mph, humidity {cur.get('relative_humidity_2m', 0)}%\n"
                f"    Today: Hi {hi_today}° / Lo {lo_today}°, rain chance {pop_today}%, max wind {wind_max} mph\n"
                f"    5-day precip total: {precip_5day:.2f} inches\n"
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

BRIEFING_SYSTEM = """You are the editor of AGSIST Daily, the morning agricultural briefing
that every farmer, grain merchandiser, ag retailer, co-op employee, and rural banker in
America reads before their first cup of coffee. Your readers are smart, practical people
who don't have time for Wall Street jargon or academic language.

YOUR VOICE:
- Write like a trusted neighbor who happens to know markets inside and out
- Plain English always. If you must use a market term (basis, carry, crush margin, etc.),
  explain it in a quick parenthetical so everyone follows along
- Lead with WHY IT MATTERS TO THE READER. Don't just say corn is down — say what that
  means for someone deciding whether to sell, store, or forward-contract today
- Be direct and confident. "Corn got hit" not "Corn experienced downward pressure"
- Use real numbers. Be specific. Farmers respect precision
- Okay to use common ag shorthand: "beans" for soybeans, "the board" for futures, etc.
- When talking about weather, tell them what it means for fieldwork, not just temperatures

YOUR STANDARDS:
- NEVER fabricate prices, statistics, or data. Only use what is provided in the data
- If data is missing or unavailable, say so honestly — farmers respect that
- Attribute claims to sources when relevant ("USDA says…", "DTN reports…")
- Cover the full picture: grains, livestock, energy, weather, policy, global trade
- Always connect market moves to real-world farm decisions
- Every section should answer: "So what does this mean for my operation?"

YOUR BRIEFING IS READ BY:
- Row crop farmers (corn, beans, wheat) making marketing and input decisions
- Livestock producers watching feed costs and cattle/hog markets
- Grain merchandisers and elevator operators setting bids
- Co-op agronomists planning field recommendations
- Ag lenders evaluating farm financial health
- Ag retailers selling seed, chemical, and fertilizer
- Commodity traders and analysts

Make every reader feel like they got smarter and more prepared in 3 minutes."""


def build_prompt(price_text, weather_text, news_text, today_str, upcoming_reports):
    reports_text = ""
    if upcoming_reports:
        reports_text = "\n═══ UPCOMING USDA REPORTS ═══\n"
        for r in upcoming_reports:
            reports_text += f"  • {r['desc']}\n"

    return f"""Today is {today_str}. Generate the AGSIST Daily morning briefing from the data below.
Read ALL the data carefully before writing. Connect the dots between markets, weather, policy, and
what it means on the farm.

═══ FUTURES PRICES (yesterday's settle via Yahoo Finance / yfinance) ═══
{price_text}

═══ CORN BELT WEATHER (5 locations across the belt) ═══
{weather_text}
{reports_text}
═══ TODAY'S AG NEWS & HEADLINES ═══
{news_text}

═══ OUTPUT FORMAT ═══
Return ONLY valid JSON (no markdown, no backticks, no commentary outside the JSON) matching this schema:

{{
  "headline": "Short punchy headline in plain English (max 8 words, NOT all caps — write it like a newspaper headline)",
  "subheadline": "One plain-English sentence explaining the headline and why it matters (max 25 words)",
  "lead": "Opening paragraph — 3-4 sentences. Tell a farmer what happened, why, and what it means for their operation this week. Write it like you're talking to your neighbor over the fence. Be specific with numbers.",
  "date": "{today_str}",
  "teaser": "One compelling sentence that makes someone want to read the full briefing (max 20 words)",
  "one_number": {{
    "value": "The single most important number today — a price, a change amount, a percentage, bushels, etc.",
    "unit": "What that number represents in plain terms",
    "context": "Why this number matters to a farmer making decisions today. 2 sentences, plain English. Connect it to something they'd actually do — sell, hold, apply, plant, hedge."
  }},
  "sections": [
    {{
      "title": "Grains & Oilseeds",
      "body": "3-4 sentences covering corn, soybeans, wheat, and oats if relevant. What moved, why it moved, and what a farmer should think about. Use specific prices. If there's a spread worth noting (old crop vs new crop, corn-bean ratio), explain what it is and why it matters. Example: 'The corn-bean price ratio (how many bushels of corn it takes to buy one bushel of beans) is sitting at X, which historically favors planting more corn.'"
    }},
    {{
      "title": "Livestock, Dairy & Feed",
      "body": "2-3 sentences. Cover cattle, hogs, dairy — what's moving and why a livestock producer or someone selling feed should care. Connect feed costs (corn, meal) to livestock margins when relevant. Explain terms like 'crush margin' or 'basis' if you use them."
    }},
    {{
      "title": "Weather & Field Conditions",
      "body": "3-4 sentences. Synthesize the 5-location weather data into what matters for field operations. Talk about planting windows, spray conditions, soil moisture, frost risk, drought — whatever is timely. Tell them what the 5-day outlook means for their week ahead. Be specific about which parts of the belt are wet vs dry. This is one of the most important sections — farmers plan their entire week around weather."
    }},
    {{
      "title": "Energy, Dollar & Outside Markets",
      "body": "2-3 sentences. Cover crude oil, natural gas, dollar index, stock market — but ONLY in terms of what they mean for agriculture. Examples: 'Higher crude means your diesel and anhydrous (nitrogen fertilizer made from natural gas) costs go up, but it also boosts ethanol margins which supports corn demand.' 'A stronger dollar makes US grain more expensive for foreign buyers, which can drag on export demand.' Always make the farm connection."
    }},
    {{
      "title": "Policy, Trade & Big Picture",
      "body": "2-3 sentences. Cover USDA reports, trade deals, tariffs, farm bill news, EPA rulings, global supply stories — whatever is in the news that affects agriculture. If a USDA report is coming, tell them what it is, when it drops, and what to watch for. Always explain why the policy or trade item matters to someone running a farm or ranch."
    }}
  ],
  "the_more_you_know": {{
    "title": "Short catchy title (max 6 words)",
    "body": "A genuinely interesting and useful agricultural fact, historical tidbit, agronomic insight, or market wisdom that the reader probably didn't know. Something they'd share at the co-op or coffee shop. 2-3 sentences. Examples: a surprising stat about corn genetics, how a historical event changed grain markets, a soil science nugget, a little-known USDA program, the origin of a farming term, a record that still stands. Make it delightful to read and actually educational."
  }},
  "daily_quote": {{
    "text": "An inspirational, thoughtful, or wise quote relevant to farming, agriculture, hard work, weather, land, food, resilience, or rural life. Can be from a farmer, rancher, president, author, economist, agronomist, or folk wisdom. Something that resonates with people who work the land or serve those who do. Do NOT repeat quotes from previous days — pick something fresh.",
    "attribution": "Who said it (name and brief identifier if the person isn't universally known, e.g. 'Wendell Berry, farmer and author')"
  }},
  "watch_list": [
    {{"time": "Today", "desc": "The single most important thing to watch today — a report release time, a price level, a weather event, a decision point. Be specific."}},
    {{"time": "This Week", "desc": "Key item to monitor this week — upcoming report, weather pattern, export deadline, etc."}},
    {{"time": "On the Horizon", "desc": "Something 1-4 weeks out that smart operators are already thinking about — planting dates, input buying windows, USDA report schedule, etc."}},
    {{"time": "Risk to Watch", "desc": "The biggest downside risk to grain/livestock prices right now. Explain in plain terms what could go wrong and what it would mean."}},
    {{"time": "Opportunity", "desc": "The best opportunity a producer should consider right now. Be specific — what action, at what level, and why the timing matters."}}
  ],
  "source_summary": "Brief line listing key sources (e.g. 'USDA, DTN, AgWeb, Reuters, Open-Meteo, Yahoo Finance')"
}}"""


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
            "anthropic-version": "2023-06-01", "User-Agent": "AGSIST/2.0",
        }, method="POST",
    )
    try:
        with urllib_request.urlopen(req, timeout=60) as r:
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
    required = ["headline","subheadline","lead","date","teaser","one_number","sections","watch_list","the_more_you_know","daily_quote"]
    missing = [k for k in required if k not in data]
    if missing:
        print(f"  ⚠ Missing keys: {missing}")
    return data


# ─────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────
def main():
    today = datetime.now(timezone.utc)
    today_str = today.strftime("%A, %B %-d, %Y")
    print(f"\n{'═' * 60}")
    print(f"  AGSIST Daily Generator v2.0")
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

    if upcoming:
        wl = briefing.get("watch_list", [])
        for report in upcoming[:2]:
            wl.append(report)
        briefing["watch_list"] = wl[:7]

    briefing["generated_utc"] = today.strftime("%Y-%m-%dT%H:%M:%SZ")
    briefing["prices_fetched"] = fetched or "unknown"
    briefing["news_sources"] = list(set(f["name"] for f in RSS_FEEDS))
    briefing["weather_locations"] = [loc["name"] for loc in WEATHER_LOCATIONS]
    briefing["version"] = "2.0"

    os.makedirs("data", exist_ok=True)
    with open("data/daily.json", "w") as f:
        json.dump(briefing, f, indent=2)

    print(f"\n{'═' * 60}")
    print(f"  ✓ data/daily.json written")
    print(f"  Headline:      {briefing.get('headline', '')}")
    print(f"  Sections:      {len(briefing.get('sections', []))}")
    print(f"  More You Know: {briefing.get('the_more_you_know', {}).get('title', '')}")
    print(f"  Quote:         {briefing.get('daily_quote', {}).get('attribution', '')}")
    print(f"{'═' * 60}\nDone.\n")


if __name__ == "__main__":
    main()
