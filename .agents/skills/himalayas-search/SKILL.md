---
name: himalayas-search
version: 1.0.0
description: >
  Use this skill to search remote job listings on Himalayas (himalayas.app), a
  remote-only job board, through its free public JSON API - worldwide-friendly
  roles, roles open to a specific country (e.g. Pakistan, India, Nigeria, Brazil),
  or roles open to a UTC offset - or to look up a specific Himalayas posting. Every
  result carries the job's location restrictions and time-zone restrictions, so it
  shows who may actually apply. Trigger phrases: remote jobs, remote worldwide,
  work from anywhere, remote jobs open to Pakistan, "remote <role> jobs for <country>",
  remote jobs in my time zone, look up this Himalayas job.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/himalayas-search/cli/src/cli.ts *)
---

# Himalayas Search Skill

Search remote job listings from **[Himalayas](https://himalayas.app)**, a remote-only
job board, through its free public JSON API. No authentication, no API key, and
**zero runtime dependencies**: it runs with just `bun`.

Every Himalayas job is remote. What differs per job is **where the hire may live**
(`location_restrictions`, empty = worldwide) and **which UTC offsets it must work
from** (`timezone_restrictions`). Both come back on every result, so `/scrape` and
`/rank` can apply the Remote Eligibility Gate in `04-job-evaluation.md` without
guessing.

## Terms of use (Himalayas API terms)

The API is free and its documentation allows agents and automation. Its terms ask that:

- the **Apply** link is the job's `apply_url`, used unchanged;
- the job's Himalayas page (`url`) or himalayas.app is shown as the source;
- jobs are shown only on sites and apps you operate, never passed on to other job
  boards, aggregators, Google Jobs or LinkedIn Jobs;
- expired jobs are removed.

Using this skill for your own job search fits those terms. Keep volume low: a few
searches per `/scrape` run, not a crawl. `robots.txt` allows `/jobs/api`; this skill
never touches the disallowed `/apply` or paginated HTML listing pages.

## When to use this skill

- Find remote roles that are open worldwide, or open to applicants in your country
- Narrow by seniority, employment type, company, or a UTC offset you can work from
- Look up one Himalayas posting's full description and restrictions

## Commands

### `search`

```bash
bun run .agents/skills/himalayas-search/cli/src/cli.ts search [-q "<keywords>"] [filters] [--format json|table|plain]
```

Query syntax: quotes are ignored (`"seismic data"`, `'seismic data'` and `"data seismic"` all matched the same 40 jobs as the bare words), each extra word narrows the match, and `OR` is not an operator (it is searched as a word and returned nothing). Pass words bare, one term per call. Verified 2026-11-17.

| Flag | Meaning |
|---|---|
| `--query`, `-q <text>` | Keywords (title, skill). Optional. |
| `--country <name or ISO>` | Jobs open to applicants in that country (`PK`, `Pakistan`, `United States`). Includes worldwide roles unless `--exclude-worldwide` is set. |
| `--location`, `-l <text>` | Alias of `--country` (every job is remote, so location means "where you may work from"). |
| `--worldwide` | Only jobs with no country restriction. |
| `--exclude-worldwide` | With `--country`: only jobs that name that country explicitly. |
| `--timezone <offset>` | Jobs open to that UTC offset: `5`, `-5`, `UTC+05:30`. |
| `--seniority <list>` | `Entry-level`, `Mid-level`, `Senior`, `Manager`, `Director`, `Executive` (comma-separated). |
| `--employment-type <list>` | `Full Time`, `Part Time`, `Contractor`, `Temporary`, `Intern`, `Volunteer`, `Other`. |
| `--company <slugs>` | Company slug(s), comma-separated. |
| `--sort <order>` | `relevant`, `recent`, `salaryAsc`, `salaryDesc`, `nameAToZ`, `nameZToA`, `jobs`. |
| `--strict` | Keep only jobs whose title or categories contain every query word. Himalayas ranks by relevance rather than filtering, so without it a `data engineer` search also returns React and QA roles (seen in a 2026-11-17 test). `/scrape` should pass it. |
| `--jobage <days>` | Posted within N days. The API has no age parameter, so this filters client-side and sorts by `recent` unless `--sort` is given. |
| `--page <n>` | 1-indexed page; the API serves 20 results per page. |
| `--limit`, `-n <n>` | Client-side cap on results (default 20). |
| `--format <fmt>` | `json` (default), `table`, `plain`. |

Unknown flags and values outside the vocabularies exit 1 with a JSON error; nothing is silently dropped.

### `detail`

```bash
bun run .agents/skills/himalayas-search/cli/src/cli.ts detail <company/slug | himalayas.app job URL> [--format json|plain]
```

Returns the full cleaned description plus the same restriction fields. A job that has
expired answers `NOT_FOUND`.

## Examples

```bash
# Remote Python roles open to applicants in Pakistan, posted in the last 14 days
bun run .agents/skills/himalayas-search/cli/src/cli.ts search -q "python" --country PK --jobage 14 --format table

# Only roles that name Pakistan explicitly (no worldwide roles)
bun run .agents/skills/himalayas-search/cli/src/cli.ts search -q "python" --country Pakistan --exclude-worldwide --format table

# Remote React roles open worldwide, mid-level or senior
bun run .agents/skills/himalayas-search/cli/src/cli.ts search -q "react" --worldwide --seniority Mid-level,Senior --format table

# Full-time data roles open to UTC+5
bun run .agents/skills/himalayas-search/cli/src/cli.ts search -q "data analyst" --timezone 5 --employment-type "Full Time" --format table

# Full details for one job
bun run .agents/skills/himalayas-search/cli/src/cli.ts detail micro1/computational-bioscience-expert-python --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use by `/scrape` |
| `table` | Quick human scanning (scope and time zones in their own columns) |
| `plain` | Reading results or one job's full detail |

Search JSON is `{ "meta": { "count", "page", "total", "source" }, "results": [...] }`.
Each result carries `id` (`<company>/<slug>`, what `detail` takes), `title`, `company`,
`location` (`"Worldwide (remote)"` or `"Remote: <countries>"`), `date` (`YYYY-MM-DD`),
`url` (the Himalayas job page), plus `worldwide`, `location_restrictions`,
`timezone_restrictions`, `employment_type`, `seniority`, `salary`, `expiry_date`,
`apply_url` and `excerpt`. Missing values are `null`, never omitted. Errors go to
**stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Notes

- `location_restrictions: []` means worldwide; a non-empty list is the only places the
  employer will hire from. Treat it as authoritative input for the Remote Eligibility
  Gate, but still read the posting: some employers state a narrower rule in the text.
- `timezone_restrictions` lists every allowed UTC offset; an empty list means the
  job states none. Offsets are standard (non-daylight-saving) offsets.
- A `--country` search includes worldwide roles; `meta.total` is an estimate up to a
  day old and can run high, so never use it to decide when to stop paging.
- Results can shift between pages; `/scrape` deduplicates on `url`.
- Retries 429/5xx with exponential backoff (max 6, within 30 s); an unreachable API
  exits 1 with a clear message so `/scrape` falls back to WebSearch.
