// Data source: the Himalayas public remote-jobs JSON API (https://himalayas.app/api).
// Reads are unauthenticated - no API key - and the API returns JSON, so there is no
// markup to parse for search results: we reshape each job into the portal-skill
// contract's result fields. Every job on Himalayas is remote; what varies is WHERE
// the hire may live (locationRestrictions) and which time zones it must cover
// (timezoneRestrictions). Both are passed through so /scrape and /rank can run the
// Remote Eligibility Gate on them.

export const BASE_URL = "https://himalayas.app"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// An honest User-Agent naming the tool, per the portal-skill contract.
const UA = "Mozilla/5.0 (compatible; himalayas-cli/1.0)"

// The most apiGet sleeps across all retries of one request, so an outage
// degrades this source quickly instead of outlasting the caller's tool timeout.
const RETRY_BUDGET_MS = 30_000

/** The wait a 429/503 asks for via `Retry-After`, in ms, or null when absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(date - now, 0)
}

/**
 * GET JSON from the Himalayas API. Retries 429/5xx with exponential backoff and
 * jitter (max 6 retries, honouring Retry-After within RETRY_BUDGET_MS); returns
 * `null` on a 404. A connection failure fails fast with a clear message.
 */
export async function apiGet<T>(path: string): Promise<T | null> {
  const url = `${BASE_URL}${path}`
  const maxRetries = 6
  let delay = 500
  let waited = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new Error(`could not reach the Himalayas API (${e instanceof Error ? e.message : String(e)})`)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Himalayas API request failed: ${response.status} ${response.statusText}`)
      }
      const backoff = delay + Math.floor(Math.random() * 500)
      const wait = Math.max(backoff, retryAfterMs(response.headers.get("Retry-After")) ?? 0)
      if (waited + wait > RETRY_BUDGET_MS) {
        throw new Error(
          `Himalayas API request failed: ${response.status} ${response.statusText}; ` +
            `the server asked to retry in ${Math.ceil(wait / 1000)}s, past this CLI's ${RETRY_BUDGET_MS / 1000}s retry budget`,
        )
      }
      await sleep(wait)
      waited += wait
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Himalayas API request failed: ${response.status} ${response.statusText}`)

    const body = (await response.json().catch(() => null)) as T | null
    if (body === null) throw new Error("Himalayas API returned an unparseable response body")
    return body
  }
  throw new Error("Himalayas API request failed after retries")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** A Himalayas job object - the fields this skill reads (the wire shape carries more). */
export interface HimalayasJob {
  title: string
  excerpt?: string | null
  companyName?: string | null
  companySlug?: string | null
  employmentType?: string | null
  minSalary?: number | null
  maxSalary?: number | null
  salaryPeriod?: string | null
  currency?: string | null
  seniority?: string[] | null
  locationRestrictions?: string[] | null
  timezoneRestrictions?: number[] | null
  categories?: string[] | null
  description?: string | null
  pubDate?: number | null
  expiryDate?: number | null
  applicationLink?: string | null
  guid: string
}

/** The search and browse envelope. */
export interface SearchEnvelope {
  totalCount?: number
  offset?: number
  limit?: number
  jobs?: HimalayasJob[]
}

/** The single-job envelope. */
export interface DetailEnvelope {
  job?: HimalayasJob
}

/**
 * A search result in the portal-skill contract shape: `id`, `title`, `company`,
 * `location`, `date`, `url` (missing values are `null`, never omitted), plus the
 * remote-eligibility fields as a permitted superset.
 *
 * `location` is the human-readable scope ("Worldwide" or the restriction list),
 * `worldwide` is true when the job carries no country restriction, and
 * `timezone_restrictions` lists the UTC offsets the hire may work from (empty =
 * not stated). `url` is the Himalayas job page; `apply_url` is the employer's
 * application link, passed through unchanged as the API terms require.
 */
export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  worldwide: boolean
  location_restrictions: string[]
  timezone_restrictions: number[]
  employment_type: string | null
  seniority: string[]
  salary: string | null
  expiry_date: string | null
  apply_url: string | null
  excerpt: string | null
  categories: string[]
}

export interface JobDetailResult extends JobResult {
  description: string | null
}

/** `YYYY-MM-DD` from a unix timestamp in seconds, or null. */
export function isoDate(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** How many restriction countries `location` names before summarising the rest. */
const SCOPE_NAMES = 5

/**
 * Human-readable location scope for the contract's `location` field. Some jobs
 * list 50+ countries; the first few are named and the rest counted, while the
 * full list stays in `location_restrictions`.
 */
export function locationScope(restrictions: string[]): string {
  if (restrictions.length === 0) return "Worldwide (remote)"
  if (restrictions.length <= SCOPE_NAMES) return `Remote: ${restrictions.join(", ")}`
  const rest = restrictions.length - SCOPE_NAMES
  return `Remote: ${restrictions.slice(0, SCOPE_NAMES).join(", ")} +${rest} more`
}

function formatSalary(j: HimalayasJob): string | null {
  const min = typeof j.minSalary === "number" ? j.minSalary : null
  const max = typeof j.maxSalary === "number" ? j.maxSalary : null
  if (min === null && max === null) return null
  const cur = j.currency ? `${j.currency} ` : ""
  const per = j.salaryPeriod ? `/${j.salaryPeriod}` : ""
  if (min !== null && max !== null) return `${cur}${min}-${max}${per}`
  return `${cur}${min ?? max}${per}`
}

/**
 * The detail id for a job: `<companySlug>/<jobSlug>`, taken from the job's guid
 * (`https://himalayas.app/companies/<company>/jobs/<slug>`). Null when the guid is
 * not a Himalayas job URL.
 */
