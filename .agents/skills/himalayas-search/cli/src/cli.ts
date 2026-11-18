#!/usr/bin/env bun
// Self-contained CLI for the Himalayas public remote-jobs API (https://himalayas.app/api).
// No CLI framework and zero runtime dependencies: it runs anywhere `bun` is available.

import { EMPLOYMENT_TYPES, SENIORITY, SORTS, PAGE_SIZE, runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail } from "./commands/detail.js"

type FlagValue = string | boolean
interface Flags {
  _: string[]
  [k: string]: FlagValue | string[]
}

const ALIAS: Record<string, string> = { q: "query", n: "limit", l: "location", h: "help" }
// Flags that never take a value, so they never swallow the next argument.
const BOOL_FLAGS = new Set(["worldwide", "exclude-worldwide", "strict", "help"])

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    // A bare negative number ("-5") is a value, never a flag.
    if (!a.startsWith("-") || /^-\d/.test(a)) {
      ;(flags._ as string[]).push(a)
      continue
    }
    const name = a.replace(/^-+/, "")
    const key = ALIAS[name] ?? name
    let value: FlagValue = true
    const next = argv[i + 1]
    // A value may itself start with "-" (a UTC offset such as -5); only another flag ends it.
    if (!BOOL_FLAGS.has(key) && next !== undefined && (!next.startsWith("-") || /^-\d/.test(next))) {
      value = next
      i++
    }
    flags[key] = value
  }
  return flags
}

function err(error: string, code = "BAD_ARG"): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

/** A comma list validated case-insensitively against a vocabulary, returned in canonical spelling. */
function vocabList(name: string, raw: FlagValue | string[] | undefined, vocab: readonly string[]): string[] | number {
  if (raw === undefined) return []
  if (typeof raw !== "string" || !raw.trim()) return err(`--${name} requires a non-empty value`)
  const out: string[] = []
  for (const item of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const hit = vocab.find((v) => v.toLowerCase() === item.toLowerCase())
    if (!hit) return err(`--${name} must be one or more of ${vocab.join(", ")} (comma-separated), got "${item}"`)
    out.push(hit)
  }
  return out
}

function intFlag(name: string, raw: FlagValue | string[] | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    err(`--${name} must be a whole number of at least 1, got "${raw}"`)
    return null
  }
  return val
}

