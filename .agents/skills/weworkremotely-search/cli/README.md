# weworkremotely-cli

Zero runtime dependencies; `bun install` only pulls TypeScript dev types.

```bash
bun run typecheck
bun run test         # network-free: fetch is stubbed and any other host fails the test
bun run src/cli.ts search -q python --format table
```

See `../SKILL.md` for flags and terms, `../url-reference.md` for the data source.
