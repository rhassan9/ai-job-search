#!/usr/bin/env python3
"""State helper for /rank: select candidates and write results back.

/rank reads the whole of seen_jobs.json into the model's context to filter it
by eye (Step 1), then re-emits the whole file to record scores (Step 4). That
cost is paid on every run regardless of how many jobs are actually scored, and
it grows for the life of the workspace, since seen_jobs.json is append-only by
design and most stored entries are `skipped`.

This moves the state-file traffic into code. Three subcommands:

  candidates   select the eligible entries for this run and project only the
               fields a scoring agent needs
  sweep        rule 6's expiry pass over entries this run did not re-score -
               a stored-date comparison, no fetch, no agent
  apply        write scoring results back to seen_jobs.json and print the
               ranked/vetoed/expired/unreachable/gave_up rows Step 5's
               report is built from

Selection and projection follow Step 1's existing rules exactly (status
filter, tracker exclusion, focus filter, `--limit`/`--all`); the write-back
follows Step 4's existing rules exactly (the `location` -> `location_verdict`
legacy migration, the deadline null-is-not-a-correction rule, verbatim
strengths/gaps persistence, idempotent skip of already-ranked entries); the
sweep follows rule 6 exactly (defensive date parsing, an absent deadline left
alone, `--all` making a retired entry revivable).

Nothing here fetches a posting or judges a fit. Scoring stays with the model;
this only removes the state file from the conversation.

Usage:
  python3 tools/rank_state.py candidates [--all] [--focus TEXT] [--limit N]
  python3 tools/rank_state.py sweep [--write] [--exclude KEY,KEY]
  python3 tools/rank_state.py apply --results results.json [--dry-run] [--now ISO-DATETIME]

Both subcommands print JSON on stdout. Exit 0 on success, 1 on a usage or
state error, or on `apply` when any result could not be written.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "job_scraper" / "seen_jobs.json"
TRACKER = ROOT / "job_search_tracker.csv"

# 04-job-evaluation.md
WEIGHTS = {"technical": 0.30, "experience": 0.25, "behavioral": 0.15, "career": 0.30}
BANDS = ((75, "Strong Fit"), (60, "Good Fit"), (45, "Moderate Fit"), (30, "Weak Fit"), (0, "Poor Fit"))

DEFAULT_LIMIT = 10
URGENT_DAYS = 7
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The statuses a /rank scoring agent may return (rank.md Step 2). This module
# owns the set; tests/test_rank_command.py asserts rank.md's JSON contract
# names exactly these, so the spec and the tool cannot drift apart.
AGENT_STATUSES = ("scored", "expired", "unreachable")

# The values the two veto gates may take (rank.md Step 2). Step 5's veto is an
# exact match on "FAIL", so any other spelling would shortlist a deal-breaker.
GATE_VERDICTS = ("PASS", "FAIL", "FLAG")

# The Visa & Relocation Gate (04-job-evaluation.md). The verdict is a pure
# function of the class, so the tool derives it rather than trusting the
# agent's: an agent cannot pair `no_sponsorship` with PASS.
VISA_GATE_BY_CLASS = {
    "not_applicable": "PASS",
    "sponsorship_confirmed": "PASS",
    "relocation_and_sponsorship": "PASS",
    "relocation_sponsorship_unclear": "FLAG",
    "job_seeker_route": "FLAG",
    "not_specified": "FLAG",
    "no_sponsorship": "FAIL",
    "work_permit_required": "FAIL",
}
VISA_CONFIDENCE = ("high", "medium", "low")
# Classes whose evidence is not a statement by the employer.
VISA_NO_QUOTE_NEEDED = ("not_specified", "job_seeker_route")
VISA_HISTORY_MAX = 5


def classify_visa(visa_class: str, evidence) -> tuple[str, str, dict | None]:
    """Apply the gate's evidence rules deterministically; return (class, gate, evidence).

    - `not_applicable` carries no evidence.
    - Every class that rests on what the employer said needs a verbatim quote;
      without one the class falls back to `not_specified` (rule 2: evidence or
      nothing). `job_seeker_route` rests on the candidate's own recorded route,
      so a silent posting has nothing to quote and keeps its class.
    - A `low`-confidence quote can never produce a PASS class: relocation plus
      sponsorship becomes `relocation_sponsorship_unclear`, confirmed
      sponsorship becomes `not_specified`.
    Evidence text is untrusted posting data: stored as capped plain text.
    """
    if visa_class == "not_applicable":
        return visa_class, "PASS", None
    ev = evidence if isinstance(evidence, dict) else {}
    quote = ev.get("quote").strip()[:300] if isinstance(ev.get("quote"), str) else ""
    source = ev.get("source").strip()[:500] if isinstance(ev.get("source"), str) else ""
    confidence = ev.get("confidence") if ev.get("confidence") in VISA_CONFIDENCE else "low"
    if visa_class not in VISA_NO_QUOTE_NEEDED and not quote:
        visa_class = "not_specified"
    if confidence == "low" and VISA_GATE_BY_CLASS[visa_class] == "PASS":
        visa_class = "relocation_sponsorship_unclear" if visa_class == "relocation_and_sponsorship" else "not_specified"
    record = {"quote": quote, "source": source or None, "confidence": confidence}
    return visa_class, VISA_GATE_BY_CLASS[visa_class], record

# Posting facts: the scoring agent extracts a few structured facts per
# posting; they are normalised here and stored as `facts` for /upskill's
# market trends. Change tracking uses posting_guard's text hash instead (see
# cmd_apply), because extraction varies between runs.
FACT_SKILLS_MAX = 20
CHANGE_HISTORY_MAX = 5
COUNTRY_CODE = re.compile(r"^[A-Za-z]{2}$")
TEXT_HASH = re.compile(r"^[0-9a-f]{16}$")
# One spelling per skill, so market trends count "AWS" and "Amazon Web Services"
# once. Seen varying between scoring runs on the same posting (2026-11-18).
SKILL_ALIASES = {k: v for v, ks in {
    "AWS": ["amazon web services", "aws cloud"], "Amazon RDS": ["aws rds", "rds"],
    "Amazon ECS": ["amazon elastic container service", "aws ecs", "ecs"], "Amazon S3": ["aws s3", "s3"],
    "GCP": ["google cloud platform", "google cloud"], "BigQuery": ["google bigquery"], "Azure": ["microsoft azure"],
    "Azure Data Factory": ["adf", "data factory"], "Azure Active Directory": ["aad", "azure ad", "microsoft entra id", "entra id"],
    "Azure SQL": ["azure sql database"], "Azure Data Lake Storage": ["azure data lake storage gen2", "adls", "adls gen2", "azure data lake gen2"],
    "Spark": ["apache spark"], "Airflow": ["apache airflow"], "Kafka": ["apache kafka"], "dbt": ["data build tool"],
    "Power BI": ["powerbi", "microsoft power bi"], "Microsoft Fabric": ["fabric", "ms fabric"],
    "MLOps": ["machine learning operations"], "Infrastructure as Code": ["iac", "infrastructure as code (iac)"],
    "Kubernetes": ["k8s"], "PostgreSQL": ["postgres"], "Data modelling": ["data modeling"],
    "Medallion architecture": ["medallion architecture (bronze, silver, and gold layers)", "medaillon-paradigmen"],
}.items() for k in ks}


def normalize_facts(facts) -> dict | None:
    """Return the agent's facts as bounded plain values, or None when absent."""
    if not isinstance(facts, dict):
        return None
    out: dict = {}
    skills = facts.get("skills")
    if isinstance(skills, list):
        keep: dict[str, str] = {}
        for skill in skills:
            if isinstance(skill, str):
                text = " ".join(skill.split())[:40]
                text = SKILL_ALIASES.get(text.casefold(), text)
                if text:
                    keep.setdefault(text.casefold(), text)
        out["skills"] = sorted(keep.values(), key=str.casefold)[:FACT_SKILLS_MAX]
    country = facts.get("country")
    if isinstance(country, str) and COUNTRY_CODE.match(country.strip()):
        out["country"] = country.strip().upper()
    years = facts.get("years_required")
    if isinstance(years, (int, float)) and not isinstance(years, bool) and 0 <= years <= 40:
        out["years_required"] = int(years) if float(years).is_integer() else round(years * 2) / 2  # "4.5+ years"
    for field in ("salary", "remote_scope"):
        value = facts.get(field)
        if isinstance(value, str) and value.strip():
            out[field] = " ".join(value.split())[:120]
    return out


