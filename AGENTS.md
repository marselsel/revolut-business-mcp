This is an open-source MCP server for the Revolut Business API, built with the Skybridge
framework. When planning or updating the codebase, use the `skybridge` skill.

Key conventions:
- Keep all Revolut logic (`src/revolut`, `src/config.ts`, `src/tools`) independent of Skybridge.
- Tools are gated by capability tiers in `src/config.ts` and registered conditionally in
  `src/tools/index.ts` (read = always; drafts/payments = env-gated).
- Money movement is irreversible: any tool that moves money (pay/transfer/exchange) or deletes a
  resource must be a separate, `confirm`-gated payments-tier tool — never a flag on a read/draft
  tool. Generate a `request_id` server-side for idempotency.
- Upstream auth is OAuth client-assertion: `src/revolut/token-manager.ts` mints ~40-min access
  tokens from the refresh token + a freshly-signed JWT (RS256).
- `npm run build` typechecks; `npm test` runs vitest. Never log secrets or PII.
