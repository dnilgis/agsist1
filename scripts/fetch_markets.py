#!/usr/bin/env python3
"""
AGSIST fetch_markets.py  v2
════════════════════════════
Fetches prediction market odds relevant to agriculture from Kalshi
and Polymarket.  Runs server-side via GitHub Actions — no CORS issues.

v2 changes (2026-03-01):
  • Expanded keyword universe — now catches trade, tariffs, energy,
    weather/climate, monetary policy, transportation, and geopolitics
    that impact ag even if they don't mention "corn" or "wheat"
  • Relevance scoring (0-100) replaces binary keyword match
  • Each market gets a "why_it_matters" blurb explaining the ag angle
  • Markets categorized into display groups for the frontend
  • Top markets selected by (relevance × volume) composite score

Sources (public, no keys):
  • Kalshi      — https://trading.kalshi.com/trade-api/v2/markets
  • Polymarket  — https://gamma-api.polymarket.com/markets
"""

import json
import re
import os
import math
from datetime import datetime, timezone

try:
    import urllib.request as urllib_request
    import urllib.error as urllib_error
except ImportError:
    import urllib2 as urllib_request


# ═════════════════════════════════════════════════════════════════
# 1. KEYWORD UNIVERSE — tiered by agricultural relevance
# ═════════════════════════════════════════════════════════════════

# Tier 1 (100 pts): Directly about agriculture
TIER1_KEYWORDS = [
    "corn", "soybean", "wheat", "grain", "crop", "usda", "wasde",
    "drought", "farm", "cattle", "hog", "livestock", "ethanol",
    "harvest", "planting", "acreage", "export inspection",
    "fertilizer", "urea", "canola", "sorghum", "cotton", "rice",
    "pork", "beef", "dairy", "milk", "oat", "barley", "sugar",
    "poultry", "chicken", "egg", "crop insurance", "farm bill",
    "food price", "food inflation", "cropland", "grazing",
    "soil moisture", "growing season", "yield", "bushel",
    "commodity", "grain elevator", "feedlot",
]

# Tier 2 (70 pts): Trade, policy & energy — strong ag impact
TIER2_KEYWORDS = [
    "tariff", "trade war", "trade deal", "trade agreement",
    "china trade", "china import", "china export", "china ban",
    "brazil", "argentina", "ukraine", "black sea",
    "usmca", "nafta", "wto", "trade dispute", "sanction",
    "crude oil", "natural gas", "diesel", "gasoline", "energy price",
    "oil price", "opec", "pipeline", "renewable fuel", "biofuel",
    "carbon tax", "carbon credit", "emission",
    "epa", "environmental regulation", "water rights",
    "mississippi river", "panama canal", "suez canal",
    "rail strike", "railroad", "freight", "shipping",
    "port strike", "supply chain", "trucking",
    "immigration", "farm labor", "h-2a", "migrant worker",
    "bird flu", "avian influenza", "african swine fever",
    "mad cow", "food safety", "fda",
]

# Tier 3 (40 pts): Macro / weather / geopolitics — indirect ag impact
TIER3_KEYWORDS = [
    "interest rate", "fed rate", "federal reserve", "inflation",
    "cpi", "ppi", "recession", "gdp", "unemployment",
    "dollar", "usd", "currency", "yuan", "peso", "real",
    "government shutdown", "debt ceiling", "budget",
    "el nino", "la nina", "hurricane", "flood", "wildfire",
    "heat wave", "polar vortex", "frost", "freeze",
    "climate change", "climate policy", "paris agreement",
    "war", "conflict", "invasion", "nato",
    "russia", "iran", "middle east", "red sea",
    "water shortage", "aquifer", "irrigation",
    "land use", "deforestation", "amazon",
    "food security", "famine", "world food programme",
    "fertilizer ban", "nitrogen", "phosphate", "potash",
]

