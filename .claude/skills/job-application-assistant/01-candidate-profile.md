---
framework_version: 1.3.0
---

# Candidate Profile

<!-- SETUP: This file is populated by running /setup -->
<!-- After running /setup, all sections will be filled with your actual information -->

## Identity
- **Name:** [YOUR_NAME]
- **Location:** [YOUR_ADDRESS]
- **Phone:** [YOUR_PHONE]
- **Email:** [YOUR_EMAIL]
- **LinkedIn:** [YOUR_LINKEDIN_URL]
- **GitHub:** [YOUR_GITHUB_URL]
- **Status:** [YOUR_EMPLOYMENT_STATUS]
- **Constraints:** [YOUR_COMMUTE_OR_LOCATION_CONSTRAINTS]

### Work arrangement
<!-- Used by the Location & Logistics dimension and its Remote Eligibility Gate in
04-job-evaluation.md, and by job-scraper/search-queries.md to pick each portal's remote and
location filters. Be literal: a remote job restricted to countries that exclude your base
country is a hard no, and a role whose core hours fall outside your window gets flagged. -->

| Field | Value |
|-------|-------|
| Base country / city | [YOUR_COUNTRY] / [YOUR_CITY] |
| Time zone | [YOUR_TIMEZONE, e.g. "PKT (UTC+5)"] |
| Work modes accepted | [e.g. "remote, hybrid in <your city>" / "remote only"] |
| Remote scope | [e.g. "worldwide" / "worldwide + roles based in <your country>" / "EMEA + APAC"] |
| Working-hours window (local) | [e.g. "09:00-22:00, can cover US East mornings"] |
| Engagement types accepted | [e.g. "employee, EOR (Deel/Remote.com), contractor"] |
| Open to relocating to | [e.g. "UAE, Germany" / "no"] |

### Country profiles
<!-- Used by the Visa & Relocation Gate in 04-job-evaluation.md. One row per country you would
work in or move to, including your base country. "Right to work now" is a fact about you today
(citizen, permanent resident, a valid work permit), not a hope. "Independent route" is a route
YOU have checked against the official government source and believe you qualify for (e.g. a
job-seeker visa) - the workflow never decides that for you, and treats the route as yours to
verify, never as employer sponsorship. -->

| Country | Interest | Right to work now | Independent route (you checked) | Notes |
|---------|----------|-------------------|---------------------------------|-------|
| [YOUR_COUNTRY] | base | yes (citizen) | - | |
| [TARGET_COUNTRY] | [target / open / no] | [no / yes: <permit>] | [none / <route name>, checked <date>] | [optional] |

### Languages
<!-- Every language you can work in professionally, with your honest level. Used by the
Language Gate in 04-job-evaluation.md and by job-scraper/search-queries.md's query-language
generation. Omit any language you don't actually work in - an undeclared language is treated as
a hard no, not a gap to smooth over. -->

| Language | Level | Notes |
|----------|-------|-------|
| [LANGUAGE] | [LEVEL, e.g. "Native" / "C2" / "B1/B2 (conversational)"] | [optional] |

## Education

| Degree | Period | Institution | Key Topics |
|--------|--------|-------------|------------|
| [DEGREE] | [YEARS] | [INSTITUTION] | [TOPICS] |

## Professional Experience

### [JOB_TITLE] - [COMPANY] ([START] - [END])
[LOCATION]
- [RESPONSIBILITY_OR_ACHIEVEMENT_1]
- [RESPONSIBILITY_OR_ACHIEVEMENT_2]
- [RESPONSIBILITY_OR_ACHIEVEMENT_3]

<!-- Add more roles as needed -->

## Independent Projects
<!-- Projects outside of employment: freelance, open source, personal -->
- **[PROJECT_NAME]**: [DESCRIPTION]

## Technical Skills

### Programming & ML
- **[LANGUAGE]** ([PROFICIENCY]): [FRAMEWORKS_AND_LIBRARIES]
- [OTHER_SKILLS]

### Domain Expertise
- [DOMAIN_1]
- [DOMAIN_2]

### Software & Tools
- [TOOL_LIST]

### Skill evidence
<!-- One row per skill a CV or cover letter might claim. Level is the strongest evidence you have:
certified (passed exam), professional (used in a paid job), freelance (paid client work),
portfolio (own projects only), learning (studying, not used for real yet).
List several when true ("certified + portfolio"); any other word adds nothing.
/apply's grounding audit words each claim to match its level. -->

| Skill | Level | Evidence (where it shows) |
|---|---|---|
| [SKILL] | [certified / professional / freelance / portfolio / learning] | [e.g. "<certification>, <year>"; "3 years at COMPANY"; "GitHub project X"] |

## Publications
<!-- List peer-reviewed publications, if any -->
1. [AUTHOR_LIST] ([YEAR]). [TITLE]. [JOURNAL]. [DOI_LINK]

## Awards
- [AWARD] - [EVENT] ([YEAR])

## References
- [NAME], [TITLE], [COMPANY] ([EMAIL], [PHONE])

More references available upon request.
