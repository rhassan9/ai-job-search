#!/usr/bin/env bun
// Self-contained CLI for the Remote OK public JSON API. Zero runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail } from "./commands/detail.js"

type FlagValue = string | boolean
type Flags = { _: string[] } & Record<string, FlagValue | string[]>

const ALIAS: Record<string, string> = { q: "query", n: "limit", l: "region", h: "help" }
const BOOL_FLAGS = new Set(["worldwide", "help"])

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-")) {
      flags._.push(a)
      continue
    }
    const key = ALIAS[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
    let value: FlagValue = true
    const next = argv[i + 1]
    if (!BOOL_FLAGS.has(key) && next !== undefined && !next.startsWith("-")) {
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

function intFlag(name: string, raw: FlagValue | string[] | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    err(`--${name} must be a whole number of at least 1, got "${raw}"`)
    return null
  }
  return val
}

const HELP = `remoteok-cli - search remote jobs on Remote OK (remoteok.com)

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [--worldwide] [--region <text>] [--format json|table|plain]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>    Sent as Remote OK's tag (e.g. python, "data science"), then every
                        word must appear in the title, company or tags. Optional.
  --worldwide           Only jobs whose location says anywhere / worldwide / global.
  --region, -l <text>   Only jobs whose location text contains this (e.g. Europe, Asia, Brazil).
  --jobage <days>       Posted within N days (client-side).
  --limit, -n <n>       Cap results. Default 20.
  --format <fmt>        json (default) | table | plain.
  The API serves the latest ~100 jobs per call and has no pagination, so --page is not supported.

EXAMPLES
  bun run src/cli.ts search -q python --jobage 14 --format table
  bun run src/cli.ts search -q "data science" --worldwide --format table
  bun run src/cli.ts detail 1137796 --format plain

Source: Remote OK (https://remoteok.com). Link back to each job's Remote OK URL and name
Remote OK as the source (Remote OK API terms). Personal use, low volume.
`

const KNOWN: Record<string, Set<string>> = {
  search: new Set(["query", "worldwide", "region", "jobage", "limit", "format", "help"]),
  detail: new Set(["format", "help"]),
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = flags._[0]
  if (!cmd || flags.help) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }
  const known = KNOWN[cmd]
  if (!known) return err(`Unknown command "${cmd}"`, "BAD_CMD")
  for (const key of Object.keys(flags)) {
    if (key !== "_" && !known.has(key)) return err(`unknown flag --${key} for '${cmd}' - flags are never silently ignored; see --help`, "UNKNOWN_FLAG")
  }
  const extra = flags._.slice(cmd === "detail" ? 2 : 1)
  if (extra.length) return err(`unexpected argument "${extra[0]}" for '${cmd}'; see --help`)

  if (cmd === "search") {
    for (const name of ["query", "region"]) {
      const v = flags[name]
      if (v !== undefined && (typeof v !== "string" || !v.trim())) return err(`--${name} requires a non-empty value`)
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return err(`--format must be one of json|table|plain, got "${fmt}"`)
    const jobage = flags.jobage === undefined ? undefined : intFlag("jobage", flags.jobage, 0)
    if (jobage === null) return 1
    const limit = intFlag("limit", flags.limit, 20)
    if (limit === null) return 1
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      region: typeof flags.region === "string" ? flags.region.trim() : undefined,
      worldwide: flags.worldwide === true,
      jobage,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  const id = flags._[1]
  if (!id) return err("detail requires an <id|url>", "NO_ID")
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
