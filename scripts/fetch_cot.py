#!/usr/bin/env python3
"""
fetch_cot.py — CFTC Commitments of Traders (Disaggregated Futures-Only) fetcher
Writes data/cot.json with managed money net positioning for corn, soybeans, wheat.
Runs Saturdays via GitHub Actions (after Friday 3:30 PM ET CFTC release).

Data source: CFTC Disaggregated Futures-Only report
https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm
"""

import csv
import io
import json
import os
import zipfile
from datetime import datetime, timedelta
import urllib.request
import sys

OUT_FILE = "data/cot.json"

# CFTC disaggregated futures-only text (CSV) files by year
CFTC_URL = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip"

# Target commodity name fragments (matched against Market_and_Exchange_Names column)
# These are the exact strings that appear in the CFTC file
TARGETS = {
    "corn":  "CORN - CHICAGO BOARD OF TRADE",
    "beans": "SOYBEANS - CHICAGO BOARD OF TRADE",
    "wheat": "WHEAT - CHICAGO BOARD OF TRADE",
}


def fetch_zip(year: int) -> str | None:
    url = CFTC_URL.format(year=year)
    print(f"  Fetching {url}", flush=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0"})
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read()
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            names = z.namelist()
            # Pick the first .txt file (disaggregated futures report)
            inner = next((n for n in names if n.lower().endswith(".txt")), names[0])
            print(f"    Inner file: {inner}", flush=True)
            with z.open(inner) as f:
                return f.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  Error fetching {year}: {e}", flush=True)
        return None


def parse_rows(csv_text: str) -> list[dict]:
    """
    Parse disaggregated COT CSV and return rows for our target commodities.
    Each row: { commodity, date_str, dt, net, long, short }
    """
    rows = []
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        market = row.get("Market_and_Exchange_Names", "").strip()
        for key, target in TARGETS.items():
            if target.lower() in market.lower():
                try:
                    long_pos  = int(row.get("M_Money_Positions_Long_All",  0) or 0)
                    short_pos = int(row.get("M_Money_Positions_Short_All", 0) or 0)
                    net = long_pos - short_pos
                    date_str = row.get("Report_Date_as_MM_DD_YYYY", "").strip()
                    rows.append({
                        "commodity": key,
                        "date_str":  date_str,
                        "net":   net,
                        "long":  long_pos,
                        "short": short_pos,
                    })
                except (ValueError, KeyError, TypeError) as e:
                    print(f"  Parse error for {key}: {e}", flush=True)
                break
    return rows


def parse_date(s: str) -> datetime:
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return datetime.min


def fmt_k(n: int) -> str:
    """Format large number as e.g. +145.2k or -28.4k"""
    if n is None:
        return "--"
    sign = "+" if n >= 0 else "-"
    abs_n = abs(n)
    if abs_n >= 1000:
        return f"{sign}{abs_n/1000:.1f}k"
    return f"{sign}{abs_n}"


def main():
    os.makedirs("data", exist_ok=True)

    current_year = datetime.now().year
    all_rows: list[dict] = []

    # Fetch current year + prior year to build a solid 52-week window
    for year in [current_year - 1, current_year]:
        text = fetch_zip(year)
        if text:
            parsed = parse_rows(text)
            print(f"  Parsed {len(parsed)} rows from {year}", flush=True)
            all_rows.extend(parsed)

    if not all_rows:
        print("ERROR: No COT rows fetched — aborting without overwriting existing file.")
        sys.exit(1)

    # Attach datetime objects
    for row in all_rows:
        row["dt"] = parse_date(row["date_str"])

    all_rows.sort(key=lambda r: r["dt"])

    # Latest report date across all commodities
    latest_dt = max(r["dt"] for r in all_rows)
    cutoff_52w = latest_dt - timedelta(weeks=52)

    print(f"\nLatest report date: {latest_dt.strftime('%Y-%m-%d')}", flush=True)

    output = {
        "updated":     datetime.now().strftime("%Y-%m-%d"),
        "report_date": latest_dt.strftime("%B %d, %Y"),
    }

    all_ok = True
    for commodity in ["corn", "beans", "wheat"]:
        comm_rows = [r for r in all_rows if r["commodity"] == commodity]
        if not comm_rows:
            print(f"  WARNING: No rows found for {commodity}")
            all_ok = False
            continue

        # Latest week
        latest = max(comm_rows, key=lambda r: r["dt"])

        # Prior week
        prior_candidates = [r for r in comm_rows if r["dt"] < latest["dt"]]
        prior = max(prior_candidates, key=lambda r: r["dt"]) if prior_candidates else None

        # 52-week range (rows within last 52 weeks from latest report date)
        range_rows = [r for r in comm_rows if r["dt"] >= cutoff_52w]
        if not range_rows:
            range_rows = comm_rows  # fallback to all available

        nets = [r["net"] for r in range_rows]
        min52 = min(nets)
        max52 = max(nets)

        output[commodity] = {
            "net":   latest["net"],
            "prev":  prior["net"] if prior else None,
            "long":  latest["long"],
            "short": latest["short"],
            "min52": min52,
            "max52": max52,
        }

        chg = (latest["net"] - prior["net"]) if prior else 0
        print(
            f"  {commodity:6s}: net={fmt_k(latest['net']):>8s} "
            f"chg={fmt_k(chg):>8s} | "
            f"52w [{fmt_k(min52)} → {fmt_k(max52)}]",
            flush=True
        )

    with open(OUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nWritten {OUT_FILE}")
    if not all_ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
