---
name: weworkremotely-search
version: 1.0.0
description: >
  Use this skill to search remote job listings on We Work Remotely (weworkremotely.com)
  through its public RSS feeds - programming, DevOps, design, product, support, sales and
  marketing, management and finance roles - filtered by keyword, category, region
  ("Anywhere in the World", "Asia Only", "Europe Only"...) or posting age, or to look up
  a We Work Remotely job. Every result carries the job's region restriction and country
  list. Trigger phrases: We Work Remotely, WWR, remote jobs anywhere in the world,
  remote programming jobs, remote jobs open to Asia.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/weworkremotely-search/cli/src/cli.ts *)
---

# We Work Remotely Search Skill

Search remote jobs on **[We Work Remotely](https://weworkremotely.com)** through its
public RSS feeds. No authentication, no API key, **zero runtime dependencies**.

Every item states its **region** - `Anywhere in the World`, `USA Only`, `Asia Only`,
`Europe Only`, `Americas Only`, `Oceania Only`, `Africa Only`, `Canada Only` and others -
and often a **country list**. Both are returned on every result, so the Remote
Eligibility Gate in `04-job-evaluation.md` can use them directly. Many programming
roles are `USA Only`.

## Access and terms

`robots.txt` allows everything outside account and admin pages; the RSS feeds are
published for readers to consume. Use this skill for your own job search at low
volume, link to each job's page (`url`), and do not republish the listings.

## Commands

### `search`

```bash
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search [-q "<keywords>"] [--category <list>] [--worldwide] [--region <text>] [--jobage <days>] [--limit <n>] [--format json|table|plain]
```

Query syntax: matched client-side - every word must appear in the title, company, category or skills; quotes are stripped and `OR` is not an operator. Use one plain term per call.

| Flag | Meaning |
|---|---|
| `--query`, `-q <text>` | Keywords. Optional. |
| `--category`, `-c <list>` | Read these category feeds (comma-separated) instead of the all-jobs feed: `programming`, `full-stack`, `back-end`, `front-end`, `devops`, `design`, `product`, `customer-support`, `sales-marketing`, `management-finance`, `other`. |
| `--worldwide` | Only jobs whose region is `Anywhere in the World`. |
| `--region`, `-l <text>` | Only jobs whose region or country list contains this (`asia`, `europe`, `pakistan`). |
| `--jobage <days>` | Posted within N days (client-side). |
| `--limit`, `-n <n>` | Cap results (default 20). |
| `--format <fmt>` | `json` (default), `table`, `plain`. |

The all-jobs feed carries the latest ~100 jobs (about 10 per category); a category feed
carries more of that category, so pass `--category` for depth. `--page` is not
supported: the feeds have no pagination.

### `detail`

```bash
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts detail <slug|url> [--format json|plain]
```

Looks the job up in the all-jobs feed, then each category feed, stopping at the first
hit. A job no longer in any feed answers `NOT_FOUND`.

## Examples

```bash
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search -q python --category back-end,full-stack --worldwide --format table
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search --category programming --region asia --jobage 14 --format table
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search --worldwide --jobage 7 --format table
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts detail epam-systems-senior-devops-engineer --format plain
```

## Output

Search JSON is `{ "meta": { "count", "page", "total", "source" }, "results": [...] }`;
each result has `id` (the job slug), `title`, `company`, `location` (region plus named
countries), `date`, `url`, plus `worldwide`, `region`, `countries`, `state`,
`category`, `employment_type`, `skills`, `expiry_date` and the cleaned `description`.
Missing values are `null`. Errors go to stderr as `{ "error", "code" }` with exit code 1.

## Notes

- Titles arrive as `Company: Role`; the CLI splits them on the first `: `.
- `Anywhere in the World` can still carry a country list (an employer's hiring
  countries); read the posting before treating it as truly worldwide.
- The all-jobs feed is about 2 MB, so requests allow up to 60 s. Retries 429/5xx with
  backoff (max 6, within 30 s).
