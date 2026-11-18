#!/usr/bin/env python3
"""Rules-based Remote Eligibility Gate for structured location data.

Some sources say where a remote hire may live as data, not prose: Himalayas
gives `location_restrictions` (country names, empty = worldwide) and
`timezone_restrictions` (UTC offsets), We Work Remotely gives a `region`
("USA Only", "Anywhere in the World") and a `countries` list. For those, the
verdict is a lookup, not a judgment, so code makes it and the model only reads
free text. The rules mirror 04-job-evaluation.md's Remote Eligibility Gate:

  worldwide, or the base country is allowed     -> PASS
  base country's membership of a region unclear -> FLAG (e.g. Pakistan in EMEA)
  restricted, but a target country is allowed   -> FLAG relocation needed
  a location the table does not recognise       -> FLAG (never a FAIL on a guess)
  restricted to countries excluding all of them -> FAIL
  no structured location field at all           -> null, decided_by "unstructured"

Time zones: a listed offset within --tz-tolerance hours of the base offset
-> PASS, outside -> FLAG, none listed -> null. A time-zone FLAG is a signal,
never a veto, as in the gate.

Usage:
  python3 tools/eligibility.py --jobs jobs.json --base PK --targets DE,AT,US --utc-offset 5
  (jobs.json: a JSON array, or {"results": [...]}, as the plugins print it)

Prints a JSON array, one object per job: key/url/title echoed, location_verdict,
location_note, timezone_verdict, timezone_note, decided_by. Exit 1 on bad input.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from country_codes import COUNTRIES

def _fold(text: str) -> str:
    """One normal form for table names and posting tokens alike."""
    t = " ".join(text.casefold().split()).strip(" -,.")
    return re.sub(r"\s+only$", "", t)


NAME_TO_CODE = {_fold(name): code for code, names in COUNTRIES.items() for name in names}

EU_EEA = {"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT",
          "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"}
EUROPE = EU_EEA | {"AD", "AL", "AX", "BA", "BY", "CH", "FO", "GB", "GG", "GI", "IM", "JE", "MC", "MD", "ME", "MK",
                   "RS", "SJ", "SM", "UA", "VA", "XK"}
AFRICA = {"AO", "BF", "BI", "BJ", "BW", "CD", "CF", "CG", "CI", "CM", "CV", "DJ", "DZ", "EG", "EH", "ER", "ET",
          "GA", "GH", "GM", "GN", "GQ", "GW", "KE", "KM", "LR", "LS", "LY", "MA", "MG", "ML", "MR", "MU", "MW",
          "MZ", "NA", "NE", "NG", "RE", "RW", "SC", "SD", "SH", "SL", "SN", "SO", "SS", "ST", "SZ", "TD", "TG",
          "TN", "TZ", "UG", "YT", "ZA", "ZM", "ZW"}
MIDDLE_EAST = {"AE", "BH", "IL", "IQ", "IR", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE"}
SOUTH_ASIA = {"AF", "BD", "BT", "IN", "LK", "MV", "NP", "PK"}
EAST_SE_ASIA = {"BN", "CN", "HK", "ID", "JP", "KH", "KP", "KR", "LA", "MM", "MN", "MO", "MY", "PH", "SG", "TH",
                "TL", "TW", "VN"}
CENTRAL_ASIA = {"KZ", "KG", "TJ", "TM", "UZ"}
CAUCASUS = {"AM", "AZ", "GE"}
ASIA = SOUTH_ASIA | EAST_SE_ASIA | CENTRAL_ASIA
LATAM = {"AR", "BO", "BR", "BZ", "CL", "CO", "CR", "CU", "DO", "EC", "GT", "GY", "HN", "HT", "MX", "NI", "PA",
         "PE", "PR", "PY", "SR", "SV", "UY", "VE"}
CARIBBEAN = {"AG", "AI", "AW", "BB", "BL", "BM", "BQ", "BS", "CW", "DM", "GD", "GP", "JM", "KN", "KY", "LC",
             "MF", "MQ", "MS", "SX", "TC", "TT", "VC", "VG", "VI"}
OCEANIA = {"AS", "AU", "CK", "FJ", "FM", "GU", "KI", "MH", "MP", "NC", "NF", "NR", "NU", "NZ", "PF", "PG", "PN",
           "PW", "SB", "TK", "TO", "TV", "VU", "WF", "WS"}
# Region -> (members, maybe). "maybe" are countries some employers count in the
# region and others do not: a FLAG to check, never a PASS or a FAIL.
REGIONS = {
    "eu": (EU_EEA, set()), "eea": (EU_EEA, set()), "europe": (EUROPE, CAUCASUS | {"TR", "CY", "RU"}),
    "africa": (AFRICA, set()), "asia": (ASIA, MIDDLE_EAST | CAUCASUS),
    "latin america": (LATAM, CARIBBEAN), "latam": (LATAM, CARIBBEAN), "south america": (LATAM - {"MX"}, set()),
    "north america": ({"US", "CA", "MX"}, CARIBBEAN), "oceania": (OCEANIA, set()),
    "middle east": (MIDDLE_EAST, {"EG", "PK", "AF"}),
    "emea": (EUROPE | AFRICA | MIDDLE_EAST, CAUCASUS | {"PK", "AF"} | CENTRAL_ASIA),
    "apac": (EAST_SE_ASIA | OCEANIA, SOUTH_ASIA | CENTRAL_ASIA),
    "americas": (LATAM | CARIBBEAN | {"US", "CA"}, set()),
}
WORLDWIDE = {"anywhere in the world", "worldwide", "anywhere", "global", "remote - worldwide"}


def resolve(token: str):
    """Return ('country', {code}) | ('region', (members, maybe)) | ('worldwide', None) | (None, None)."""
    t = _fold(token)
    if t in WORLDWIDE:
        return "worldwide", None
    if len(t) == 2 and t.upper() in COUNTRIES:
        return "country", {t.upper()}
    if t in NAME_TO_CODE:
        return "country", {NAME_TO_CODE[t]}
    if t in REGIONS:
        return "region", REGIONS[t]
    return None, None


def parse_country(value: str) -> str:
    kind, codes = resolve(value)
    if kind != "country":
        raise ValueError(f"unknown country {value!r}; use an ISO code such as PK")
    return next(iter(codes))


def location(job: dict, base: str, targets: set[str]) -> tuple[str | None, str | None, bool]:
    """Return (verdict, note, structured)."""
    tokens = []
    if isinstance(job.get("location_restrictions"), list):
        tokens += [t for t in job["location_restrictions"] if isinstance(t, str) and t.strip()]
        if not tokens and job.get("worldwide") is not False:
            return "PASS", None, True
    if isinstance(job.get("countries"), list):
        tokens += [t for t in job["countries"] if isinstance(t, str) and t.strip()]
    region = job.get("region").strip() if isinstance(job.get("region"), str) else ""
    if region and tokens and resolve(region)[0] == "worldwide":
        # We Work Remotely tags US data-centre roles "Anywhere in the World
        # (United States of America)": a worldwide label next to a country
        # list contradicts itself, so it is never a PASS on the label alone.
        codes = {c for t in tokens if resolve(t)[0] == "country" for c in resolve(t)[1]}
        if base in codes:
            return "PASS", None, True
        return "FLAG", f"says {region} but names {', '.join(tokens[:4])}; check whether {base} is eligible", True
    if not tokens and region:
        tokens.append(region)
    if job.get("worldwide") is True and not tokens:
        return "PASS", None, True
    if not tokens:
        return None, None, False

    allowed, maybe, unknown = set(), set(), []
    for token in tokens:
        kind, data = resolve(token)
        if kind == "worldwide":
            return "PASS", None, True
        if kind == "country":
            allowed |= data
        elif kind == "region":
            allowed |= data[0]
            maybe |= data[1]
        else:
            unknown.append(token.strip())
    shown = ", ".join(t.strip() for t in tokens[:6]) + (f" (+{len(tokens) - 6} more)" if len(tokens) > 6 else "")
    if base in allowed:
        return "PASS", None, True
    if base in maybe:
        return "FLAG", f"open to {shown}; unclear whether that includes {base} - check with the employer", True
    open_targets = sorted(targets & allowed)
    if open_targets:
        return "FLAG", (f"relocation needed: open to {shown}, excludes base {base}; "
                        f"target {', '.join(open_targets)} - the Visa & Relocation Gate decides"), True
    if unknown:
        return "FLAG", f"unrecognised location {', '.join(unknown[:3])!s}; check whether {base} is eligible", True
    return "FAIL", f"restricted to {shown}; excludes base {base} and every target country", True


def timezone(job: dict, offset: float, tolerance: float) -> tuple[str | None, str | None]:
    offsets = [o for o in job.get("timezone_restrictions") or [] if isinstance(o, (int, float)) and not isinstance(o, bool)]
    if not offsets:
        return None, None
    # Compare with the nearest listed offset, not the min-max range: US lists
    # carry UTC+14 (Pacific islands) next to UTC-10..-5, and a range would
    # then cover every time zone on Earth.
    nearest = min(offsets, key=lambda o: abs(o - offset))
    gap = abs(nearest - offset)
    if gap <= tolerance:
        return "PASS", None
    return "FLAG", f"allowed time zones {bands(offsets)}; base UTC{offset:+g} is {gap:g}h from the closest"


def bands(offsets: list) -> str:
    """[-10, -9, ..., -5, 14] -> 'UTC-10 to UTC-5, UTC+14' (runs at most 1h apart are merged)."""
    runs: list[list] = []
    for o in sorted(set(offsets)):
        if runs and o - runs[-1][1] <= 1:
            runs[-1][1] = o
        else:
            runs.append([o, o])
    fmt = lambda o: f"UTC{o:+g}"
    return ", ".join(fmt(a) if a == b else f"{fmt(a)} to {fmt(b)}" for a, b in runs)


def evaluate(jobs: list, base: str, targets: set[str], offset: float, tolerance: float) -> list[dict]:
    out = []
    for job in jobs:
        if not isinstance(job, dict):
            raise ValueError("every job must be an object")
        verdict, note, structured = location(job, base, targets)
        tz_verdict, tz_note = timezone(job, offset, tolerance)
        out.append({
            **{k: job.get(k) for k in ("key", "url", "title", "company") if k in job},
            "location_verdict": verdict, "location_note": note,
            "timezone_verdict": tz_verdict, "timezone_note": tz_note,
            "decided_by": "rules" if structured else "unstructured",
        })
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--jobs", type=Path, required=True)
    parser.add_argument("--base", required=True, help="base country, ISO code or name")
    parser.add_argument("--targets", default="", help="comma-separated target countries")
    parser.add_argument("--utc-offset", type=float, required=True)
    parser.add_argument("--tz-tolerance", type=float, default=1.0)
    args = parser.parse_args()
    try:
        base = parse_country(args.base)
        targets = {parse_country(t) for t in args.targets.split(",") if t.strip()} - {base}
        data = json.loads(args.jobs.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data = data.get("results")
        if not isinstance(data, list):
            raise ValueError("jobs must be a JSON array")
        print(json.dumps(evaluate(data, base, targets, args.utc_offset, args.tz_tolerance), indent=2, ensure_ascii=False))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"eligibility: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
