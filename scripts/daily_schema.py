"""
AGSIST Daily — canonical schema + validator.

Single source of truth for daily.json field names. Both the generator
(writes) and the front-end renderer (reads) must agree on these names.

Run directly to validate: python scripts/daily_schema.py data/daily.json
Exit code 0 = valid, 1 = invalid (causes workflow to fail).
"""
import sys
import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Canonical field names — the only accepted names going forward.
# If a field is missing or renamed, validation fails and the workflow fails.
# ---------------------------------------------------------------------------

REQUIRED_TOP_LEVEL = [
    "headline",
    "subheadline",
    "lead",
    "sections",
    "date",
    "generated_at",
]

OPTIONAL_TOP_LEVEL = [
    "teaser",
    "one_number",          # {value, unit, context}
    "the_more_you_know",   # {title, body}
    "watch_list",          # [{time, desc}]
    "daily_quote",         # {text, attribution}
    "source_summary",
    "meta",
    "generator_version",
    "surprise_count",
    "surprises",
    "price_validation_clean",
    "market_closed",
    "market_status_reason",
    "prices",
]

# Deprecated field names — if present, validation warns but does not fail.
# Remove the warning once the generator has been fully migrated.
DEPRECATED_ALIASES = {
    "quote": "daily_quote",
    "tmyk": "the_more_you_know",
    "the_number": "one_number",
    "number": "one_number",
}

SECTION_REQUIRED = ["title", "body"]
SECTION_OPTIONAL = [
    "icon",
    "bottom_line",
    "conviction_level",
    "overnight_surprise",
    "farmer_action",
]

ONE_NUMBER_REQUIRED = ["value"]
ONE_NUMBER_OPTIONAL = ["unit", "context"]

TMYK_REQUIRED = ["title", "body"]

QUOTE_REQUIRED = ["text", "attribution"]

WATCH_ITEM_REQUIRED = ["desc"]  # time is optional


def validate(data: dict) -> tuple[bool, list[str], list[str]]:
    """Return (is_valid, errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []

    # Top-level required fields
    for field in REQUIRED_TOP_LEVEL:
        if field not in data:
            errors.append(f"Missing required top-level field: {field}")

    # Deprecated aliases — warn so we catch drift early
    for old, new in DEPRECATED_ALIASES.items():
        if old in data and new not in data:
            warnings.append(
                f"Deprecated field name '{old}' found — rename to '{new}'"
            )
        elif old in data and new in data:
            warnings.append(
                f"Both deprecated '{old}' and canonical '{new}' present — "
                f"drop '{old}'"
            )

    # sections array
    secs = data.get("sections")
    if not isinstance(secs, list):
        errors.append("'sections' must be a list")
    elif len(secs) < 1:
        errors.append("'sections' must contain at least one entry")
    else:
        for i, s in enumerate(secs):
            if not isinstance(s, dict):
                errors.append(f"sections[{i}] is not an object")
                continue
            for f in SECTION_REQUIRED:
                if f not in s or not s[f]:
                    errors.append(f"sections[{i}] missing '{f}'")

    # one_number (optional block, but if present must be valid)
    on = data.get("one_number")
    if on is not None:
        if not isinstance(on, dict):
            errors.append("'one_number' must be an object")
        else:
            for f in ONE_NUMBER_REQUIRED:
                if f not in on or on[f] in (None, ""):
                    errors.append(f"one_number.{f} is required when block present")

    # the_more_you_know
    tmyk = data.get("the_more_you_know")
    if tmyk is not None:
        if not isinstance(tmyk, dict):
            errors.append("'the_more_you_know' must be an object")
        else:
            for f in TMYK_REQUIRED:
                if f not in tmyk or not tmyk[f]:
                    errors.append(f"the_more_you_know.{f} is required when block present")

    # daily_quote
    q = data.get("daily_quote")
    if q is not None:
        if not isinstance(q, dict):
            errors.append("'daily_quote' must be an object")
        else:
            for f in QUOTE_REQUIRED:
                if f not in q or not q[f]:
                    errors.append(f"daily_quote.{f} is required when block present")
            # Fail-loud on filler attribution
            attr = (q.get("attribution") or "").strip().lower()
            if attr in ("unknown", "anonymous", "", "n/a"):
                errors.append(
                    f"daily_quote.attribution is a filler value ({q.get('attribution')!r}). "
                    "Pick from data/quote-pool.json — never synthesize."
                )

    # watch_list
    wl = data.get("watch_list")
    if wl is not None:
        if not isinstance(wl, list):
            errors.append("'watch_list' must be a list")
        else:
            for i, item in enumerate(wl):
                if not isinstance(item, dict):
                    errors.append(f"watch_list[{i}] is not an object")
                    continue
                for f in WATCH_ITEM_REQUIRED:
                    if f not in item or not item[f]:
                        errors.append(f"watch_list[{i}] missing '{f}'")

    # Em-dash detection — optional, informational
    prose_fields = [data.get("lead", ""), data.get("subheadline", "")]
    for s in data.get("sections") or []:
        if isinstance(s, dict):
            prose_fields.append(s.get("body", ""))
            prose_fields.append(s.get("bottom_line", ""))
    em_count = sum(t.count("\u2014") for t in prose_fields if isinstance(t, str))
    if em_count > 6:
        warnings.append(
            f"High em-dash count ({em_count}) — prompt may be producing AI-style prose. "
            "Consider rewriting with periods or parentheses."
        )

    return (len(errors) == 0, errors, warnings)


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/daily_schema.py <path/to/daily.json>")
        return 2

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}")
        return 2

    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {e}")
        return 1

    ok, errors, warnings = validate(data)

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")

    if ok:
        print(f"OK    {path} — {len(data.get('sections', []))} sections, "
              f"{len(warnings)} warning(s)")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