export function jobId(guid: string): string | null {
  const path = himalayasJobPath(guid)
  return path ? `${path.company}/${path.slug}` : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : []
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : []
}

/** Reshape a Himalayas job into the contract search-result fields. Null for a job without a usable guid. */
export function toResult(j: HimalayasJob): JobResult | null {
  const id = typeof j.guid === "string" ? jobId(j.guid) : null
  if (!id) return null
  const restrictions = strings(j.locationRestrictions)
  return {
    id,
    title: decodeHtmlEntities(j.title || "").trim() || "(untitled)",
    company: j.companyName?.trim() || null,
    location: locationScope(restrictions),
    date: isoDate(j.pubDate),
    url: j.guid.split("?")[0],
    worldwide: restrictions.length === 0,
    location_restrictions: restrictions,
    timezone_restrictions: numbers(j.timezoneRestrictions),
    employment_type: j.employmentType?.trim() || null,
    seniority: strings(j.seniority),
    salary: formatSalary(j),
    expiry_date: isoDate(j.expiryDate),
    apply_url: typeof j.applicationLink === "string" && j.applicationLink ? j.applicationLink : null,
    excerpt: j.excerpt ? cleanHtml(j.excerpt) : null,
    categories: strings(j.categories),
  }
}

export function toDetail(j: HimalayasJob): JobDetailResult | null {
  const base = toResult(j)
  if (!base) return null
  return { ...base, description: cleanHtml(j.description) }
}

function signed(o: number): string {
  return o > 0 ? `+${o}` : String(o)
}

/**
 * Format UTC offsets for display. Up to four are listed ("+5, +5.5"); a longer
 * list is shown as its span and count ("-11 to +14 (37 offsets)"), since a span
 * alone would hide gaps. Empty -> "any (not stated)".
 */
export function formatOffsets(offsets: number[]): string {
  if (offsets.length === 0) return "any (not stated)"
  if (offsets.length <= 4) return offsets.map(signed).join(", ")
  const sorted = [...offsets].sort((a, b) => a - b)
  return `${signed(sorted[0])} to ${signed(sorted[sorted.length - 1])} (${offsets.length} offsets)`
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

/**
 * Characters a reader of the posting never sees but a model reading this output
 * does: C0/C1 controls other than tab/newline/CR, soft hyphen, bidi controls,
 * zero-width characters, the BOM, variation selectors and Unicode tag characters.
 * Copied from the community portals' output-hygiene contract.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ""
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments, <script>/<style>/<template>
 * blocks, and elements marked hidden - before tags are stripped, so text the
 * posting's reader never saw does not reach the model.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  const tags = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[\s/](?:[^>"']|"[^"]*"|'[^']*')*)?)>/g
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = tags.exec(src)) !== null) {
    if (m[1] || !m[3] || !isHiddenTag(m[3])) continue
    const tag = m[2].toLowerCase()
    let end = tags.lastIndex
    if (!VOID_TAGS.has(tag)) {
      // Skip to the matching close tag; an unclosed hidden element runs to the end
      // (failing closed drops visible text, failing open would leak hidden text).
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = tags.exec(src)) !== null) {
        if (s[2].toLowerCase() !== tag) continue
        depth += s[1] ? -1 : 1
        if (depth === 0) {
          end = tags.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    tags.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

/** Strip HTML into readable prose: block tags become newlines, entities decoded. Null for empty input. */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = visibleHtml(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

const HIMALAYAS_HOST = /(^|\.)himalayas\.app$/i
const SLUG = /^[a-z0-9][a-z0-9-]*$/i

/**
 * The company and job slug of a Himalayas job URL
 * (`https://himalayas.app/companies/<company>/jobs/<slug>`), or null. URLs are
 * parsed for real, so look-alike hosts (himalayas.app.evil.io) and userinfo tricks
 * (himalayas.app@evil.io) are rejected.
 */
export function himalayasJobPath(input: string): { company: string; slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return null
  }
  if (parsed.username || parsed.password || !HIMALAYAS_HOST.test(parsed.hostname)) return null
  const m = parsed.pathname.match(/^\/companies\/([a-z0-9][a-z0-9-]*)\/jobs\/([a-z0-9][a-z0-9-]*)\/?$/i)
  return m ? { company: m[1], slug: m[2] } : null
}

/** Parse a `detail` argument: a `<company>/<slug>` id or a Himalayas job URL. */
export function parseJobRef(input: string): { company: string; slug: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(trimmed)) return himalayasJobPath(trimmed)
  const parts = trimmed.split("/")
  if (parts.length === 2 && SLUG.test(parts[0]) && SLUG.test(parts[1])) return { company: parts[0], slug: parts[1] }
  return null
}
