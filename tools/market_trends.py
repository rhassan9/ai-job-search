#!/usr/bin/env python3
"""Skill demand across countries and months, from postings /rank has scored.

/rank stores each scored posting's extracted `facts` (skills, ISO country) in
job_scraper/seen_jobs.json. This counts them, so /upskill can show what the
market asks for, not only what the user's tracked jobs ask for. Vetoed jobs
are counted too: demand is demand, whether or not the user can apply.

Month = the entry's `first_seen` (YYYY-MM), falling back to `first_verified`, then `rank_date`.
A skill is counted once per posting; spellings are folded case-insensitively.

Usage:
  python3 tools/market_trends.py [--country DE] [--top 10] [--min-count 2]

Prints JSON: postings counted, top skills overall (count and share), top
skills per country, and month-over-month movers between the last two months
that have data (share change in percentage points; skills under --min-count
postings in both months are left out as noise).
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

from rank_state import STATE, _force_utf8_output, load_state


def month_of(entry: dict) -> str | None:
    # first_seen is when the posting entered the market for this workspace and
    # never moves; rank_date moves on every re-rank, so a re-scored October
    # posting would otherwise drift into November's counts.
    for field in ("first_seen", "first_verified", "rank_date"):
        value = entry.get(field)
        if isinstance(value, str) and len(value) >= 7 and value[4] == "-":
            return value[:7]
    return None


def collect(seen: dict, country: str | None):
    postings = []
    for entry in seen.values():
        facts = entry.get("facts") if isinstance(entry, dict) else None
        if not isinstance(facts, dict) or not isinstance(facts.get("skills"), list):
            continue
        where = facts.get("country") or "multi_or_unstated"  # remote across several countries, or not stated
        if country and where != country:
            continue
        names = {}
        for skill in facts["skills"]:
            if isinstance(skill, str) and skill.strip():
                names.setdefault(skill.strip().casefold(), skill.strip())
        postings.append((where, month_of(entry), names))
    return postings


def top(counter: Counter, display: dict, total: int, n: int) -> list[dict]:
    return [{"skill": display[k], "count": c, "share": round(c / total, 3)}
            for k, c in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]


def trends(seen: dict, country: str | None = None, n: int = 10, min_count: int = 2) -> dict:
    postings = collect(seen, country)
    display, overall = {}, Counter()
    by_country: dict[str, Counter] = defaultdict(Counter)
    by_month: dict[str, Counter] = defaultdict(Counter)
    month_totals: Counter = Counter()
    for where, month, names in postings:
        for key, name in names.items():
            display.setdefault(key, name)
            overall[key] += 1
            by_country[where][key] += 1
            if month:
                by_month[month][key] += 1
        if month:
            month_totals[month] += 1
    country_totals = Counter(where for where, _, _ in postings)
    result = {
        "postings": len(postings),
        "top_skills": top(overall, display, len(postings) or 1, n),
        "by_country": {c: {"postings": country_totals[c], "top": top(by_country[c], display, country_totals[c], 5)}
                       for c in sorted(by_country)},
        "movers": None,
    }
    months = sorted(month_totals)
    if len(months) >= 2:
        prev, last = months[-2], months[-1]
        movers = []
        for key in set(by_month[prev]) | set(by_month[last]):
            a, b = by_month[prev][key], by_month[last][key]
            if max(a, b) < min_count:
                continue
            change = round(100 * (b / month_totals[last] - a / month_totals[prev]), 1)
            if change:
                movers.append({"skill": display[key], "from": a, "to": b, "share_change_pts": change})
        movers.sort(key=lambda m: (-abs(m["share_change_pts"]), m["skill"].casefold()))
        result["movers"] = {"from_month": prev, "to_month": last,
                            "postings": [month_totals[prev], month_totals[last]], "skills": movers[:n]}
    return result


def main() -> int:
    _force_utf8_output()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--country", type=lambda v: v.strip().upper() if len(v.strip()) == 2 and v.strip().isalpha() else parser.error(f"--country takes an ISO-2 code such as DE, got {v!r}"))
    positive = lambda v: int(v) if v.isdigit() and int(v) >= 1 else parser.error(f"expected a whole number >= 1, got {v!r}")
    parser.add_argument("--top", type=positive, default=10)
    parser.add_argument("--min-count", type=positive, default=2)
    parser.add_argument("--state", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()
    state = Path(args.state) if args.state else STATE
    if not state.exists():
        print(json.dumps(trends({})))
        return 0
    _, seen = load_state(state)
    print(json.dumps(trends(seen, args.country, args.top, args.min_count), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
