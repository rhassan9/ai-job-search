# Remote OK API reference

Recorded 2026-11-17.

- `GET https://remoteok.com/api` - JSON array; element 0 is the legal notice (`last_updated`, `legal`), the rest are the latest ~100 jobs.
- `GET https://remoteok.com/api?tag=<tag>` - the same, narrowed by tag. Loose: `tags=python,django` returned marketing roles too; an unknown tag returns no jobs.
- No pagination, no country filter, no per-job endpoint.
- Job fields read: `id` (numeric string), `slug`, `epoch` (unix seconds), `date` (ISO), `company`, `position`, `tags[]`, `description` (HTML), `location` (free text, blank on about half), `apply_url`, `salary_min`, `salary_max` (0 when unset), `url` (`https://remoteOK.com/remote-jobs/<slug>`; the slug ends in `-<id>`).
- API terms (from the legal element): link back to the job's Remote OK URL with a followed link and name Remote OK as the source; do not use the logo.
- robots.txt: `User-agent: *` `Allow: /` with `Content-Signal: search=yes,ai-train=no,use=reference`; several AI crawlers (including ClaudeBot, anthropic-ai, Claude-Web, GPTBot) are disallowed by name.
- Location values seen (98 jobs): blank 47, "Remote" 7, "Anywhere in the World" 3, then single cities and regions ("Warsaw", "EMEA", "Any State").
