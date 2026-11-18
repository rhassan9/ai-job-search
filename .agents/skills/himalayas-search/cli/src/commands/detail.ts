import {
  apiGet,
  formatOffsets,
  parseJobRef,
  stripInvisible,
  toDetail,
  writeError,
  type DetailEnvelope,
  type JobDetailResult,
} from "../helpers.js"

export interface DetailOpts {
  id: string // `<company>/<slug>` or a https://himalayas.app/companies/<company>/jobs/<slug> URL
  format: "json" | "plain"
}

function renderPlain(job: JobDetailResult): string {
  // Detail shows the full restriction list; `location` summarises long ones.
  const scope = job.worldwide ? job.location : `Remote: ${job.location_restrictions.join(", ")}`
  const lines = [job.title, `${job.company ?? "-"} · ${scope ?? "-"}`]
  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Time zones (UTC)", formatOffsets(job.timezone_restrictions))
  field("Employment", job.employment_type)
  field("Seniority", job.seniority.join(", ") || null)
  field("Salary", job.salary)
  field("Posted", job.date)
  field("Expires", job.expiry_date)
  lines.push("", job.description ?? "(no description)", "", `URL: ${job.url}`)
  if (job.apply_url) lines.push(`Apply: ${job.apply_url}`)
  lines.push(`id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = parseJobRef(opts.id)
  if (!ref) {
    writeError(`could not parse a Himalayas job id or URL from "${opts.id}" (want <company>/<slug> or a himalayas.app job URL)`, "BAD_ID")
    return 1
  }
  try {
    const env = await apiGet<DetailEnvelope>(
      `/jobs/api/companies/${encodeURIComponent(ref.company)}/jobs/${encodeURIComponent(ref.slug)}`,
    )
    const job = env?.job ? toDetail(env.job) : null
    if (!job) {
      writeError("job not found (it may have expired)", "NOT_FOUND")
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
