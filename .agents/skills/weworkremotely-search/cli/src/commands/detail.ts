import { CATEGORIES, fetchFeed, jobSlug, type JobResult } from "../helpers.js"
import { stripInvisible, writeError } from "../text.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** A `detail` argument: a job slug or a weworkremotely.com job URL. */
export function parseJobRef(input: string): string | null {
  const t = input.trim()
  if (/^[a-z0-9][a-z0-9-]*$/i.test(t)) return t
  return jobSlug(t)
}

function renderPlain(r: JobResult): string {
  const lines = [r.title, `${r.company ?? "-"} · ${r.region ?? "region not stated"}`]
  if (r.countries.length) lines.push(`Countries: ${r.countries.join(", ")}`)
  if (r.state) lines.push(`State/province: ${r.state}`)
  lines.push(`Category: ${r.category ?? "-"} · Type: ${r.employment_type ?? "-"}`)
  if (r.skills.length) lines.push(`Skills: ${r.skills.join(", ")}`)
  if (r.date) lines.push(`Posted: ${r.date}`)
  if (r.expiry_date) lines.push(`Expires: ${r.expiry_date}`)
  lines.push("", r.description ?? "(no description)", "", `URL: ${r.url}`, `id: ${r.id}`, "Source: We Work Remotely")
  return lines.join("\n")
}

/**
 * The feeds have no per-job endpoint: look the job up in the all-jobs feed, then
 * each category feed, stopping at the first hit. A job no longer in any feed
 * answers NOT_FOUND.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = parseJobRef(opts.id)
  if (!slug) {
    writeError(`could not parse a We Work Remotely job slug or URL from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    for (const category of [undefined, ...Object.keys(CATEGORIES)]) {
      const job = (await fetchFeed(category)).find((r) => r.id === slug)
      if (job) {
        const clean = stripInvisible(job)
        process.stdout.write((opts.format === "plain" ? renderPlain(clean) : JSON.stringify(clean, null, 2)) + "\n")
        return 0
      }
    }
    writeError("job not in any current We Work Remotely feed (it may have expired); open its url instead", "NOT_FOUND")
    return 1
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