# All search queries to send to APIs (deduplicated, targeted)
SEARCH_QUERIES = [
    # Direct ag
    "corn", "soybean", "wheat", "cattle", "crop", "usda",
    "drought", "grain", "livestock", "farm bill", "ethanol",
    "dairy", "cotton", "sugar", "poultry", "fertilizer",
    # Trade & policy
    "tariff", "trade war", "china trade", "china", "brazil",
    "ukraine", "sanction", "export ban", "import",
    # Energy
    "oil price", "crude oil", "natural gas", "diesel",
    "biofuel", "renewable", "carbon",
    # Weather & climate
    "hurricane", "el nino", "flood", "heat wave",
    "wildfire", "climate",
    # Macro
    "interest rate", "inflation", "federal reserve",
    "recession", "dollar", "government shutdown",
    # Infrastructure & labor
    "rail strike", "port", "supply chain", "shipping",
    "immigration", "labor",
    # Food & disease
    "bird flu", "food price", "food safety", "famine",
    "avian influenza",
]


# ═════════════════════════════════════════════════════════════════
# 2. RELEVANCE SCORING
# ═════════════════════════════════════════════════════════════════

def score_relevance(text):
    """
    Score 0-100 how relevant a market is to agriculture.
    Higher = more directly about farming/ag.
    """
    t = text.lower()
    score = 0
    matched_tier = 0

    for kw in TIER1_KEYWORDS:
        if kw in t:
            score = max(score, 100)
            matched_tier = max(matched_tier, 1)

    if score < 100:
        for kw in TIER2_KEYWORDS:
            if kw in t:
                score = max(score, 70)
                matched_tier = max(matched_tier, 2)

    if score < 70:
        for kw in TIER3_KEYWORDS:
            if kw in t:
                score = max(score, 40)
                matched_tier = max(matched_tier, 3)

    # Bonus: multiple keyword hits in different tiers = higher confidence
    tier_hits = [0, 0, 0]
    for kw in TIER1_KEYWORDS:
        if kw in t: tier_hits[0] += 1
    for kw in TIER2_KEYWORDS:
        if kw in t: tier_hits[1] += 1
    for kw in TIER3_KEYWORDS:
        if kw in t: tier_hits[2] += 1

    total_hits = sum(tier_hits)
    if total_hits >= 3:
        score = min(100, score + 10)
    if tier_hits[0] > 0 and (tier_hits[1] > 0 or tier_hits[2] > 0):
        score = min(100, score + 5)

    return score, matched_tier


# ═════════════════════════════════════════════════════════════════
# 3. "WHY IT MATTERS" — agricultural impact explanations
# ═════════════════════════════════════════════════════════════════

