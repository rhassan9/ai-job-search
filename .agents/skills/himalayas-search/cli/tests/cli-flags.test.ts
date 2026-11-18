// CLI-level argument validation. Every case here fails before any request is
// made, so these tests never touch the network.
import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

async function expectBadArg(args: string[], code = "BAD_ARG"): Promise<string> {
  const r = await runCLI(args)
  expect(r.exitCode).toBe(1)
  expect(r.stdout).toBe("")
  const parsed = JSON.parse(r.stderr)
  expect(parsed.code).toBe(code)
  return parsed.error as string
}

describe("cli validation", () => {
  test("no command prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })

  test("search --help exits 0", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("--worldwide")
  })

  test("unknown flags are rejected, never ignored", async () => {
    await expectBadArg(["search", "--remote", "remote"], "UNKNOWN_FLAG")
    await expectBadArg(["detail", "acme/x", "--limit", "3"], "UNKNOWN_FLAG")
  })

  test("unknown command", async () => {
    await expectBadArg(["browse"], "BAD_CMD")
  })

  test("vocabulary flags reject unknown values", async () => {
    expect(await expectBadArg(["search", "--seniority", "Junior"])).toContain("Entry-level")
    await expectBadArg(["search", "--employment-type", "Freelance"])
    await expectBadArg(["search", "--sort", "newest"])
  })

  test("numeric flags must be whole numbers >= 1", async () => {
    await expectBadArg(["search", "--jobage", "0"])
    await expectBadArg(["search", "--page", "1.5"])
    await expectBadArg(["search", "--limit", "x"])
  })

  test("timezone must look like a UTC offset", async () => {
    await expectBadArg(["search", "--timezone", "PKT"])
  })

  test("empty values and contradictions are rejected", async () => {
    await expectBadArg(["search", "--query", ""])
    await expectBadArg(["search", "--country"])
    await expectBadArg(["search", "--exclude-worldwide"])
    await expectBadArg(["search", "--country", "PK", "--worldwide", "--exclude-worldwide"])
    await expectBadArg(["search", "--country", "PK", "--location", "IN"])
    await expectBadArg(["search", "--strict"])
  })

  test("bad format and stray arguments", async () => {
    await expectBadArg(["search", "--format", "csv"])
    await expectBadArg(["detail", "acme/x", "--format", "table"])
    await expectBadArg(["search", "python"])
  })

  test("detail needs an id", async () => {
    await expectBadArg(["detail"], "NO_ID")
  })
})