def score_parts(scores: dict, gates) -> dict:
    """The three-score display: technical, role fit, eligibility. Display only:
    the overall score and the vetoes are unchanged."""
    rest = {d: w for d, w in WEIGHTS.items() if d != "technical"}
    role = sum(Fraction(str(scores[d])) * Fraction(str(w)) for d, w in rest.items()) / sum(
        Fraction(str(w)) for w in rest.values()
    )
    present = [g for g in gates if g]
    eligibility = "FAIL" if "FAIL" in present else "FLAG" if "FLAG" in present else "PASS"
    return {"technical": int(Fraction(str(scores["technical"])) + Fraction(1, 2)),
            "role_fit": int(role + Fraction(1, 2)), "eligibility": eligibility}


# A posting that could not be fetched is `unreachable`, not `expired`, and is
# retried on later runs (#534). It gives up to `expired` only after this many
# failed attempts with at least this long between the first and the last, so a
# scheduled run plus a manual one on the same day cannot burn every attempt on
# one outage.
UNREACHABLE_MAX_ATTEMPTS = 3
UNREACHABLE_MIN_SPAN = timedelta(hours=48)
FETCH_ERROR_MAX = 200
RETRY_FIELDS = ("fetch_attempts", "first_unreachable", "last_fetch_error")
TIMESTAMP = "%Y-%m-%dT%H:%M:%SZ"