# Pattern → explanation mapping. First match wins.
# Each tuple: (keywords_to_match, explanation_template)
WHY_IT_MATTERS = [
    # ── Direct commodity ──
    (["corn price", "corn futures"],
     "Corn is the #1 U.S. crop by acreage. Price moves directly affect revenue, forward contracts, and crop insurance guarantees."),
    (["soybean price", "soybean futures", "soy"],
     "Soybeans are the #2 U.S. row crop. Price shifts ripple through crush margins, meal/oil markets, and export competitiveness."),
    (["wheat price", "wheat futures", "wheat"],
     "Wheat prices affect rotation decisions, export demand, and food-grade premiums across the Plains and upper Midwest."),
    (["cattle", "beef"],
     "Cattle markets drive feeder prices and feed demand — higher beef prices pull more corn and distillers' grains into feedlots."),
    (["hog", "pork"],
     "Hog markets influence corn and soybean meal demand. Export disruptions or disease outbreaks move feed costs fast."),
    (["dairy", "milk"],
     "Dairy margins are squeezed by feed costs (corn, hay) and milk price. Policy shifts hit Class III and IV pricing."),
    (["poultry", "chicken", "egg"],
     "Poultry is the largest single consumer of soybean meal. Egg and broiler prices affect feed demand nationwide."),
    (["ethanol", "biofuel", "renewable fuel"],
     "~40% of U.S. corn goes to ethanol. Biofuel mandates, blend rates, and RFS waivers directly move corn basis."),
    (["cotton"],
     "Cotton competes for Southern acreage with corn and soybeans. Price moves shift planting intentions."),
    (["sugar"],
     "Sugar policy and prices affect crop rotation in the South and ethanol-vs-sugar economics in global markets."),
    (["usda", "wasde", "crop report"],
     "USDA reports (WASDE, Prospective Plantings, Crop Progress) are the single biggest scheduled price movers in grain markets."),
    (["farm bill"],
     "The Farm Bill sets crop insurance subsidies, conservation programs, SNAP funding, and commodity reference prices for 5+ years."),
    (["drought"],
     "Drought is the #1 yield threat. Even moderate dryness during pollination can cut corn yields 20-40%."),
    (["fertilizer", "urea", "nitrogen", "phosphate", "potash"],
     "Fertilizer is farmers' largest input cost after land. Price spikes compress margins and may shift acres toward soybeans."),
    (["crop insurance"],
     "Crop insurance guarantees are set by spring futures prices. Changes to policy affect risk management for every producer."),
    (["acreage", "planting"],
     "Planting intentions drive the supply outlook for the entire marketing year. Acreage shifts between corn and soybeans move prices."),

    # ── Trade & policy ──
    (["tariff", "trade war"],
     "Tariffs on ag exports or retaliatory duties from trading partners can close markets overnight — U.S. soy exports to China dropped 75% during 2018 trade tensions."),
    (["china trade", "china import", "china export", "china ban"],
     "China buys ~60% of global soybean trade. Any shift in Chinese demand or policy moves basis across the entire U.S. soy complex."),
    (["china"],
     "China is the world's largest agricultural importer. Trade policy, economic slowdowns, or geopolitical tensions ripple directly through U.S. grain and oilseed markets."),
    (["brazil"],
     "Brazil is the #1 soybean exporter and a major corn exporter. Their crop size, currency, and logistics set the global price floor."),
    (["argentina"],
     "Argentina is the top soybean meal/oil exporter. Export taxes, drought, or political instability disrupt global crush margins."),
    (["ukraine", "black sea", "russia"],
     "The Black Sea region exports ~30% of global wheat and significant corn. Conflict or shipping disruptions spike world grain prices."),
    (["sanction"],
     "Sanctions can disrupt fertilizer supply chains (Russia produces ~15% of global nitrogen) and redirect grain trade flows."),
    (["immigration", "farm labor", "h-2a", "migrant"],
     "Agriculture depends on seasonal labor for planting, harvesting, and processing. Labor policy changes hit specialty crops and livestock hardest."),

    # ── Energy ──
    (["crude oil", "oil price", "opec"],
     "Diesel is a top 3 farm input cost. Oil prices also move fertilizer costs (natural gas → ammonia) and ethanol blending economics."),
    (["natural gas"],
     "Natural gas is the primary feedstock for nitrogen fertilizer. Price spikes flow directly to anhydrous ammonia and urea costs."),
    (["diesel", "gasoline", "fuel"],
     "Fuel costs for planting, spraying, harvesting, and grain drying can swing $20-40/acre. Diesel price is a direct margin input."),
    (["carbon tax", "carbon credit", "emission"],
     "Carbon markets create potential new revenue for farmers through cover crops, no-till, and methane capture — or add costs through fuel taxes."),

    # ── Weather & climate ──
    (["hurricane"],
     "Hurricanes disrupt Gulf Coast grain export terminals, sugar/rice/cotton harvests, and can flood rivers that move 60% of U.S. grain exports."),
    (["el nino"],
     "El Niño typically brings wetter conditions to the southern U.S. and drier weather in Australia — reshuffling global wheat and feed grain supply."),
    (["la nina"],
     "La Niña often means drier conditions across the southern Plains and Corn Belt, plus drought risk in Argentina and southern Brazil."),
    (["flood"],
     "Flooding delays planting (prevent-plant claims spike), damages stored grain, and closes river barge traffic."),
    (["heat wave", "heat"],
     "Extreme heat during corn pollination (VT/R1 stage) can slash yields. Heat stress also reduces livestock feed efficiency and milk production."),
    (["wildfire", "fire"],
     "Wildfires destroy rangeland, displace livestock, degrade air quality for field work, and can trigger emergency grazing on CRP land."),
    (["frost", "freeze"],
     "Late spring frost kills emerged crops. Early fall frost ends the growing season before grain reaches maturity, cutting test weight and yield."),
    (["climate change", "climate policy", "paris agreement"],
     "Long-term climate shifts are moving growing zones north, increasing weather volatility, and driving new regulation on farm emissions."),

    # ── Macro / financial ──
    (["interest rate", "fed rate", "federal reserve"],
     "Higher rates raise operating loan costs and farmland financing. They also strengthen the dollar, making U.S. exports less competitive globally."),
    (["inflation", "cpi"],
     "Inflation drives up input costs (seed, chemicals, fuel, labor) and land rents — but can also support higher commodity prices."),
    (["recession", "gdp"],
     "Recessions cut meat demand (consumers trade down from beef to chicken) and reduce ethanol consumption with lower driving miles."),
    (["dollar", "usd", "currency"],
     "A strong dollar makes U.S. grain more expensive for foreign buyers. A 10% dollar move can shift export competitiveness by $0.50+/bu."),
    (["government shutdown", "debt ceiling"],
     "Shutdowns halt USDA reports, delay FSA payments, freeze crop insurance processing, and stop conservation program sign-ups."),

    # ── Infrastructure ──
    (["rail strike", "railroad", "freight"],
     "Rail moves ~30% of U.S. grain. Disruptions widen basis, strand grain at elevators, and delay fertilizer deliveries before planting."),
    (["mississippi river"],
     "The Mississippi system moves 60%+ of U.S. grain exports. Low water levels restrict barge loads and spike transportation costs."),
    (["panama canal", "suez canal", "shipping", "port"],
     "Global shipping routes affect export competitiveness. Canal restrictions or port strikes reroute grain and add transit costs."),
    (["supply chain"],
     "Supply chain disruptions hit ag through delayed equipment parts, chemical shortages, fertilizer logistics, and container availability."),

    # ── Disease ──
    (["bird flu", "avian influenza"],
     "Avian influenza outbreaks force flock depopulation, spike egg prices, disrupt poultry exports, and shift soybean meal demand."),
    (["african swine fever"],
     "ASF decimated China's hog herd in 2018-19, reshaping global pork trade and soybean meal demand for years."),

    # ── Catch-all for scored but unmatched ──
    (["food price", "food inflation", "food security", "famine"],
     "Global food prices are driven by grain and oilseed markets. Food security concerns can trigger export bans that disrupt trade flows."),
    (["war", "conflict", "invasion"],
     "Armed conflicts disrupt grain exports, fertilizer supply, energy markets, and shipping lanes — all of which flow to farm-gate prices."),
]


