import { fetchFeed, parseJobRef, type JobResult } from "../helpers.js"
import { stripInvisible, writeError } from "../text.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

function renderPlain(r: JobResult): string {
  const lines = [r.title, `${r.company ?? "-"} · ${r.location ?? "location not stated"}`]
  if (r.tags.length) lines.push(`Tags: ${r.tags.join(", ")}`)
  if (r.salary) lines.push(`Salary: ${r.salary}`)
  if (r.date) lines.push(`Posted: ${r.date}`)
  lines.push("", r.description ?? "(no description)", "", `URL: ${r.url}`)
  if (r.apply_url) lines.push(`Apply: ${r.apply_url}`)
  lines.push(`id: ${r.id}`, "Source: Remote OK")
  return lines.join("\n")
}

/**
 * Remote OK has no detail endpoint: a job is looked up in the current feed. A job
 * that has dropped out of the feed (the latest ~100) answers NOT_FOUND.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = parseJobRef(opts.id)
  if (!id) {
    writeError(`could not parse a Remote OK job id or URL from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const job = (await fetchFeed()).find((r) => r.id === id)
    if (!job) {
      writeError("job not in the current Remote OK feed (it may be older than the latest ~100 jobs, or closed); open its url instead", "NOT_FOUND")
      return 1
    }
    const clean = stripInvisible(job)
    process.stdout.write((opts.format === "plain" ? renderPlain(clean) : JSON.stringify(clean, null, 2)) + "\n")
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
