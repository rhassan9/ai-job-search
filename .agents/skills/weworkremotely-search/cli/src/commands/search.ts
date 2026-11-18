import { fetchFeed, type JobResult } from "../helpers.js"
import { cutoffDate, matchesAll, queryWords, stripInvisible, writeError } from "../text.js"

export interface SearchOpts {
  query?: string
  categories: string[]
  region?: string
  worldwide: boolean
  jobage?: number
  limit: number
  format: "json" | "table" | "plain"
}

/** Client-side filters: the feeds have no search parameters. */
export function applyFilters(results: JobResult[], opts: SearchOpts, now = Date.now()): JobResult[] {
  const words = queryWords(opts.query)
  const region = opts.region?.trim().toLowerCase()
  const cutoff = opts.jobage ? cutoffDate(opts.jobage, now) : null
  return results.filter((r) => {
    if (words.length && !matchesAll(words, [r.title, r.company ?? "", r.category ?? "", ...r.skills].join(" "))) return false
    if (opts.worldwide && !r.worldwide) return false
    if (region && ![r.region ?? "", ...r.countries].join(" ").toLowerCase().includes(region)) return false
    if (cutoff && r.date !== null && r.date < cutoff) return false
    return true
  })
}

/** Fetch each requested feed (or the all-jobs feed) and merge, de-duplicated by id. */
export async function collect(categories: string[]): Promise<JobResult[]> {
  const feeds = categories.length ? categories : [undefined]
  const seen = new Set<string>()
  const merged: JobResult[] = []
  for (const c of feeds) {
    for (const r of await fetchFeed(c)) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      merged.push(r)
    }
  }
  return merged.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
}

function cell(s: string | null, max: number): string {
  const t = (s ?? "-").replace(/\|/g, "/")
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function scopeCell(r: JobResult): string {
  if (r.countries.length > 2) return `${r.region ?? "Remote"} (${r.countries.length} countries)`
  return r.location ?? "not stated"
}

function renderTable(rs: JobResult[]): string {
  return [
    "| # | Title | Company | Region | Category | Type | Posted | URL |",
    "|---|---|---|---|---|---|---|---|",
    ...rs.map((r, i) => `| ${i + 1} | ${cell(r.title, 60)} | ${cell(r.company, 30)} | ${cell(scopeCell(r), 40)} | ${cell(r.category, 25)} | ${cell(r.employment_type, 12)} | ${r.date ?? "-"} | ${r.url} |`),
  ].join("\n")
}

function renderPlain(rs: JobResult[]): string {
  return rs
    .map((r) =>
      [
        r.title,
        `${r.company ?? "-"} · ${r.location ?? "region not stated"}`,
        `Category: ${r.category ?? "-"} · Type: ${r.employment_type ?? "-"} · Posted: ${r.date ?? "-"}`,
        r.skills.length ? `Skills: ${r.skills.join(", ")}` : null,
        `URL: ${r.url}`,
        `id: ${r.id}`,
      ]
        .filter((l): l is string => l !== null)
        .join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const results = stripInvisible(applyFilters(await collect(opts.categories), opts).slice(0, opts.limit))
    if (opts.format === "table") {
      process.stdout.write((results.length ? renderTable(results) : "No results.") + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write((results.length ? renderPlain(results) : "No results.") + "\n")
    } else {
      const meta = { count: results.length, page: 1, total: null, source: "We Work Remotely (weworkremotely.com)" }
      process.stdout.write(JSON.stringify({ meta, results }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
