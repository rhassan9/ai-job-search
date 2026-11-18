# Himalayas API reference

Recorded 2026-11-17 from https://himalayas.app/api and live responses.

## Access

- Public, no key required. A free key (Authorization: Bearer) raises rate limits; this skill does not use one.
- `robots.txt`: `Allow: /`; disallows `/apply` and `?page=` HTML listing pages. The JSON endpoints under `/jobs/api` are allowed.
- API terms: use `applicationLink` unchanged for Apply, show the Himalayas job page or himalayas.app as the source, show jobs only on sites/apps you operate, never pass them to other job boards or aggregators, remove expired jobs.

## Endpoints

| Endpoint | Use |
|---|---|
| `GET /jobs/api/search` | Filtered search (this skill's `search`). 20 jobs per page, `?page=` 1-based, no cursor. |
| `GET /jobs/api/companies/:company/jobs/:slug` | One job by its guid path (this skill's `detail`). Returns `{ "job": { ... } }`. |
| `GET /jobs/api` | Browse feed with cursor pagination (`nextCursor`). Not used. |

## Search parameters

| Parameter | Values |
|---|---|
| `q` | Free text |
| `country` | ISO alpha-2, common name, slug or abbreviation. Includes worldwide roles open to that country. |
| `worldwide` | `true`: only worldwide-friendly roles |
| `exclude_worldwide` | `true`: with `country`, drop worldwide roles |
| `seniority` | `Entry-level`, `Mid-level`, `Senior`, `Manager`, `Director`, `Executive` (comma list) |
| `employment_type` | `Full Time`, `Part Time`, `Contractor`, `Temporary`, `Intern`, `Volunteer`, `Other` (comma list) |
| `company` | Company slug(s), comma list |
| `timezone` | `-5`, `UTC-5`, `UTC+05:30` |
| `sort` | `relevant`, `recent`, `salaryAsc`, `salaryDesc`, `nameAToZ`, `nameZToA`, `jobs` |
| `page` | 1-based |

There is no posting-age parameter; `--jobage` filters `pubDate` client-side.

## Job object (fields read)

`title`, `excerpt`, `companyName`, `companySlug`, `employmentType`, `minSalary`, `maxSalary`, `salaryPeriod`, `currency`, `seniority[]`, `locationRestrictions[]` (country names; empty = worldwide), `timezoneRestrictions[]` (UTC offsets as numbers), `categories[]`, `description` (HTML), `pubDate` and `expiryDate` (unix seconds), `applicationLink`, `guid` (`https://himalayas.app/companies/<company>/jobs/<slug>`).

The API documents eligibility as: open to a country when `locationRestrictions` is empty or includes it, and `timezoneRestrictions` includes one of that country's standard UTC offsets.

## Live checks (2026-11-17)

- `search?q=python&country=PK`: totalCount 329, mostly worldwide contractor roles.
- `search?q=python&country=Pakistan&exclude_worldwide=true`: totalCount 161, restriction lists that name Pakistan.
- `search?q=python&worldwide=true`: totalCount 172.