def load_state(path: Path) -> tuple[dict, dict]:
    """Return (document, seen-map). The map is mutated in place by callers."""
    if not path.is_file():
        sys.exit(f"{path} not found - run /scrape first")
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sys.exit(f"{path} is not valid JSON: {exc}")
    seen = doc.get("seen") if isinstance(doc, dict) and "seen" in doc else doc
    if not isinstance(seen, dict):
        sys.exit(f"{path}: expected an object of job entries")
    for key, value in seen.items():
        if not isinstance(value, dict):
            sys.exit(f"{path}: entry is not an object: {key}")
    return doc, seen


def save_state(path: Path, doc: dict) -> None:
    """Atomic replace: a half-written seen_jobs.json loses the scrape history."""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".seen_jobs.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def parse_timestamp(value) -> datetime | None:
    """A stored UTC timestamp, or None for anything else (absent, malformed, a
    bare date) - the defensive-parse rule again: never compared, never guessed."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.strptime(value.strip(), TIMESTAMP)
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc)


def parse_now(value: str) -> datetime:
    """--now: an ISO 8601 date-time; a naive value is taken as UTC."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def parse_iso(value) -> date | None:
    """Rule 6's defensive-parse rule: anything that is not YYYY-MM-DD is treated
    exactly like an absent value - never compared, never guessed at."""
    if not isinstance(value, str) or not ISO.match(value.strip()):
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def norm(text) -> str:
    """Ignore case and separators without discarding non-Latin identity."""
    text = unicodedata.normalize("NFC", str(text or "").casefold())
    # Combining marks can distinguish names even after NFC (e.g. Indic vowels).
    return "".join(
        char for char in text
        # "+" and "#" carry identity: "C++", "C#" and "C" are different jobs.
        if char.isalnum() or char in "+#" or unicodedata.category(char).startswith("M")
    )


