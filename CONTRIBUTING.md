# Contributing

Thanks for your interest in improving the Revolut Business MCP server!

## Development setup

```bash
npm install
cp .env.example .env    # fill in your REVOLUT_* credentials and /mcp auth
npm run authorize       # one-time: obtain REVOLUT_REFRESH_TOKEN (use a sandbox cert first)
npm run dev             # Skybridge dev server + DevTools at http://localhost:3000
```

> Use the Revolut **sandbox** (`REVOLUT_ENVIRONMENT=sandbox`) for development — it has test
> accounts and simulation endpoints, so you never touch real money.

## Before opening a PR

```bash
npm run build   # typecheck (tsc)
npm test        # vitest
```

CI runs the same checks plus `docker build` and `npm audit`.

## Guidelines

- **Keep Revolut logic transport-agnostic.** Everything in `src/revolut`, `src/config.ts`, and
  `src/tools` should stay independent of Skybridge so the framework/transport can evolve.
- **Respect the capability tiers.** New write tools must be gated behind the appropriate flag
  (`REVOLUT_ENABLE_DRAFTS` / `REVOLUT_ENABLE_PAYMENTS`) and registered conditionally in
  `src/tools/index.ts`. Read tools are always on.
- **Money movement is irreversible.** Any tool that moves money (pay/transfer/exchange) or
  deletes a resource must be a separate, payments-tier tool with an explicit `confirm` argument —
  never a flag on a read/draft tool. Generate a `request_id` server-side for idempotency.
- **Never log secrets or PII.** Add tests for safety-critical behavior.
- Add a `CHANGELOG.md` entry for user-facing changes.
