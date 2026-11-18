# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. None ship with AI Job Search: copy the ones for your market from [community-portals](https://github.com/ai-job-search-dev/community-portals) (e.g. `linkedin-search`, `freehire-search` under `portals/global/`), or build one with `/add-portal`. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary (your market's job boards - scaffold one with `/add-portal`):
- **[YOUR_JOB_BOARD]** - your market's largest general job board
- **linkedin.com/jobs** - LinkedIn job listings (filter: [YOUR_COUNTRY] / [YOUR_CITY]); also covered by the community `linkedin-search` CLI once installed
- **[YOUR_INDUSTRY_JOB_BOARD]** - a niche/industry board for your field (optional)
- **[YOUR_ADDITIONAL_JOB_BOARD]** - another major board for your market (optional)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above). Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

Each priority has two kinds of block. **Plain terms** blocks are what the portal CLIs consume: one term per line, one CLI call per term, no `OR`, no `site:` prefix, and no location (the CLI's location flag, or the city in `--query` where that portal's SKILL.md says so, carries it). Quote a multi-word phrase only if the portal's `Query syntax:` line says quoting is honoured. **WebSearch-only** blocks are Google syntax (`site:`, quotes, `OR`) for the fallback path and are never passed to a CLI.

**Organize by function, not job title.** The same underlying work carries different titles across companies and markets (a "Data Scientist" role at one employer may be posted as "Insights Analyst" or "Data Consultant" at another). Name each priority category after the function it covers, and list several plausible job titles as query variants within that category rather than betting an entire priority tier on one exact title string.

### Priority 1: [YOUR_PRIMARY_ROLE_TYPE]

These match your strongest and most desired career direction.

#### Plain terms (portal CLIs)

```
[YOUR_PRIMARY_JOB_TITLE_1]
[YOUR_PRIMARY_JOB_TITLE_2]
[YOUR_KEY_SKILL]
```

#### WebSearch-only (`site:` fallback)

```
site:[YOUR_JOB_BOARD] "[YOUR_PRIMARY_JOB_TITLE_1]" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_PRIMARY_JOB_TITLE_2]" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_KEY_SKILL]" [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_PRIMARY_JOB_TITLE_1]" [YOUR_COUNTRY]
```

### Priority 2: [YOUR_DOMAIN_EXPERTISE]

These match your domain expertise.

#### Plain terms (portal CLIs)

```
[YOUR_DOMAIN_KEYWORD_1]
[YOUR_DOMAIN_KEYWORD_2]
```

#### WebSearch-only (`site:` fallback)

```
site:[YOUR_JOB_BOARD] [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] OR [YOUR_REGION]
site:[YOUR_JOB_BOARD] [YOUR_DOMAIN_KEYWORD_2] [YOUR_COUNTRY]
site:linkedin.com/jobs [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] [YOUR_COUNTRY]
```

### Priority 3: [YOUR_ADJACENT_ROLE_TYPE]

Adjacent roles you could pivot into.

#### Plain terms (portal CLIs)

```
[YOUR_ADJACENT_TITLE_1]
[YOUR_ADJACENT_TITLE_2]
```

#### WebSearch-only (`site:` fallback)

```
site:[YOUR_JOB_BOARD] "[YOUR_ADJACENT_TITLE_1]" [YOUR_KEY_SKILL] [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_ADJACENT_TITLE_2]" [YOUR_KEY_SKILL] [YOUR_CITY]
```

### Priority 4: Broader Technical / Consulting

Wider net for general technical roles.

#### Plain terms (portal CLIs)

```
[YOUR_KEY_SKILL] developer
technical consultant
```

#### WebSearch-only (`site:` fallback)

```
site:[YOUR_JOB_BOARD] [YOUR_KEY_SKILL] developer [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_KEY_SKILL] developer" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "technical consultant" [YOUR_DOMAIN] [YOUR_CITY]
```

## Location Filter

When evaluating on-site and hybrid results, verify the job location is within reasonable commute distance from your home (remote results use the Work arrangement filters below instead). Define acceptable areas:
- [YOUR_CITY] and surrounding areas
- [ACCEPTABLE_AREA_1]
- [ACCEPTABLE_AREA_2]
- [BORDERLINE_AREA] (borderline - ~X min by transit)
- [TOO_FAR_AREA] (too far)

## Work arrangement filters

<!-- SETUP: filled from the Work arrangement table in 01-candidate-profile.md -->

Remote scope to search: [YOUR_REMOTE_SCOPE, e.g. "worldwide + Pakistan"]

When the profile accepts remote work, run each Plain term once per scope below, with the portal's own remote and location flags (read them from the portal's SKILL.md; never invent a flag). Examples for the community portals:

| Scope | `linkedin-search` | `freehire-search` | `himalayas-search` | `remoteok-search` | `weworkremotely-search` |
|---|---|---|---|---|---|
| Remote, worldwide | `-l "Remote" --remote remote` | `--remote remote --region global` | `--worldwide --strict` | `--worldwide` | `--worldwide` |
| Remote, open to your country | `-l "[YOUR_COUNTRY]" --remote remote` | `--remote remote --country [YOUR_ISO_CODE]` | `--country [YOUR_ISO_CODE] --strict` (add `--exclude-worldwide` to skip the worldwide roles the row above already found) | `--region "[YOUR_COUNTRY]"` (location is free text, often blank) | `--region "[YOUR_REGION, e.g. asia]"` |
| Remote, your working hours | not supported | not supported | `--timezone [YOUR_UTC_OFFSET]` | not supported | not supported |
| On-site or hybrid in your city | `-l "[YOUR_CITY], [YOUR_COUNTRY]"` | `--city [YOUR_CITY]` | not applicable (remote only) | not applicable | not applicable |

Connectors (see **Connector sources** below) take the same scopes through their own parameters, e.g. Indeed `location: "remote"` with `country_code: [YOUR_ISO_CODE]`, or JobDataLake `remote_type: fully_remote` with `countries: [YOUR_ISO_CODE]`.

A portal's remote facet tells you how the job was tagged, not who may apply. Every remote result still goes through the Remote Eligibility Gate in `04-job-evaluation.md`, and a "remote, US only" hit is skipped in Step 3 the same way a role outside commute range is.

## Connector sources

<!-- SETUP: list the job-search connectors on your Claude account. /scrape Step 1d runs the enabled rows. -->

Claude connectors (MCP servers added to your Claude account) can search job boards that have no portal CLI. `/scrape` Step 1d runs every row below marked `yes` whose connector is available in the session. A connector is matched by the name shown in your Claude connector settings, or by its search tool's description; tool ids differ per account, so they are never written here.

| Connector | Enabled | Cost | Search tool and the filters it documents |
|---|---|---|---|
| Indeed | yes | free | `search_jobs`: `search`, `location`, `country_code` (ISO, e.g. `PK`), `job_type`. Use it for on-site and hybrid jobs in your cities: in a 2026-11-17 test, `location: "remote"` with `country_code: PK` returned nothing while `location: "<a city in your country>"` returned 10 jobs. Links are `to.indeed.com` short links. |
| JobDataLake | yes | free tier, 500 calls/day | `search_jobs`: `query`, `countries`, `location`, `remote_type`, `posted_within`, `skills`, `seniority`, `employment_type`, `salary_min`. Indexes employers' own ATS boards (Workday, Greenhouse, Lever, Ashby, SmartRecruiters and more), so apply links go to the employer. Run remote searches twice: `location: "Remote"` + `remote_type: fully_remote` for worldwide roles, and `countries: [YOUR_ISO_CODE]` for roles in your country. |
| Dice | yes | free | `search_jobs`: `keyword`, `location`, `workplace_types`, `posted_date`, `employment_types`, `willing_to_sponsor`. A US tech board: its remote results are mostly US-only (they named "United States Remote" or US time zones in a 2026-11-17 test), so most will fail the Remote Eligibility Gate for a candidate based outside the US. Set to `no` if it only adds noise. |
| Firecrawl jobs search | no | paid, credits per provider read | `jobs_search`: `query`, `location`, `remote`, `posted_within_days`, `max_credits` |
| Upwork | no | free | `find_jobs`: freelance gigs, not employment; enable only when the profile accepts freelance work |

Change `Enabled` to turn a row on or off. A paid row stays `no` unless you choose otherwise, and when on, every call passes the cost cap below.

Paid connector cap per run: [YOUR_CREDIT_CAP, e.g. "50 credits"]

## Email alert sources

<!-- SETUP: alerts you saved on job boards that email you. /scrape Step 1e reads the enabled rows through the Gmail connector, read-only. -->

When the Gmail connector is connected, `/scrape` Step 1e reads job-alert emails from the senders below (last 14 days) and treats each job in them as a search hit. It never changes your mailbox. Check a sender against a real alert in your inbox before enabling its row; boards change sender addresses.

| Board | Enabled | Gmail search |
|---|---|---|
| LinkedIn | yes | `from:jobalerts-noreply@linkedin.com` (sender confirmed 2026-11-18) |
| Indeed | yes | `from:alert@indeed.com` |
| Glassdoor | no | `from:noreply@glassdoor.com subject:jobs` (the same sender also sends Community digests) |
| Rozee.pk | no | `from:rozee.pk` |

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, matching `/scrape` Step 1b.3: use a supported recency filter or filter the returned publication dates client-side. A future application deadline does not bypass this discovery window; `/rank` handles deadline expiry and urgency separately after discovery. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
