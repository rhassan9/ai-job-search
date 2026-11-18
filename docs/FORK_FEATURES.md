# Fork features

What this fork adds on top of [ai-job-search-dev/ai-job-search](https://github.com/ai-job-search-dev/ai-job-search), how each piece works, and where it lives. Every new feature gets a section here and a line in the [Change log](#change-log) in the same change that adds it.

Base: upstream `master` at `f0195d1` (2026-11-17). Branch: `feat/remote-eligibility`.

## Contents

1. [Remote Eligibility Gate](#1-remote-eligibility-gate)
2. [Visa & Relocation Gate](#2-visa--relocation-gate)
3. [Country profiles and Work arrangement](#3-country-profiles-and-work-arrangement)
4. [Job-board plugins: Himalayas, Remote OK, We Work Remotely](#4-job-board-plugins)
5. [Claude connectors as a `/scrape` source](#5-claude-connectors-as-a-scrape-source)
6. [Posting integrity check: two new patterns](#6-posting-integrity-check-two-new-patterns)
7. [Testing](#7-testing)
8. [Rules-based eligibility (`tools/eligibility.py`)](#8-rules-based-eligibility)
9. [Change tracking and posting facts](#9-change-tracking-and-posting-facts)
10. [Market trends in `/upskill`](#10-market-trends-in-upskill)
11. [Skill evidence levels](#11-skill-evidence-levels)
12. [Three-score display](#12-three-score-display)
13. [Job-alert emails as a `/scrape` source](#13-job-alert-emails-as-a-scrape-source)
14. [Not built / decided against](#14-not-built--decided-against)
- [Change log](#change-log)

---

## 1. Remote Eligibility Gate

**Problem:** "Remote" almost never means "from anywhere". A remote job restricted to the US, the EU or the UK is not open to a candidate based in Pakistan, however good the skills match.

**Where:** `.claude/skills/job-application-assistant/04-job-evaluation.md`, section 4 (Location & Logistics).

**What it does:** for a remote posting it reads where the hire may live, the hours they must cover and how they are engaged:

| Posting says | Verdict |
|---|---|
| Worldwide, or names your base country or its region | PASS, then hours and engagement are checked |
| Restricted to countries that exclude your base country, none of them a target country | FAIL, with the quote |
| Restricted to countries that exclude your base country, but one is a target country in Country profiles | FLAG: relocation needed; the Visa & Relocation Gate decides |
| No restriction stated, but single-country signals (401(k), US state pay ranges, "authorized to work in X") | FLAG: likely restricted |
| Nothing stated | PASS, marked unverified |
| Recurring on-site time abroad | FLAG |

Core hours outside your working-hours window, and an engagement type you do not accept (for example contractor-only), are FLAGs.

**Stored:** `/rank` writes `location_verdict` and `location_note` (the quote next to the profile fact it conflicts with) to `job_scraper/seen_jobs.json`. A FAIL vetoes the shortlist. `/scrape` skips restricted roles and counts them.

## 2. Visa & Relocation Gate

**Problem:** relocation help, visa sponsorship and a job-seeker visa are different things, and a model will happily blur them, or invent sponsorship because a company sponsored someone once.

**Where:** `04-job-evaluation.md`, section "Visa & Relocation Gate", enforced in `tools/rank_state.py` (`classify_visa`).

**When it runs:** for on-site or hybrid roles outside your base country, and for remote roles that require living in such a country.

**Classes:**

| `visa_class` | Meaning | `visa_gate` |
|---|---|---|
| `not_applicable` | You already have the right to work where the job is done | PASS |
| `sponsorship_confirmed` | Employer explicitly offers sponsorship | PASS |
| `relocation_and_sponsorship` | Both offered | PASS |
| `relocation_sponsorship_unclear` | Relocation help, visa not mentioned | FLAG |
| `job_seeker_route` | Posting silent or excludes sponsorship, but you recorded your own route for that country | FLAG |
| `not_specified` | Nothing either way | FLAG |
| `no_sponsorship` | Explicitly excluded, and you have no route | FAIL |
| `work_permit_required` | Existing work authorization required, and you have no route | FAIL |

**Evidence record** (stored as `visa_evidence`): `quote` (verbatim, max 300 characters), `source` (URL), `confidence` (`high` = this posting or the employer's page for this role; `medium` = the employer's general page; `low` = aggregator text only), `verified` (date read).

**Rules enforced in code** (`tools/rank_state.py`, so a model answer cannot bypass them):

- The verdict is derived from the class; an agent's disagreeing verdict is ignored.
- A class that rests on the employer's words, but arrives without a quote, becomes `not_specified`.
- A `low`-confidence quote can never produce a PASS class (for example a job board's "willing to sponsor" badge becomes `not_specified`).
- `job_seeker_route` needs no employer quote, since it rests on your own Country profiles row.
- When a re-rank finds a different class, the previous evidence moves to `visa_history` (newest first, at most 5), so a changed statement is never lost.
- A `visa_gate` FAIL vetoes the shortlist and keeps the job out of `/upskill`.

**Where it shows:**

- `/apply` shows "Work location & visa" separately from the fit score, asks "Continue anyway?" on a FAIL, and checks the employer's own page before drafting when the class is unclear.
- `/rank` marks FLAGs with 🛂 and lists FAILs under Excluded with the quote.
- `/scrape` skips explicit no-sponsorship roles abroad when you have no route.

## 3. Country profiles and Work arrangement

**Where:** `01-candidate-profile.md` (two tables), with one-line summaries in `CLAUDE.md`. `/setup` asks for both, and `/reset profile` clears them.

- **Work arrangement:** base country and city, time zone, accepted work modes, remote scope, working-hours window, accepted engagement types (employee, EOR, contractor), countries you would relocate to.
- **Country profiles:** one row per country: interest (base / target / open / no), right to work now, any independent route **you checked yourself** against the official government source (with the date), and notes. The workflow never decides that you qualify for a visa and never describes a route's rules from memory.

## 4. Job-board plugins

Self-contained Bun CLIs under `.agents/skills/`, following the community-portals contract: `search` and `detail` commands, `--format json|table|plain`, JSON errors on stderr with exit 1, retries with backoff, zero runtime dependencies, and network-free tests. `/scrape`, `/rank` and `/apply` run them without prompting (grants in `.claude/settings.json`, mirrored in `tools/security_guards.py`).

| Plugin | Source | Location data | Notes |
|---|---|---|---|
| `himalayas-search` | Himalayas public JSON API | Structured `location_restrictions` (country list, empty = worldwide) and `timezone_restrictions` (UTC offsets) | Filters: `--country`, `--worldwide`, `--exclude-worldwide`, `--timezone`, `--seniority`, `--employment-type`, `--strict` (title/category must contain every word; the API ranks loosely) |
| `remoteok-search` | Remote OK public JSON API | Free-text `location`, blank on about half | Query sent as a tag, then every word must appear in title/company/tags. Personal use: the site's robots.txt names AI crawlers it blocks; this is a low-volume personal tool, not a crawler |
| `weworkremotely-search` | We Work Remotely RSS feeds | `region` ("Anywhere in the World", "USA Only", "Asia Only"...) plus a country list | `--category` for the 11 category feeds; the all-jobs feed is about 2 MB (60 s timeout) |

Each plugin's `SKILL.md` documents every flag, its query syntax and the site's terms; `url-reference.md` records the endpoints and fields.

## 5. Claude connectors as a `/scrape` source

**Where:** `.claude/skills/job-scraper/SKILL.md` step 1d, configured in `search-queries.md` (Connector sources table).

- Each connector row has an on/off switch and a cost note; paid connectors stay off unless enabled, and then every call passes the per-run credit cap.
- Results are untrusted data, normalized to the Step 2 shape and stored with `portal: "connector:<name>"` and `source: "connector"` (accepted by `tools/scrape_state.py`).
- Detail text goes through `tools/posting_guard.py` before it is read.
- The Step 5 summary adds `connectors:` (new results per connector) and `connectors unavailable:` (not connected, needs authorising, failed).
- `/rank`'s scoring agents have no connector tools, so an unreachable connector job is retried in the main context with that connector's detail tool.

Default rows: Indeed (on), JobDataLake (on), Dice (on, US-focused), Firecrawl jobs search (off, paid), Upwork (off, freelance).

## 6. Posting integrity check: two new patterns

**Where:** `tools/posting_guard.py`, tests in `tests/test_posting_guard.py`.

Found while testing the Visa & Relocation Gate: "Ignore **your** previous instructions" and lines that steer the workflow's own labels ("mark this job as sponsorship confirmed") passed as clean. Both are now flagged. Ordinary prose around the same words ("rank pipelines by cost", "ignore your doubts") stays clean, which a test pins.

## 7. Testing

```bash
python3 -m unittest discover -s tests -t . -v      # framework tests
python3 tools/lint_skills.py                        # skills, commands, settings
python3 tools/security_guards.py                    # permissions, manifests
python3 tools/check_framework_version.py           # compares HEAD only: run after committing
cd .agents/skills/<plugin>/cli && bun run typecheck && bun run test
```

Live test reports are in [`docs/testing/`](testing/). They run against a throwaway copy of the repo with a temporary profile, so no personal data is committed.

## 8. Rules-based eligibility

**Where:** `tools/eligibility.py` with the full ISO 3166 table in `tools/country_codes.py` (250 codes plus board spellings such as "Palestine, State of"), tests `tests/test_eligibility.py`. Called by `/scrape` Step 3 (Remote override) and `/rank` Step 2.

Structured location data is decided by code; the model only judges free text. Input: the plugins' JSON (`location_restrictions`, `timezone_restrictions`, `worldwide` from Himalayas; `region`, `countries` from We Work Remotely). Flags: `--base PK --targets DE,AT,... --utc-offset 5 [--tz-tolerance 1]`.

| Data | Verdict |
|---|---|
| Worldwide / empty list / base country listed | PASS |
| A region whose membership of the base is unclear (Pakistan in EMEA, APAC, Middle East) | FLAG |
| A target country listed, base not | FLAG: relocation needed (Visa gate decides) |
| A name the table doesn't know | FLAG (never FAIL on a guess) |
| Only non-target countries | FAIL |
| "Anywhere in the World" plus a country list (WWR tags US data-centre roles this way) | FLAG: conflict, unless the base country is listed |
| No structured field | `null`, `decided_by: "unstructured"` (the model judges) |

Time zone: PASS if a **listed offset** is within tolerance of the base, else FLAG, e.g. "allowed time zones UTC-10 to UTC-5, UTC+14; base UTC+5 is 9h from the closest". It compares with the nearest offset, not a min–max range, because US lists include UTC+14.

## 9. Change tracking and posting facts

**Where:** `tools/rank_state.py`, `text_sha256` in `tools/posting_guard.py`; agent JSON in `.claude/commands/rank.md` Step 2; stored fields in Step 4.

- **Edit signal = `text_hash` only.** It's posting_guard's hash of the cleaned text, sent only for portal CLI or `fetch_page.py` text (both byte-stable). Same hash: unchanged, and the stored facts are kept. New hash: a `changes` entry (newest first, max 5) with `description`, plus `deadline`/`visa_class` if those changed, and the previous facts.
- **Facts are never compared.** Re-scoring the same 8 unchanged live postings gave identical hashes but only 50–90% skill overlap, so a facts comparison flagged all 8 as edited (live test, 2026-11-18).
- **WebFetch-only postings get no edit detection.** WebFetch returns a model summary, so its hash changes on every call.
- `reopened` is recorded when an expired posting is scored again. Every scored job gets `first_verified` and `last_verified`.
- `facts` (`skills`, `country`, `years_required` (halves allowed), `salary`, `remote_scope`) are for market trends. Skills must be in English under their usual names, with common synonyms merged (`SKILL_ALIASES`: AWS / Amazon Web Services, Spark / Apache Spark...). `country` is omitted for multi-country remote.

## 10. Market trends in `/upskill`

**Where:** `tools/market_trends.py`, tests `tests/test_market_trends.py`, `/upskill` Step 4b and its report's "Market Trends" section.

It counts `facts.skills` across scored postings, by the month of `first_seen` (a re-rank moves `rank_date`, so that would drift): top skills with their share of postings, top 5 per country, and month-over-month movers (last two months, in percentage points). Vetoed jobs count as demand. Multi-country remote postings fall in the `multi_or_unstated` bucket. `--country DE` narrows it. It only has data once `/rank` has scored postings with `facts`.

## 11. Skill evidence levels

**Where:** "Skill evidence" table in `01-candidate-profile.md` (asked by `/setup` section 4, cleared by `/reset`), enforced in `/apply`'s Grounding Audit.

| Level | How a CV may say it |
|---|---|
| `professional` / `freelance` | Work experience (freelance named as freelance or client work) |
| `certified` | The certification, not job experience |
| `portfolio` | Projects only ("built X with Databricks"), never "experience in" |
| `learning` | "Currently learning" only; never in a skills list. `/upskill` keeps it as a gap "(in progress)" |

A row may combine levels (`certified + portfolio`, `professional/portfolio`). A claim may use any listed level's wording, but must still match the Evidence column. Other words (`practical`) add nothing.

## 12. Three-score display

**Where:** `score_parts` in each `rank_state.py apply` row; the `/rank` shortlist column `Tech · Role · Elig`; `/apply` Step 1 item 1c.

- **Tech** is the technical dimension.
- **Role** is experience, behavioral and career, combined by their weights.
- **Elig** is the worst of the location, language and visa gates.

Display only: the overall score, bands and vetoes are unchanged.

## 13. Job-alert emails as a `/scrape` source

**Where:** `/scrape` Step 1e, "Email alert sources" table in `search-queries.md`, `source: "email"` in `scrape_state.py`.

The step reads alerts through the Gmail connector, **read-only**: the last 14 days, at most 20 messages per run. Each job becomes a normal search hit (`portal: "email:<board>"`) and passes the same dedup, `posting_guard` and gates as any other.

- Raw alert links are never fetched: LinkedIn's carry an `otpToken` (one-time sign-in). They are turned into canonical URLs (`linkedin.com/jobs/view/<id>`, `indeed.com/viewjob?jk=<id>`).
- The recipient name and headline are never stored.
- Default rows: LinkedIn on (sender confirmed), Indeed on, Glassdoor and Rozee.pk off.

## 14. Not built / decided against

- **Telegram alerts:** dropped. Telegram is banned in Pakistan.
- **Notifiers of any kind** (digest, push, email): not wanted yet (2026-11-18). If revisited, the digest selection rule is: ranked, score ≥ threshold, no gate FAIL, never sent before.
- **Adzuna / Jooble plugins:** they need API keys from the user.

---

## Change log

Newest first.

### 2026-11-18 (real-profile test)

- **Testing:** real-profile test of features 8–12: [docs/testing/2026-11-18-real-profile-test.md](testing/2026-11-18-real-profile-test.md).
- **Fix:** `eligibility.py` knew only 70 countries; 141 names in live data were unrecognised, so lists of non-target countries FLAGged instead of FAILing. It now uses the full ISO table (`tools/country_codes.py`), and table and token share one normal form.
- **Fix:** "Anywhere in the World (United States of America)" is now a conflict FLAG, never PASS or FAIL.
- **Fix:** the time-zone note listed "nearest UTC+14" for US roles; it now lists the allowed bands and the gap in hours.
- **Changed:** change tracking now uses posting_guard's new `text_sha256` only; the facts fingerprint was removed (100% false alarms in the live test).
- **Fix:** `years_required` accepts 4.5; skill synonyms are merged.
- **Fix:** market trends use `first_seen` for the month, put multi-country postings in `multi_or_unstated`, and validate `--top`, `--min-count` and `--country`.
- **Added:** combined skill-evidence levels rule in `/apply`, the profile template and `/upskill`.

### 2026-11-18

- **Added:** `tools/eligibility.py` (rules-based remote/time-zone gate), wired into `/scrape` Step 3 and `/rank` Step 2.
- **Added:** posting `facts`, `fingerprint`, `first_verified`/`last_verified` and `changes` in `rank_state.py`; ✏️ marker in `/rank`.
- **Added:** `tools/market_trends.py` and `/upskill` Step 4b Market Trends.
- **Added:** Skill evidence table (`01-candidate-profile.md`, `/setup`, `/reset`) and the matching `/apply` grounding rule.
- **Added:** three-score display (`score_parts`) in `/rank` and `/apply`.
- **Added:** `/scrape` Step 1e job-alert emails (Gmail, read-only), `email` source.
- **Fix (found live):** time-zone check used a min–max range; US lists include UTC+14, so every offset passed. Now uses the nearest listed offset.
- **Removed:** Telegram notifier (banned in Pakistan) and the digest tool (no notifiers wanted yet).
- **Testing:** [docs/testing/2026-11-18-features-test.md](testing/2026-11-18-features-test.md).
- **Added:** allow-list entries for `eligibility.py` and `market_trends.py` in `.claude/settings.json`, mirrored in `tools/security_guards.py` (user approved).

### 2026-11-17

- **Testing:** 8-country live test (Germany, Austria, Netherlands, Poland, Ireland, Estonia, Japan, United States) of `/scrape` storage and `/rank` gates. Report: [docs/testing/2026-11-17-eight-country-test.md](testing/2026-11-17-eight-country-test.md).
- **Fix:** Remote Eligibility Gate now FLAGs (relocation needed) instead of FAILing a remote role restricted to countries that include one of your target countries.
- **Fix:** `job_seeker_route` no longer needs an employer quote (it was being downgraded to `not_specified`).
- **Fix:** `posting_guard.py` flags "ignore your previous instructions" and verdict-steering lines.
- **Added:** `himalayas-search --strict`.
- **Added:** Visa & Relocation Gate, Country profiles, visa evidence and history in `rank_state.py`.
- **Added:** `remoteok-search` and `weworkremotely-search` plugins; settings grants for all three plugins.
- **Added:** Claude connectors as `/scrape` step 1d; `connector` source in `scrape_state.py`.
- **Added:** `himalayas-search` plugin.
- **Added:** Remote Eligibility Gate, Work arrangement table, `location_note` in `rank_state.py`.