const HELP = `himalayas-cli - search remote jobs on Himalayas (himalayas.app), worldwide or by country

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [filters] [--format json|table|plain]
  bun run src/cli.ts detail <company/slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>        Keywords (title, skill). Optional.
  --country <name|ISO>      Jobs open to applicants in this country, e.g. PK, Pakistan, "United States".
                            Includes worldwide roles unless --exclude-worldwide is set.
  --location, -l <text>     Alias of --country (every Himalayas job is remote).
  --worldwide               Only jobs with no country restriction.
  --exclude-worldwide       With --country: only jobs that name that country explicitly.
  --timezone <offset>       Jobs open to this UTC offset, e.g. 5, -5, UTC+05:30.
  --seniority <list>        ${SENIORITY.join(", ")}
  --employment-type <list>  ${EMPLOYMENT_TYPES.join(", ")}
  --company <slugs>         Company slug(s), comma-separated.
  --sort <order>            ${SORTS.join(", ")}
  --strict                  Keep only jobs whose title or categories contain every query word
                            (Himalayas ranks loosely: "data engineer" also returns React roles).
  --jobage <days>           Posted within N days (filtered client-side; sorts by recent).
  --page <n>                1-indexed page of ${PAGE_SIZE} results. Default 1.
  --limit, -n <n>           Cap results (client-side). Default ${PAGE_SIZE}.
  --format <fmt>            json (default) | table | plain.

DETAIL
  <company/slug|url>        A result's id (e.g. micro1/python-engineer) or its himalayas.app job URL.

EXAMPLES
  bun run src/cli.ts search -q "python developer" --country PK --jobage 14 --format table
  bun run src/cli.ts search -q "react" --worldwide --seniority Mid-level,Senior --format table
  bun run src/cli.ts search -q "data analyst" --timezone 5 --employment-type "Full Time" --format table
  bun run src/cli.ts detail micro1/computational-bioscience-expert-python --format plain

Reads are public (no API key). Source: https://himalayas.app - link back to the job page
and use the employer's apply link unchanged (Himalayas API terms).
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "country", "location", "worldwide", "exclude-worldwide", "timezone", "seniority",
    "employment-type", "company", "sort", "strict", "jobage", "page", "limit", "format", "help",
  ]),
  detail: new Set(["format", "help"]),
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const known = KNOWN_FLAGS[cmd]
  if (!known) return err(`Unknown command "${cmd}"`, "BAD_CMD")
  for (const key of Object.keys(flags)) {
    if (key !== "_" && !known.has(key)) {
      return err(`unknown flag --${key} for '${cmd}' - flags are never silently ignored; see --help`, "UNKNOWN_FLAG")
    }
  }
  const extra = (flags._ as string[]).slice(cmd === "detail" ? 2 : 1)
  if (extra.length > 0) return err(`unexpected argument "${extra[0]}" for '${cmd}'; see --help`)

  if (cmd === "search") {
    for (const name of ["query", "country", "location", "timezone", "company", "sort"]) {
      const v = flags[name]
      if (v !== undefined && (typeof v !== "string" || !v.trim())) return err(`--${name} requires a non-empty value`)
    }
    if (flags.country !== undefined && flags.location !== undefined && flags.country !== flags.location) {
      return err("--location is an alias of --country; pass one of them")
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return err(`--format must be one of json|table|plain, got "${fmt}"`)

    const seniority = vocabList("seniority", flags.seniority, SENIORITY)
    if (typeof seniority === "number") return 1
    const employmentType = vocabList("employment-type", flags["employment-type"], EMPLOYMENT_TYPES)
    if (typeof employmentType === "number") return 1
    const sort = typeof flags.sort === "string" ? SORTS.find((s) => s.toLowerCase() === (flags.sort as string).trim().toLowerCase()) : undefined
    if (flags.sort !== undefined && !sort) return err(`--sort must be one of ${SORTS.join(", ")}, got "${flags.sort}"`)

    const timezone = typeof flags.timezone === "string" ? flags.timezone.trim() : undefined
    if (timezone && !/^(UTC)?[+-]?\d{1,2}(:?\d{2}|\.\d+)?$/i.test(timezone)) {
      return err(`--timezone must be a UTC offset such as 5, -5 or UTC+05:30, got "${timezone}"`)
    }

    const country = (typeof flags.country === "string" ? flags.country : typeof flags.location === "string" ? flags.location : undefined)?.trim()
    if (flags.strict && typeof flags.query !== "string") return err("--strict needs --query")
    if (flags["exclude-worldwide"] && !country) return err("--exclude-worldwide needs --country")
    if (flags["exclude-worldwide"] && flags.worldwide) return err("--worldwide and --exclude-worldwide contradict each other")

    const jobage = flags.jobage === undefined ? undefined : intFlag("jobage", flags.jobage, 0)
    if (jobage === null) return 1
    const page = intFlag("page", flags.page, 1)
    if (page === null) return 1
    const limit = intFlag("limit", flags.limit, PAGE_SIZE)
    if (limit === null) return 1

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      country,
      worldwide: flags.worldwide === true,
      excludeWorldwide: flags["exclude-worldwide"] === true,
      seniority,
      employmentType,
      timezone,
      company: typeof flags.company === "string" ? flags.company.split(",").map((s) => s.trim()).filter(Boolean) : [],
      sort,
      jobage,
      strict: flags.strict === true,
      page,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  const id = (flags._ as string[])[1]
  if (!id) return err("detail requires a <company/slug|url>", "NO_ID")
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) return err(`--format must be one of json|plain, got "${fmt}"`)
  return runDetail({ id, format: fmt as "json" | "plain" })
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n")
    process.exit(1)
  })