def get_why_it_matters(title):
    """Return a 'why it matters' explanation for an ag audience."""
    t = title.lower()
    for keywords, explanation in WHY_IT_MATTERS:
        if any(kw in t for kw in keywords):
            return explanation
    # Generic fallback
    return "This market reflects broader economic or geopolitical conditions that can influence commodity prices, input costs, or trade flows."


def get_category(title):
    """Categorize market for frontend display grouping."""
    t = title.lower()
    cats = {
        "Commodities": ["corn", "soybean", "wheat", "grain", "cattle", "hog",
                        "pork", "beef", "dairy", "milk", "cotton", "sugar",
                        "poultry", "egg", "rice", "oat", "barley"],
        "Trade & Policy": ["tariff", "trade", "china", "brazil", "argentina",
                           "ukraine", "sanction", "usda", "farm bill", "export",
                           "import", "wto", "nafta", "usmca"],
        "Energy & Inputs": ["oil", "crude", "natural gas", "diesel", "ethanol",
                            "biofuel", "fertilizer", "urea", "nitrogen",
                            "carbon", "renewable", "opec"],
        "Weather & Climate": ["drought", "hurricane", "el nino", "la nina",
                              "flood", "heat", "wildfire", "frost", "freeze",
                              "climate"],
        "Economy & Markets": ["interest rate", "fed", "inflation", "recession",
                              "dollar", "currency", "gdp", "unemployment",
                              "shutdown", "debt ceiling"],
        "Infrastructure": ["rail", "mississippi", "panama", "shipping", "port",
                           "supply chain", "freight", "trucking"],
    }
    for cat, keywords in cats.items():
        if any(kw in t for kw in keywords):
            return cat
    return "Other"


# ═════════════════════════════════════════════════════════════════
# 4. HTTP HELPER
# ═════════════════════════════════════════════════════════════════

