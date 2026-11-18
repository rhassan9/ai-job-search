import {
  apiGet,
  formatOffsets,
  stripInvisible,
  toResult,
  writeError,
  type JobResult,
  type SearchEnvelope,
} from "../helpers.js"

export const SENIORITY = ["Entry-level", "Mid-level", "Senior", "Manager", "Director", "Executive"] as const
export const EMPLOYMENT_TYPES = ["Full Time", "Part Time", "Contractor", "Temporary", "Intern", "Volunteer", "Other"] as const
export const SORTS = ["relevant", "recent", "salaryAsc", "salaryDesc", "nameAToZ", "nameZToA", "jobs"] as const

/** Himalayas serves search results 20 to a page; --limit caps client-side. */
export const PAGE_SIZE = 20

export interface SearchOpts {
  query?: string
  country?: string
  worldwide: boolean
  excludeWorldwide: boolean
  seniority: string[]
  employmentType: string[]
  timezone?: string
  company: string[]
  sort?: string
  jobage?: number
  strict: boolean
  page: number
  limit: number
  format: "json" | "table" | "plain"
}

/** The query string for /jobs/api/search. */
export function buildSearchPath(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("q", opts.query)
  if (opts.country) params.set("country", opts.country)
  if (opts.worldwide) params.set("worldwide", "true")
  if (opts.excludeWorldwide) params.set("exclude_worldwide", "true")
  if (opts.seniority.length) params.set("seniority", opts.seniority.join(","))
  if (opts.employmentType.length) params.set("employment_type", opts.employmentType.join(","))
  if (opts.timezone) params.set("timezone", opts.timezone)
  if (opts.company.length) params.set("company", opts.company.join(","))
  // The API has no posting-age parameter: --jobage filters client-side, so ask
  // for the newest jobs first unless the caller chose an order.
  const sort = opts.sort ?? (opts.jobage ? "recent" : undefined)
  if (sort) params.set("sort", sort)
  if (opts.page > 1) params.set("page", String(opts.page))
  const qs = params.toString()
  return `/jobs/api/search${qs ? `?${qs}` : ""}`
}

/**
 * With --strict, keep only results whose title or categories contain every query
 * word. Himalayas ranks by relevance rather than filtering, so a "data engineer"
 * search also returns React and QA roles.
 */
export function strictMatch(results: JobResult[], query: string | undefined): JobResult[] {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return results
  return results.filter((r) => {
    const hay = [r.title, ...r.categories.map((c) => c.replace(/-/g, " "))].join(" ").toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** Keep results posted within `days` of `now`; a result with no date is kept (flagged by /scrape as "date unknown"). */
export function withinAge(results: JobResult[], days: number | undefined, now = Date.now()): JobResult[] {
  if (!days) return results
  const cutoff = new Date(now - days * 86_400_000).toISOString().slice(0, 10)
  return results.filter((r) => r.date === null || r.date >= cutoff)
}

function truncate(text: string | null, max: number): string {
  const t = text ?? "-"
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** A table-width scope: "Worldwide", up to two countries, or a country count. */
function scopeCell(r: JobResult): string {
  if (r.worldwide) return "Worldwide"
  const list = r.location_restrictions
  return list.length <= 2 ? list.join(", ") : `${list.length} countries`
}

function renderTable(results: JobResult[]): string {
  const header = "| # | Title | Company | Scope | Time zones (UTC) | Type | Posted | URL |"
  const sep = "|---|---|---|---|---|---|---|---|"
  const rows = results.map((r, i) => {
    const cell = (s: string) => s.replace(/\|/g, "/")
    return `| ${i + 1} | ${cell(truncate(r.title, 60))} | ${cell(truncate(r.company, 30))} | ${cell(scopeCell(r))} | ${cell(truncate(formatOffsets(r.timezone_restrictions), 30))} | ${cell(r.employment_type ?? "-")} | ${r.date ?? "-"} | ${r.url} |`
  })
  return [header, sep, ...rows].join("\n")
}

function renderPlain(results: JobResult[]): string {
  return results
    .map((r) =>
      [
        r.title,
        `${r.company ?? "-"} · ${r.location ?? "-"}`,
        `Time zones (UTC): ${formatOffsets(r.timezone_restrictions)}`,
        `Type: ${r.employment_type ?? "-"} · Seniority: ${r.seniority.join(", ") || "-"} · Posted: ${r.date ?? "-"}`,
        r.salary ? `Salary: ${r.salary}` : null,
        `URL: ${r.url}`,
        `id: ${r.id}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const env = await apiGet<SearchEnvelope>(buildSearchPath(opts))
    const jobs = env && Array.isArray(env.jobs) ? env.jobs : []
    const parsed = jobs.map(toResult).filter((r): r is JobResult => r !== null)
    const matched = opts.strict ? strictMatch(parsed, opts.query) : parsed
    const results = stripInvisible(withinAge(matched, opts.jobage).slice(0, opts.limit))

    if (opts.format === "table") {
      process.stdout.write((results.length ? renderTable(results) : "No results.") + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write((results.length ? renderPlain(results) : "No results.") + "\n")
    } else {
      const meta = {
        count: results.length,
        page: opts.page,
        total: typeof env?.totalCount === "number" ? env.totalCount : null,
        source: "himalayas.app",
      }
      process.stdout.write(JSON.stringify({ meta, results }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
