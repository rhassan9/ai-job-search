// Data source: the Remote OK public JSON API (https://remoteok.com/api). One GET
// returns the latest ~100 jobs (optionally narrowed by `?tag=`), as an array whose
// first element is the API's legal notice. No key, no pagination, no detail
// endpoint. Remote OK's API terms: link back to the job's Remote OK URL and name
// Remote OK as the source.

import { cleanHtml, decodeHtmlEntities, getText } from "./text.js"

export const BASE_URL = "https://remoteok.com"
const UA = "Mozilla/5.0 (compatible; remoteok-cli/1.0)"

/** A Remote OK job - the fields this skill reads. */
export interface RemoteOkJob {
  id?: string | number
  slug?: string
  epoch?: number
  date?: string
  company?: string | null
  position?: string | null
  tags?: string[] | null
  description?: string | null
  location?: string | null
  apply_url?: string | null
  salary_min?: number | null
  salary_max?: number | null
  url?: string | null
}

/** A search result in the portal-skill contract shape plus Remote OK fields. */
export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  worldwide: boolean
  tags: string[]
  salary: string | null
  apply_url: string | null
  description: string | null
}

/** Location text that means "no country restriction". */
const WORLDWIDE = /\b(anywhere|worldwide|global(ly)?|any country|everywhere)\b/i

export function isWorldwide(location: string | null): boolean {
  return location !== null && WORLDWIDE.test(location)
}

function formatSalary(min: unknown, max: unknown): string | null {
  const lo = typeof min === "number" && min > 0 ? min : null
  const hi = typeof max === "number" && max > 0 ? max : null
  if (lo === null && hi === null) return null
  if (lo !== null && hi !== null) return `USD ${lo}-${hi}/year`
  return `USD ${lo ?? hi}/year`
}

/** The job's Remote OK page on the canonical host, or null when it is not one. */
export function canonicalUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.username || u.password || !/^(www\.)?remoteok\.(com|io)$/i.test(u.hostname)) return null
  if (!/^\/remote-jobs\/[a-z0-9-]+$/i.test(u.pathname)) return null
  return `${BASE_URL}${u.pathname}`
}

/** Reshape a Remote OK job into the contract fields. Null for the legal notice or a malformed entry. */
export function toResult(j: RemoteOkJob): JobResult | null {
  const id = j.id === undefined || j.id === null ? "" : String(j.id).trim()
  const url = canonicalUrl(j.url)
  if (!/^\d+$/.test(id) || !url || !j.position) return null
  const location = typeof j.location === "string" && j.location.trim() ? decodeHtmlEntities(j.location.trim()) : null
  const date = typeof j.epoch === "number" && j.epoch > 0 ? new Date(j.epoch * 1000).toISOString().slice(0, 10) : null
  return {
    id,
    title: decodeHtmlEntities(j.position).trim() || "(untitled)",
    company: typeof j.company === "string" && j.company.trim() ? decodeHtmlEntities(j.company.trim()) : null,
    location,
    date,
    url,
    worldwide: isWorldwide(location),
    tags: Array.isArray(j.tags) ? j.tags.filter((t): t is string => typeof t === "string") : [],
    salary: formatSalary(j.salary_min, j.salary_max),
    apply_url: typeof j.apply_url === "string" && j.apply_url ? j.apply_url : null,
    description: cleanHtml(j.description),
  }
}

/** Fetch the feed (optionally one tag) and return its parsed jobs. */
export async function fetchFeed(tag?: string): Promise<JobResult[]> {
  const url = tag ? `${BASE_URL}/api?tag=${encodeURIComponent(tag)}` : `${BASE_URL}/api`
  const body = await getText(url, UA, "application/json", "Remote OK API")
  if (body === null) return []
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new Error("Remote OK API returned an unparseable response body")
  }
  if (!Array.isArray(data)) throw new Error("Remote OK API returned an unexpected shape (not an array)")
  return data.map((j) => (j && typeof j === "object" ? toResult(j as RemoteOkJob) : null)).filter((r): r is JobResult => r !== null)
}

/** A `detail` argument: a numeric id, or a Remote OK job URL whose slug ends in the id. */
export function parseJobRef(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed
  const url = canonicalUrl(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  const m = url?.match(/-(\d+)$/)
  return m ? m[1] : null
}
