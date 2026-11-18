# We Work Remotely feeds reference

Recorded 2026-11-17 from https://weworkremotely.com/remote-job-rss-feed.

- All jobs: `GET https://weworkremotely.com/remote-jobs.rss` (~100 latest items, about 10 per category, ~2 MB).
- Category feeds: `GET https://weworkremotely.com/categories/<slug>.rss` (about 25 items each). Slugs: `remote-programming-jobs`, `remote-full-stack-programming-jobs`, `remote-back-end-programming-jobs`, `remote-front-end-programming-jobs`, `remote-devops-sysadmin-jobs`, `remote-design-jobs`, `remote-product-jobs`, `remote-customer-support-jobs`, `remote-sales-and-marketing-jobs`, `remote-management-and-finance-jobs`, `all-other-remote-jobs`.
- Item fields: `title` ("Company: Role"), `region`, `country` (flag-emoji list, "A, B, and C"), `state`, `skills` (comma list, often empty), `category`, `type`, `description` (entity-encoded HTML), `pubDate` and `expires_at` (RFC 822), `guid` and `link` (`https://weworkremotely.com/remote-jobs/<slug>`).
- Region values seen (99 items): Anywhere in the World 49, USA Only 30, Asia Only 8, Oceania Only 2, Remote 2, plus Africa Only, Americas Only, Canada Only, North America Only, Europe Only and state/province names.
- robots.txt allows everything except account, admin and token-edit paths.
