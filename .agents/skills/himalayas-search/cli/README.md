# himalayas-cli

Search remote jobs on [Himalayas](https://himalayas.app) through its public JSON API,
worldwide or by the country you may work from. Zero runtime dependencies; `bun install`
only pulls TypeScript dev types.

```bash
bun install          # optional: dev types for typecheck
bun run typecheck
bun run test         # network-free
bun run src/cli.ts search -q "python" --country PK --jobage 14 --format table
bun run src/cli.ts detail <company/slug> --format plain
```

See `../SKILL.md` for every flag and the API terms, and `../url-reference.md` for the
endpoints and fields. The tests stub `fetch` and fail on any request to a host other
than himalayas.app; argument-validation tests exit before any request is made.
