import { fetchFeed, type JobResult } from "../helpers.js"
import { cutoffDate, matchesAll, queryWords, stripInvisible, writeError } from "../text.js"

export interface SearchOpts {
  query?: string
  region?: string
  worldwide: boolean
  jobage?: number
  limit: number
  format: "json" | "table" | "plain"
}

/** Remote OK's tag for a query: the query itself, lower-cased (tags are words like "python", "data science"). */
export function tagFor(query: string | undefined): string | undefined {
  const tag = (query ?? "").trim().toLowerCase().replace(/["']/g, "")
  return tag || undefined
}

/** Client-side filters on top of the tag feed. */
export function applyFilters(results: JobResult[], opts: SearchOpts, now = Date.now()): JobResult[] {
  const words = queryWords(opts.query)
  const region = opts.region?.trim().toLowerCase()
  const cutoff = opts.jobage ? cutoffDate(opts.jobage, now) : null
  return results.filter((r) => {
    // The tag feed is loose (a tag search returns unrelated roles), so every
    // query word must appear in the title, company or tags.
    if (words.length && !matchesAll(words, [r.title, r.company ?? "", ...r.tags].join(" "))) return false
    if (opts.worldwide && !r.worldwide) return false
    if (region && !(r.location ?? "").toLowerCase().includes(region)) return false
    if (cutoff && r.date !== null && r.date < cutoff) return false
    return true
  })
}

function cell(s: string | null, max: number): string {
  const t = (s ?? "-").replace(/\|/g, "/")
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function renderTable(rs: JobResult[]): string {
  return [
    "| # | Title | Company | Location | Tags | Posted | URL |",
    "|---|---|---|---|---|---|---|",
    ...rs.map((r, i) => `| ${i + 1} | ${cell(r.title, 60)} | ${cell(r.company, 30)} | ${cell(r.location ?? "not stated", 30)} | ${cell(r.tags.slice(0, 4).join(", "), 40)} | ${r.date ?? "-"} | ${r.url} |`),
  ].join("\n")
}

function renderPlain(rs: JobResult[]): string {
  return rs
    .map((r) =>
      [
        r.title,
        `${r.company ?? "-"} · ${r.location ?? "location not stated"}`,
        `Tags: ${r.tags.join(", ") || "-"} · Posted: ${r.date ?? "-"}`,
        r.salary ? `Salary: ${r.salary}` : null,
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
    const all = await fetchFeed(tagFor(opts.query))
    const results = stripInvisible(applyFilters(all, opts).slice(0, opts.limit))
    if (opts.format === "table") {
      process.stdout.write((results.length ? renderTable(results) : "No results.") + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write((results.length ? renderPlain(results) : "No results.") + "\n")
    } else {
      const meta = { count: results.length, page: 1, total: null, source: "Remote OK (remoteok.com)" }
      process.stdout.write(JSON.stringify({ meta, results }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