def http_get_json(url, timeout=15):
    """Fetch JSON from a URL. Returns None on failure."""
    try:
        req = urllib_request.Request(url, headers={
            "User-Agent": "AGSIST/2.0 (agsist.com; agricultural data aggregator)",
            "Accept": "application/json",
        })
        with urllib_request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"  ✗ HTTP error {url[:80]}: {e}")
        return None


def time_remaining(close_str):
    """Human-readable time until market closes."""
    if not close_str:
        return ""
    try:
        close = datetime.fromisoformat(close_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff = close - now
        days = diff.days
        if days < 0:    return "Closed"
        if days == 0:   return "Closes today"
        if days == 1:   return "Closes tomorrow"
        if days <= 30:  return f"Closes in {days}d"
        months = days // 30
        return f"Closes in ~{months}mo"
    except Exception:
        return ""


# ═════════════════════════════════════════════════════════════════
# 5. KALSHI FETCHER
# ═════════════════════════════════════════════════════════════════

def fetch_kalshi():
    """Fetch and score ag-relevant markets from Kalshi."""
    print("\n[Kalshi] Fetching prediction markets…")
    markets = []
    seen = set()
    queries_tried = 0

    for kw in SEARCH_QUERIES:
        url = (f"https://trading.kalshi.com/trade-api/v2/markets"
               f"?limit=15&status=open&keyword={kw.replace(' ', '%20')}")
        data = http_get_json(url)
        queries_tried += 1
        if not data:
            continue

        items = data.get("markets", [])
        if items:
            print(f"  '{kw}': {len(items)} results")

        for m in items:
            ticker = m.get("ticker", "")
            if not ticker or ticker in seen:
                continue

            title = m.get("title") or m.get("subtitle") or ticker
            full_text = f"{title} {ticker} {m.get('subtitle', '')}"

            relevance, tier = score_relevance(full_text)
            if relevance < 40:
                continue  # Skip if below Tier 3

            yes_bid = m.get("yes_bid")
            yes_ask = m.get("yes_ask")
            no_bid = m.get("no_bid")
            if yes_bid is None and yes_ask is None:
                continue

            mid = (round((yes_bid + yes_ask) / 2)
                   if (yes_bid and yes_ask)
                   else (yes_bid or yes_ask or 50))

            volume = m.get("volume_24h", 0) or 0
            seen.add(ticker)

            markets.append({
                "platform":       "Kalshi",
                "ticker":         ticker,
                "title":          title,
                "yes":            mid,
                "no":             no_bid or (100 - mid),
                "volume_24h":     volume,
                "close_time":     m.get("close_time", ""),
                "time_left":      time_remaining(m.get("close_time", "")),
                "url":            f"https://kalshi.com/markets/{ticker}",
                "relevance":      relevance,
                "category":       get_category(title),
                "why_it_matters": get_why_it_matters(title),
            })

    print(f"  → {len(markets)} Kalshi ag-relevant markets "
          f"(from {queries_tried} queries, {len(seen)} unique)")
    return markets


# ═════════════════════════════════════════════════════════════════
# 6. POLYMARKET FETCHER
# ═════════════════════════════════════════════════════════════════

def fetch_polymarket():
    """Fetch and score ag-relevant markets from Polymarket."""
    print("\n[Polymarket] Fetching prediction markets…")
    markets = []
    seen = set()
    queries_tried = 0

    for kw in SEARCH_QUERIES:
        encoded = kw.replace(" ", "%20")
        url = (f"https://gamma-api.polymarket.com/markets"
               f"?active=true&closed=false&limit=15&keyword={encoded}")
        data = http_get_json(url)
        queries_tried += 1

        if not data:
            # Try alternate CLOB endpoint
            url2 = (f"https://clob.polymarket.com/markets"
                    f"?next_cursor=&keyword={encoded}")
            data = http_get_json(url2)

        if not data:
            continue

        items = (data if isinstance(data, list)
                 else data.get("results", data.get("markets", [])))
        if items:
            print(f"  '{kw}': {len(items)} results")

        for m in items:
            mid_id = (m.get("id") or m.get("condition_id")
                      or m.get("marketMakerAddress"))
            if not mid_id or mid_id in seen:
                continue

            question = (m.get("question") or m.get("title")
                        or m.get("description", ""))
            if not question:
                continue

            relevance, tier = score_relevance(question)
            if relevance < 40:
                continue

            # Parse probability
            outcomes = m.get("outcomePrices") or m.get("tokens") or []
            prob = None
            if isinstance(outcomes, list) and outcomes:
                try:
                    if isinstance(outcomes[0], str):
                        prob = round(float(outcomes[0]) * 100)
                    elif isinstance(outcomes[0], dict):
                        prob = round(float(outcomes[0].get("price", 0.5)) * 100)
                except Exception:
                    pass
            if prob is None:
                best = m.get("bestBid") or m.get("lastTradePrice")
                prob = round(float(best) * 100) if best else None
            if prob is None:
                continue  # Skip markets with no price data

            volume = m.get("volume") or m.get("volumeNum") or 0
            try:
                volume = float(volume)
            except Exception:
                volume = 0

            end_date = m.get("endDate") or m.get("end_date_iso") or ""
            seen.add(mid_id)

            markets.append({
                "platform":       "Polymarket",
                "ticker":         str(mid_id)[:20],
                "title":          question[:140],
                "yes":            prob,
                "no":             100 - prob,
                "volume_24h":     volume,
                "close_time":     end_date,
                "time_left":      time_remaining(end_date),
                "url":            (m.get("url")
                                   or f"https://polymarket.com/event/{mid_id}"),
                "relevance":      relevance,
                "category":       get_category(question),
                "why_it_matters": get_why_it_matters(question),
            })

    print(f"  → {len(markets)} Polymarket ag-relevant markets "
          f"(from {queries_tried} queries, {len(seen)} unique)")
    return markets


# ═════════════════════════════════════════════════════════════════
# 7. RANKING — composite score (relevance × volume)
# ═════════════════════════════════════════════════════════════════

def composite_score(market):
    """
    Rank by relevance first, volume second.
    Uses log(volume) so a huge-volume but low-relevance market
    doesn't outrank a moderate-volume direct-ag market.
    """
    relevance = market.get("relevance", 0)
    volume = max(market.get("volume_24h", 0), 1)
    return relevance * 1.5 + math.log10(volume) * 10


# ═════════════════════════════════════════════════════════════════
# 8. MAIN
# ═════════════════════════════════════════════════════════════════

def main():
    now = datetime.now(timezone.utc)
    print(f"\nAGSIST fetch_markets.py v2 — {now.strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    kalshi = fetch_kalshi()
    polymarket = fetch_polymarket()

    # Merge and rank
    combined = kalshi + polymarket
    combined.sort(key=composite_score, reverse=True)

    # Cap at top 20 for the frontend
    top_markets = combined[:20]

    # Group by category for frontend display
    categories = {}
    for m in top_markets:
        cat = m["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(m)

    # Stats
    tier_counts = {100: 0, 70: 0, 40: 0}
    for m in combined:
        r = m.get("relevance", 0)
        if r >= 100:   tier_counts[100] += 1
        elif r >= 70:  tier_counts[70] += 1
        else:          tier_counts[40] += 1

    output = {
        "fetched":        now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version":        2,
        "count":          len(top_markets),
        "total_found":    len(combined),
        "tier_breakdown": {
            "direct_ag":  tier_counts[100],
            "trade_energy": tier_counts[70],
            "macro_weather": tier_counts[40],
        },
        "categories":     categories,
        "markets":        top_markets,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/markets.json", "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n{'=' * 60}")
    print(f"✓ data/markets.json written")
    print(f"  Total found:  {len(combined)}")
    print(f"  Top selected: {len(top_markets)}")
    print(f"  Direct ag:    {tier_counts[100]}")
    print(f"  Trade/energy: {tier_counts[70]}")
    print(f"  Macro/weather:{tier_counts[40]}")
    print(f"\n  Top 10:")
    for i, m in enumerate(top_markets[:10], 1):
        score = composite_score(m)
        print(f"  {i:2d}. [{m['platform']:10s}] {m['yes']:3d}%  "
              f"(rel={m['relevance']}, score={score:.0f})  "
              f"{m['title'][:55]}")
        print(f"      └─ {m['why_it_matters'][:75]}…"
              if len(m['why_it_matters']) > 75
              else f"      └─ {m['why_it_matters']}")


if __name__ == "__main__":
    main()
