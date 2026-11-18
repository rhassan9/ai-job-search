// Argument validation: every case fails before any request, so no network.
import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

async function bad(args: string[], code = "BAD_ARG"): Promise<void> {
  const r = await runCLI(args)
  expect(r.exitCode).toBe(1)
  expect(r.stdout).toBe("")
  expect(JSON.parse(r.stderr).code).toBe(code)
}

describe("cli validation", () => {
  test("help", async () => {
    expect((await runCLI([])).exitCode).toBe(1)
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("--worldwide")
  })
  test("unknown flags, commands and arguments", async () => {
    await bad(["search", "--page", "2"], "UNKNOWN_FLAG")
    await bad(["browse"], "BAD_CMD")
    await bad(["search", "python"])
  })
  test("values", async () => {
    await bad(["search", "--query"])
    await bad(["search", "--jobage", "0"])
    await bad(["search", "--limit", "two"])
    await bad(["search", "--format", "csv"])
    await bad(["detail"], "NO_ID")
    await bad(["detail", "1", "--format", "table"])
  })
})
