// Data source: We Work Remotely's public RSS feeds (https://weworkremotely.com/remote-job-rss-feed).
// The all-jobs feed carries the latest ~100 jobs (about 10 per category); each
// category feed carries more of that category. Every item states its `region`
// ("Anywhere in the World", "USA Only", "Asia Only", ...) and often a country
// list, which is exactly what the Remote Eligibility Gate needs. No key, no
// search endpoint, no pagination: filtering happens client-side.

import { cleanHtml, decodeHtmlEntities, getText } from "./text.js"

export const BASE_URL = "https://weworkremotely.com"
const UA = "Mozilla/5.0 (compatible; weworkremotely-cli/1.0)"

/** `--category` short names -> feed slugs under /categories/<slug>.rss. */
export const CATEGORIES: Record<string, string> = {
  programming: "remote-programming-jobs",
  "full-stack": "remote-full-stack-programming-jobs",
  "back-end": "remote-back-end-programming-jobs",
  "front-end": "remote-front-end-programming-jobs",
  devops: "remote-devops-sysadmin-jobs",
  design: "remote-design-jobs",
  product: "remote-product-jobs",
  "customer-support": "remote-customer-support-jobs",
  "sales-marketing": "remote-sales-and-marketing-jobs",
  "management-finance": "remote-management-and-finance-jobs",
  other: "all-other-remote-jobs",
}

export function feedUrl(category?: string): string {
  return category ? `${BASE_URL}/categories/${CATEGORIES[category]}.rss` : `${BASE_URL}/remote-jobs.rss`
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  worldwide: boolean
  region: string | null
  countries: string[]
  state: string | null
  category: string | null
  employment_type: string | null
  skills: string[]
  expiry_date: string | null
  description: string | null
}

/** Text of one RSS child element (CDATA unwrapped, entities decoded), or null. */
function field(item: string, name: string): string | null {
  const m = item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  if (!m) return null
  const raw = m[1].trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
  const text = decodeHtmlEntities(raw).trim()
  return text || null
}

function isoDate(rfc822: string | null): string | null {
  if (!rfc822) return null
  const t = Date.parse(rfc822)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

/** Country names from WWR's "🇺🇸 United States, 🇨🇦 Canada, and 🇲🇽 Mexico" list, flags removed. */
export function parseCountries(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** The job slug of a WWR job URL, or null for any other host or path. */
export function jobSlug(raw: string): string | null {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (u.username || u.password || !/^(www\.)?weworkremotely\.com$/i.test(u.hostname)) return null
  const m = u.pathname.match(/^\/remote-jobs\/([a-z0-9][a-z0-9-]*)\/?$/i)
  return m ? m[1] : null
}

const SCOPE_NAMES = 5

/** Human-readable scope: the region, plus the named countries when there are a few. */
export function locationScope(region: string | null, countries: string[]): string | null {
  if (countries.length === 0) return region
  const names = countries.length <= SCOPE_NAMES ? countries.join(", ") : `${countries.slice(0, SCOPE_NAMES).join(", ")} +${countries.length - SCOPE_NAMES} more`
  return region ? `${region} (${names})` : names
}

/** Parse one `<item>` chunk; null when it lacks a usable link or title. */
export function parseItem(item: string): JobResult | null {
  const link = field(item, "link") ?? field(item, "guid")
  const slug = link ? jobSlug(link) : null
  const rawTitle = field(item, "title")
  if (!slug || !rawTitle) return null
  // Titles are "Company: Role". A role can itself contain ": ", so split once.
  const sep = rawTitle.indexOf(": ")
  const company = sep > 0 ? rawTitle.slice(0, sep).trim() : null
  const title = (sep > 0 ? rawTitle.slice(sep + 2) : rawTitle).trim() || "(untitled)"
  const region = field(item, "region")
  const countries = parseCountries(field(item, "country"))
  const skills = (field(item, "skills") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return {
    id: slug,
    title,
    company,
    location: locationScope(region, countries),
    date: isoDate(field(item, "pubDate")),
    url: `${BASE_URL}/remote-jobs/${slug}`,
    worldwide: region !== null && /^anywhere in the world$/i.test(region),
    region,
    countries,
    state: field(item, "state"),
    category: field(item, "category"),
    employment_type: field(item, "type"),
    skills,
    expiry_date: isoDate(field(item, "expires_at")),
    description: cleanHtml(field(item, "description")),
  }
}

/** Split a feed into `<item>` chunks and parse each independently, so one bad item cannot break the rest. */
export function parseFeed(xml: string): JobResult[] {
  const out: JobResult[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    try {
      const r = parseItem(m[1])
      if (r) out.push(r)
    } catch {
      // A malformed item is skipped; the rest of the feed still parses.
    }
  }
  return out
}

export async function fetchFeed(category?: string): Promise<JobResult[]> {
  // The all-jobs feed is ~2 MB, so allow longer than the default 20 s.
  const xml = await getText(feedUrl(category), UA, "application/rss+xml, application/xml", "We Work Remotely feed", 60000)
  return xml === null ? [] : parseFeed(xml)
}
