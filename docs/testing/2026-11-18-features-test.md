# Live test: features 8–13 (2026-11-18)

Ran in a throwaway repo copy with a temporary test profile (base PK, UTC+5; targets DE, AT, NL, PL, IE, EE, JP, US). The copy was deleted afterwards.

| Check | Result |
|---|---|
| `eligibility.py` on 48 live results (Himalayas `--strict` for the 8 countries plus worldwide; We Work Remotely programming feed) | 25 PASS, 23 FLAG (relocation to a target / time zone), 0 errors. Europe-only lists flag on time zone (UTC-1..+3 vs +5) ✅ |
| US-only roles' time zone | **Bug:** lists hold UTC-10..-5 **and +14**, so the range check passed everything. Fixed (nearest offset); a regression test uses the live list ✅ |
| `rank_state apply` with `facts` on 12 stored live jobs, then re-applied with one posting's skills edited | 12 ranked; exactly 1 `changes` entry (`skills`, previous values kept), 11 unchanged; `score_parts` correct ✅ |
| `market_trends.py` on that state (two months) | Per-country counts, movers between 2026-10 and 2026-11, `--country us` filter ✅ |
| Gmail alert search (read-only) | LinkedIn sender confirmed (about 200 alerts in 14 days). The Glassdoor sender also sends Community mail. One alert parsed to a canonical `linkedin.com/jobs/view/<id>` and stored with `source: email` ✅ |
| Alert link safety | Raw LinkedIn links carry an `otpToken` sign-in token, so the step now says never fetch raw links ✅ |
| Full suite | 994 Python tests OK (35 skipped), lint, security guards OK; plugins 29/15/15 pass |

**Not covered:**

- Live `/rank` scoring agents extracting `facts`: the facts were built from Himalayas categories, so the skill names are category slugs, not real extraction.
- Indeed alert emails: none in the window.
- `/apply` drafting with the Skill evidence rule: needs a real CV.
