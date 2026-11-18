// Output hygiene shared by this portal's commands (copied from the community
// portals' contract): listing text is third-party data, so text a reader of the
// posting never sees must not reach the model.

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/** Decode the HTML entities job feeds use. `&amp;` goes last so `&amp;lt;` stays `&lt;`. */
export function decodeHtmlEntities(text: string): string {
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
 * Characters a reader never sees but a model does: C0/C1 controls other than
 * tab/newline/CR, soft hyphen, bidi controls, zero-width characters, the BOM,
 * variation selectors and Unicode tag characters.
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

/** Drop comments, script/style/template blocks and hidden elements before tags are stripped. */
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
      // An unclosed hidden element runs to the end: failing closed drops visible
      // text, failing open would leak hidden text.
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

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** The wait a 429/503 asks for via `Retry-After`, in ms, or null. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(date - now, 0)
}

const RETRY_BUDGET_MS = 30_000

/**
 * GET a URL as text with an honest User-Agent. Retries 429/5xx with exponential
 * backoff and jitter (max 6, honouring Retry-After within 30 s); `null` on 404;
 * a connection failure fails fast.
 */
export async function getText(url: string, userAgent: string, accept: string, source: string, timeoutMs = 20000): Promise<string | null> {
  let delay = 500
  let waited = 0
  for (let attempt = 0; attempt <= 6; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": userAgent, Accept: accept },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      throw new Error(`could not reach ${source} (${e instanceof Error ? e.message : String(e)})`)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 6) throw new Error(`${source} request failed: ${response.status} ${response.statusText}`)
      const wait = Math.max(delay + Math.floor(Math.random() * 500), retryAfterMs(response.headers.get("Retry-After")) ?? 0)
      if (waited + wait > RETRY_BUDGET_MS) {
        throw new Error(`${source} request failed: ${response.status}; retry would exceed this CLI's ${RETRY_BUDGET_MS / 1000}s budget`)
      }
      await new Promise((r) => setTimeout(r, wait))
      waited += wait
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`${source} request failed: ${response.status} ${response.statusText}`)
    return await response.text()
  }
  throw new Error(`${source} request failed after retries`)
}

/** Lower-cased words of a query, for client-side matching. */
export function queryWords(query: string | undefined): string[] {
  return (query ?? "").toLowerCase().split(/\s+/).map((w) => w.replace(/^["']+|["']+$/g, "")).filter(Boolean)
}

/** True when every query word appears in the haystack (case-insensitive). */
export function matchesAll(words: string[], haystack: string): boolean {
  const h = haystack.toLowerCase()
  return words.every((w) => h.includes(w))
}

/** `YYYY-MM-DD` cutoff for `days` before `now`. */
export function cutoffDate(days: number, now = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10)
}
