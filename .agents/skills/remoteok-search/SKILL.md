---
name: remoteok-search
version: 1.0.0
description: >
  Use this skill to search remote job listings on Remote OK (remoteok.com) through its
  free public JSON API - remote tech, data, design, marketing and other roles, filtered
  by keyword/tag, worldwide-only, location text, or posting age - or to look up a Remote
  OK job that is still in its current feed. Trigger phrases: remote jobs, Remote OK,
  remoteok, remote python jobs, remote jobs anywhere in the world, digital nomad jobs.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/remoteok-search/cli/src/cli.ts *)
---

# Remote OK Search Skill

Search remote jobs on **[Remote OK](https://remoteok.com)** through its free public JSON
API. No authentication, no API key, **zero runtime dependencies**.

## ⚠️ Personal use only

- **API terms:** link back to each job's Remote OK URL (`url`) and name Remote OK as the
  source. Do not use the Remote OK logo.
- **robots.txt** allows all user agents (`Allow: /`) and sets `Content-Signal:
  search=yes, ai-train=no, use=reference`. It also disallows several AI crawlers by name,
  Anthropic's included. This skill is not a crawler and does not train anything: it makes
  one API request per search for your own job search. Keep it that way: low volume, no
  bulk collection, no republishing. If you are not comfortable with that reading of the
  site's signals, set `enabled: false`.

## What the data can and cannot tell you

One request returns the latest ~100 jobs, optionally narrowed by tag. There is no
pagination, no country filter and no per-job endpoint. `location` is free text and is
**blank on about half the jobs**; a blank location does not mean worldwide. Read the
posting text for the real rule (e.g. "remote (Singapore or US Pacific time zones)")
before deciding eligibility - `/scrape` and `/rank` do this through the Remote
Eligibility Gate in `04-job-evaluation.md`.

## Commands

### `search`

```bash
bun run .agents/skills/remoteok-search/cli/src/cli.ts search [-q "<keywords>"] [--worldwide] [--region <text>] [--jobage <days>] [--limit <n>] [--format json|table|plain]
```

Query syntax: the query is sent as Remote OK's `tag`, and then every word must appear in the job's title, company or tags; quotes are stripped and `OR` is not an operator. Use one plain term per call.

| Flag | Meaning |
|---|---|
| `--query`, `-q <text>` | Keyword or tag (`python`, `"data science"`). Optional. |
| `--worldwide` | Only jobs whose location says anywhere / worldwide / global. |
| `--region`, `-l <text>` | Only jobs whose location text contains this (`Europe`, `Asia`, `Brazil`). |
| `--jobage <days>` | Posted within N days (client-side). |
| `--limit`, `-n <n>` | Cap results (default 20). |
| `--format <fmt>` | `json` (default), `table`, `plain`. |

`--page` is not supported: the API has no pagination.

### `detail`

```bash
bun run .agents/skills/remoteok-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

Looks the job up in the current feed. A job older than the latest ~100 answers
`NOT_FOUND`; open its `url` instead.

## Examples

```bash
bun run .agents/skills/remoteok-search/cli/src/cli.ts search -q python --jobage 14 --format table
bun run .agents/skills/remoteok-search/cli/src/cli.ts search -q devops --worldwide --format table
bun run .agents/skills/remoteok-search/cli/src/cli.ts search -q react --region europe --format table
bun run .agents/skills/remoteok-search/cli/src/cli.ts detail 1137792 --format plain
```

## Output

Search JSON is `{ "meta": { "count", "page", "total", "source" }, "results": [...] }`;
each result has `id`, `title`, `company`, `location`, `date` (`YYYY-MM-DD`), `url` (the
Remote OK job page), plus `worldwide`, `tags`, `salary`, `apply_url` and the cleaned
`description`. Missing values are `null`. Errors go to stderr as
`{ "error", "code" }` with exit code 1.

## Notes

- Tags are loose: a tag search returns unrelated roles, which is why every query word
  must also appear in the title, company or tags.
- Retries 429/5xx with backoff (max 6, within 30 s).