def tracker_pairs(path: Path) -> set[tuple[str, str]]:
    """company+role pairs already in the tracker - out of scope for ranking."""
    if not path.is_file():
        return set()
    import csv

    pairs = set()
    try:
        with path.open(encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                company, role = norm(row.get("company")), norm(row.get("role"))
                if company:
                    pairs.add((company, role))
    except UnicodeDecodeError:
        # A spreadsheet's plain "CSV" save writes the ANSI code page (cp1252 on
        # most Western installs), so any accented company name stops decoding.
        sys.exit(f"{path} is not UTF-8 text - re-save it as CSV UTF-8")
    return pairs


def entry_location_verdict(entry: dict) -> str | None:
    """location_verdict, falling back to a legacy verdict stored under `location`
    (Step 4: "an entry ranked before this rename may carry a legacy PASS/FAIL/
    FLAG string in `location`")."""
    verdict = entry.get("location_verdict")
    if verdict:
        return verdict
    legacy = entry.get("location")
    return legacy if legacy in ("PASS", "FAIL", "FLAG") else None


def cmd_candidates(args) -> int:
    _, seen = load_state(args.state)
    excluded = tracker_pairs(args.tracker)

    selected, skipped_tracker = [], 0
    for key, entry in seen.items():
        status = entry.get("status")
        if args.all:
            if status == "skipped":
                continue
        elif status not in ("new", "unreachable"):
            continue
        if (norm(entry.get("company")), norm(entry.get("title"))) in excluded:
            skipped_tracker += 1
            continue
        if args.focus:
            haystack = " ".join(
                [str(entry.get("title") or ""), str(entry.get("company") or "")]
                + [str(b) for b in entry.get("strengths") or []]
                + [str(b) for b in entry.get("gaps") or []]
            ).lower()
            if args.focus.lower() not in haystack:
                continue
        selected.append(
            {
                "key": key,
                "title": entry.get("title"),
                "company": entry.get("company"),
                "url": entry.get("url"),
                "portal": entry.get("portal"),
                "deadline": entry.get("deadline"),
                "posted_date": entry.get("posted_date"),
            }
        )

    eligible = len(selected)
    if args.limit > 0:
        selected = selected[: args.limit]
    print(
        json.dumps(
            {
                "eligible": eligible,
                "selected": selected,
                "deferred": max(0, eligible - len(selected)),
                "excluded_by_tracker": skipped_tracker,
                "total_entries": len(seen),
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


def cmd_sweep(args) -> int:
    doc, seen = load_state(args.state)
    today = args.today
    # "a_b, c_d" is as natural a comma-separated list as "a_b,c_d"; keys never
    # carry surrounding whitespace, so a space must not un-exclude a key.
    exclude = {k.strip() for k in (args.exclude or "").split(",") if k.strip()}

    expired, closing, unparseable, checked = [], [], [], 0
    for key, entry in seen.items():
        if entry.get("status") != "ranked" or key in exclude:
            continue
        checked += 1
        raw = entry.get("deadline")
        if raw in (None, ""):
            continue
        parsed = parse_iso(raw)
        if parsed is None:
            unparseable.append({"key": key, "portal": entry.get("portal"), "deadline": raw})
            continue
        row = {
            "key": key,
            "title": entry.get("title"),
            "company": entry.get("company"),
            "url": entry.get("url"),
            "deadline": raw,
        }
        if parsed < today:
            expired.append(row)
        elif (parsed - today).days <= URGENT_DAYS:
            closing.append(row)

    if args.write and expired:
        for row in expired:
            seen[row["key"]]["status"] = "expired"
        save_state(args.state, doc)

    print(
        json.dumps(
            {
                "swept": checked,
                "newly_expired": expired,
                "closing_soon": sorted(closing, key=lambda r: r["deadline"]),
                "unparseable_deadlines": unparseable,
                "written": bool(args.write and expired),
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


def overall_score(scores: dict) -> int:
    if not isinstance(scores, dict):
        raise ValueError("scores must be an object")
    total = Fraction(0)
    for dim, weight in WEIGHTS.items():
        value = scores.get(dim)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"missing or non-numeric score '{dim}'")
        if not 0 <= value <= 100:
            raise ValueError(f"score '{dim}' must be finite and between 0 and 100")
        # Scores and documented percentage weights are decimal quantities.
        # Binary float summation can turn 59.5 into 59.49999999999999 and drop
        # an otherwise valid result into the lower verdict band.
        total += Fraction(str(value)) * Fraction(str(weight))
    return int(total + Fraction(1, 2))


def band(score: int) -> str:
    for floor, name in BANDS:
        if score >= floor:
            return name
    return "Poor Fit"


def cmd_apply(args) -> int:
    doc, seen = load_state(args.state)
    today = args.today
    now = args.now
    try:
        results = json.loads(Path(args.results).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"cannot read results file {args.results}: {exc}")
    if isinstance(results, dict):
        results = results.get("results", [])
    if not isinstance(results, list):
        sys.exit("results file must be a JSON array of scoring objects")

    rows, expired, unreachable, gave_up, errors = [], [], [], [], []
    for result in results:
        if not isinstance(result, dict):
            errors.append({"key": None, "error": "result is not an object"})
            continue
        key = result.get("key")
        entry = seen.get(key) if isinstance(key, str) else None
        if entry is None:
            errors.append({"key": key, "error": "no such key in seen_jobs.json"})
            continue

        # A missing status is a score, as it always was; a misspelt one is an
        # error rather than a fall-through that reports a "missing score".
        status = result.get("status", "scored")
        if status not in AGENT_STATUSES:
            errors.append(
                {"key": key, "error": f"unknown status {status!r}; expected one of {', '.join(AGENT_STATUSES)}"}
            )
            continue

        if status == "unreachable":
            # A stored deadline that has already passed is positive evidence the
            # posting is closed, whatever the fetch did: expire it, as the scored
            # path and rule 6 would, instead of retrying it and later listing it
            # as possibly live.
            deadline = parse_iso(entry.get("deadline"))
            if deadline is not None and deadline < today:
                entry["status"] = "expired"
                for field in (*RETRY_FIELDS, "expired_reason"):
                    entry.pop(field, None)
                expired.append(
                    {"key": key, "title": entry.get("title"), "company": entry.get("company"), "url": entry.get("url")}
                )
                continue

            previous = entry.get("fetch_attempts")
            valid = isinstance(previous, int) and not isinstance(previous, bool)
            attempts = (previous if valid else 0) + 1
            first = parse_timestamp(entry.get("first_unreachable")) or now
            # Plain, bounded text: it is shown in the report, never acted on.
            error = " ".join(str(result.get("fetch_error") or "").split())[:FETCH_ERROR_MAX]
            entry["fetch_attempts"] = attempts
            entry["first_unreachable"] = first.strftime(TIMESTAMP)
            if error:
                entry["last_fetch_error"] = error
            row = {
                "key": key,
                "title": entry.get("title"),
                "company": entry.get("company"),
                "url": entry.get("url"),
                "fetch_attempts": attempts,
                "last_fetch_error": entry.get("last_fetch_error"),
            }
            if attempts >= UNREACHABLE_MAX_ATTEMPTS and now - first >= UNREACHABLE_MIN_SPAN:
                # The retry fields stay on the entry as its history; `--all`
                # can still revive it, like any other expired entry.
                entry["status"] = "expired"
                entry["expired_reason"] = "unreachable"
                gave_up.append(row)
            else:
                entry["status"] = "unreachable"
                unreachable.append(row)
            continue

        if status == "expired":
            entry["status"] = "expired"
            for field in (*RETRY_FIELDS, "expired_reason"):
                entry.pop(field, None)
            expired.append(
                {"key": key, "title": entry.get("title"), "company": entry.get("company"), "url": entry.get("url")}
            )
            continue

        try:
            score = overall_score(result.get("scores") or {})
        except ValueError as exc:
            errors.append({"key": key, "error": str(exc)})
            continue
        bad_gate = next(
            (f for f in ("location_verdict", "language_gate", "visa_gate") if result.get(f) and result[f] not in GATE_VERDICTS),
            None,
        )
        if bad_gate:
            errors.append(
                {"key": key, "error": f"unknown {bad_gate} {result[bad_gate]!r}; expected one of {', '.join(GATE_VERDICTS)}"}
            )
            continue
        if result.get("visa_class") is not None and result["visa_class"] not in VISA_GATE_BY_CLASS:
            errors.append(
                {"key": key, "error": f"unknown visa_class {result['visa_class']!r}; expected one of {', '.join(VISA_GATE_BY_CLASS)}"}
            )
            continue

        # A missing deadline from the fresh fetch is not a correction to the
        # stored date. Scored keys are excluded from the later sweep, so apply
        # must retire a passed deadline before updating any ranking metadata.
        parsed = parse_iso(result.get("deadline") or entry.get("deadline"))
        if parsed is not None and parsed < today:
            entry["status"] = "expired"
            for field in (*RETRY_FIELDS, "expired_reason"):
                entry.pop(field, None)  # fetched after all: closed on its deadline
            if result.get("deadline"):
                entry["deadline"] = result["deadline"]
            expired.append(
                {"key": key, "title": entry.get("title"), "company": entry.get("company"), "url": entry.get("url")}
            )
            continue

        was_expired = entry.get("status") == "expired"
        prev_visa_class, prev_deadline = entry.get("visa_class"), entry.get("deadline")
        legacy = entry_location_verdict(entry)
        if entry.get("location") in ("PASS", "FAIL", "FLAG"):
            entry.pop("location", None)  # legacy verdict, never a place
        for field in (*RETRY_FIELDS, "expired_reason"):
            entry.pop(field, None)  # fetched after all: the retry history is moot
        entry["status"] = "ranked"
        entry["rank_score"] = score
        entry["rank_verdict"] = band(score)
        entry["rank_date"] = today.isoformat()
        entry["location_verdict"] = result.get("location_verdict") or legacy or "PASS"
        # Why a location verdict is not PASS - for a remote posting, the quoted
        # restriction ("US residents only") next to the profile's base country.
        # Untrusted posting text: stored as plain text, capped, never acted on.
        location_note = result.get("location_note")
        if entry["location_verdict"] != "PASS" and isinstance(location_note, str) and location_note.strip():
            entry["location_note"] = location_note.strip()[:200]
        else:
            entry.pop("location_note", None)
        entry["language_gate"] = result.get("language_gate") or "PASS"
        if entry["language_gate"] == "PASS":
            entry.pop("language_note", None)
        else:
            entry["language_note"] = result.get("language_note")
        # Visa & Relocation Gate. An agent on an older prompt returns no class:
        # absence is not a correction, so stored visa fields are left alone.
        if result.get("visa_class"):
            visa_class, visa_gate, evidence = classify_visa(result["visa_class"], result.get("visa_evidence"))
            if evidence is not None:
                evidence["verified"] = today.isoformat()
            previous = entry.get("visa_class")
            if previous and previous != visa_class:
                old = {"visa_class": previous, "visa_gate": entry.get("visa_gate")}
                if isinstance(entry.get("visa_evidence"), dict):
                    old.update(entry["visa_evidence"])
                history = entry.get("visa_history") if isinstance(entry.get("visa_history"), list) else []
                entry["visa_history"] = [old, *history][:VISA_HISTORY_MAX]
            entry["visa_class"] = visa_class
            entry["visa_gate"] = visa_gate
            if evidence is None:
                entry.pop("visa_evidence", None)
            else:
                entry["visa_evidence"] = evidence
        # Absence is not a correction: a fetch that degraded to a listing page
        # returns no deadline, and blanking a stored one would erase a real
        # date and make the entry immortal to rule 6's sweep.
        if result.get("deadline"):
            entry["deadline"] = result["deadline"]
        # Change tracking rests on text_hash alone: posting_guard's hash of the
        # cleaned posting text, sent only when the text came from a portal CLI
        # or fetch_page.py (both byte-stable; WebFetch returns a model summary
        # and sends none). Extracted facts are NOT compared: re-scoring the same
        # 8 live postings gave identical hashes but only 50-90% skill overlap,
        # so a facts comparison flagged every unchanged posting as edited.
        # A new hash records `description` plus the stored fields that changed
        # with it (deadline, visa_class), keeping the old facts as `previous`.
        # Same hash: the stored facts are kept, so trends do not drift on noise.
        # Absence of a hash or of facts (WebFetch, an older prompt) is not a
        # correction and records nothing.
        entry["last_verified"] = today.isoformat()
        change = None
        facts = normalize_facts(result.get("facts"))
        text_hash = result.get("text_hash") if isinstance(result.get("text_hash"), str) and TEXT_HASH.match(result["text_hash"]) else None
        old_hash = entry.get("text_hash")
        old_facts = entry.get("facts") if isinstance(entry.get("facts"), dict) else None
        if text_hash and old_hash:
            if text_hash != old_hash:
                fields = ["description"] + [f for f, old in (("deadline", prev_deadline), ("visa_class", prev_visa_class))
                                            if old != entry.get(f)]
                previous = {f: old for f, old in (("deadline", prev_deadline), ("visa_class", prev_visa_class))
                            if f in fields}
                if old_facts:
                    previous["facts"] = old_facts
                change = {"date": today.isoformat(), "basis": "text", "changed": fields, "previous": previous}
            elif old_facts:
                facts = None  # same text: a different extraction is noise
        if facts is not None:
            entry["facts"] = facts
        if text_hash:
            entry["text_hash"] = text_hash
        entry.setdefault("first_verified", today.isoformat())
        if was_expired:
            change = change or {"date": today.isoformat(), "basis": "status", "changed": [], "previous": {}}
            change["changed"] = ["reopened", *change["changed"]]
        if change:
            history = entry.get("changes") if isinstance(entry.get("changes"), list) else []
            entry["changes"] = [change, *history][:CHANGE_HISTORY_MAX]
        for field in ("strengths", "gaps"):
            value = result.get(field)
            if isinstance(value, list):
                entry[field] = [str(b) for b in value][:3]
        # The scoring agent's posting_guard verdict line ("clean" or the ⚠ line).
        # Additive and optional: an agent on an older prompt returns none, and
        # nothing is written. Stored so a later reader can see why a row carried
        # a marker without re-fetching the posting.
        # Normalised so Step 5's "anything other than clean" rule holds whether
        # the agent returned "clean" or the gate's first line verbatim: any clean
        # verdict (with or without its context parenthetical) stores as "clean";
        # a ⚠ verdict stores without the "posting_guard:" prefix. A rescoring
        # result without a guard drops a stale one - absence means "not run",
        # and last run's verdict would mislabel this run's fetch.
        guard = result.get("guard")
        if isinstance(guard, str) and guard.strip():
            text = guard.strip()
            if text.lower().startswith("posting_guard:"):
                text = text[len("posting_guard:"):].strip()
            entry["guard"] = "clean" if text.lower().startswith("clean") else text[:200]
        else:
            entry.pop("guard", None)

        rows.append(
            {
                "key": key,
                "title": entry.get("title"),
                "company": entry.get("company"),
                "location": entry.get("location"),
                "url": entry.get("url"),
                "score": score,
                "verdict": entry["rank_verdict"],
                "location_verdict": entry["location_verdict"],
                "location_note": entry.get("location_note"),
                "language_gate": entry["language_gate"],
                "language_note": entry.get("language_note"),
                "visa_gate": entry.get("visa_gate"),
                "visa_class": entry.get("visa_class"),
                "visa_evidence": entry.get("visa_evidence"),
                "deadline": entry.get("deadline"),
                "posted_date": entry.get("posted_date"),
                "urgent": bool(parsed and today <= parsed <= today + timedelta(days=URGENT_DAYS)),
                "strengths": entry.get("strengths", []),
                "gaps": entry.get("gaps", []),
                "guard": entry.get("guard"),
                "score_parts": score_parts(
                    result["scores"], (entry["location_verdict"], entry["language_gate"], entry.get("visa_gate"))
                ),
                "changed": change["changed"] if change else None,
                "change_basis": change["basis"] if change else None,
                "last_verified": entry["last_verified"],
            }
        )

    if not args.dry_run:
        save_state(args.state, doc)

    rows.sort(key=lambda r: (r["score"], r["urgent"]), reverse=True)
    veto = lambda r: r["location_verdict"] == "FAIL" or r["language_gate"] == "FAIL" or r["visa_gate"] == "FAIL"
    vetoed = [r for r in rows if veto(r)]
    ranked = [r for r in rows if not veto(r)]
    print(
        json.dumps(
            {
                "ranked": ranked,
                "vetoed": vetoed,
                "expired": expired,
                "unreachable": unreachable,
                "gave_up": gave_up,
                "errors": errors,
                "written": not args.dry_run,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 1 if errors else 0


def _force_utf8_output() -> None:
    """Write UTF-8 whatever the host's default encoding is.

    A piped stdout on Windows defaults to the ANSI code page (cp1252 on most
    Western installs), so printing a company, title or file name outside it
    raised UnicodeEncodeError before the workflow saw any output.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)  # absent on a StringIO under test
        if reconfigure:
            reconfigure(encoding="utf-8")


def main() -> int:
    _force_utf8_output()
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--state", type=Path, default=STATE)
    common.add_argument("--today", type=date.fromisoformat, default=date.today())
    common.add_argument(
        "--now", type=parse_now, default=datetime.now(timezone.utc),
        help="date-time for the unreachable retry floor (default: now, UTC)",
    )

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="command", required=True)

    cand = sub.add_parser("candidates", parents=[common], help="select the entries to score")
    cand.add_argument("--tracker", type=Path, default=TRACKER)
    cand.add_argument("--all", action="store_true", help="include every non-skipped status")
    cand.add_argument("--focus", help="substring filter over title, company and stored fit notes")
    cand.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="0 for no cap")
    cand.set_defaults(func=cmd_candidates)

    sweep = sub.add_parser("sweep", parents=[common], help="rule 6's expiry pass, no fetch")
    sweep.add_argument("--write", action="store_true", help="persist the expiries")
    sweep.add_argument("--exclude", help="comma-separated keys re-scored this run")
    sweep.set_defaults(func=cmd_sweep)

    app = sub.add_parser("apply", parents=[common], help="write scoring results back and print the ranking")
    app.add_argument("--results", required=True, help="JSON array from the scoring agents")
    app.add_argument("--dry-run", action="store_true")
    app.set_defaults(func=cmd_apply)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
