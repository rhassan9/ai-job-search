# Real-profile test: eligibility, skill evidence, three scores, change tracking, trends (2026-11-18)

Ran in a throwaway repo copy with a **temporary** data-engineering test profile (base PK, UTC+5; targets DE, AT, NL, PL, IE, EE, JP, US; Germany job-seeker route is a test assumption; a Skill evidence table mixing all four levels). The copy was deleted afterwards. Real postings, real `posting-scorer` and `application-reviewer` agents.

## Rules-based eligibility

| Check | Result |
|---|---|
| 561 unique live jobs: Himalayas (3 queries × 8 countries + PK + worldwide, plus 15 unfiltered pages) and We Work Remotely (5 feeds) | After the fixes: **0 mismatches** against an independent oracle, 0 unrecognised names (219 distinct names, plus 1 found later) |
| **Bug:** only 70 countries known; 141 live names (Albania, Iran, Côte d'Ivoire...) unrecognised | Full ISO table; non-target lists now FAIL (120 live FAILs, e.g. Canada-only, UK-only, Singapore-only) |
| **Bug:** "Virgin Islands, U.S." unmatched (trailing dot) | Table and token share one normal form; every one of the 250 codes' names resolves to itself (test) |
| **Edge:** WWR "Anywhere in the World (United States of America)" on US data-centre roles | Conflict FLAG |
| **Edge:** US time-zone lists include UTC+14 | Note now reads "UTC-10 to UTC-5, UTC+14; base UTC+5 is 9h from the closest" |
| Pakistan in EMEA / APAC / Middle East | FLAG "unclear" (3 live EMEA roles) |

## Three scores (8 real postings, real scoring agents)

All 8 `score_parts` match an independent recomputation. inovex (Fabric, Germany) scored **68 Good Fit** overall with **Eligibility FAIL** (German C1 required), which the split exists to show. Unit edges: all-0, all-100, 59.5 rounding, visa FAIL veto.

## Change tracking (same 8 postings scored 3 times)

| Run | Result |
|---|---|
| Text hash, run 2 vs run 3 | **8/8 identical** (two also re-hashed by hand) |
| Extracted skills, run 2 vs run 3 | 50–90% overlap; salary, years and remote wording also drift |
| Old facts fingerprint | Would have flagged **8/8** unchanged postings as edited → removed |
| New design over 3 runs | **0 false alarms** |
| Real Hivex text with one line edited ("4.5+" → "6+ years") and deadline moved | Detected: `description`, `deadline`, previous values kept |

## Market trends (real extracted facts)

Synonyms merged (AWS = Amazon Web Services, Data modelling = data modeling). Country buckets PK, DE, NL, US and `multi_or_unstated` (4 multi-country remote roles). With 4 postings moved to October, movers are correct by hand-check (dbt 1/4 → 3/4 = +50 pts). **Bug fixed:** months came from `rank_date`, which moves on every re-rank; they now come from `first_seen`.

## Skill evidence (real `application-reviewer`, test evidence table)

10 draft lines, 6 deliberate overclaims. The audit matched all 10:
- **Flagged:** years of professional use claimed for a portfolio-only tool; client work claimed for a certified + portfolio tool; learning-level tools listed as skills; "Proficient in" for a portfolio + practical row (= portfolio); three tools not in the table at all.
- **Passed:** project, certification, "currently learning" and professional-level lines.

## Totals

1015 Python tests OK (35 skipped); lint and security guards OK; plugins 29/15/15 pass.

**Not covered:**
- `/apply` drafting and PDF compile (needs a real CV).
- Edit detection for WebFetch-only postings (by design there is none).
