# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] — Unreleased

Initial release: an open-source, self-hostable MCP server for the Revolut Business API.

### Added
- **Upstream OAuth client-assertion auth** — signs a short-lived RS256 JWT with your private key
  and mints ~40-minute access tokens from a refresh token, refreshing automatically (with
  concurrency-deduped refresh and an optional file-based refresh-token store for rotated tokens).
- **`npm run authorize`** bootstrap CLI to obtain the initial refresh token.
- **~35 tools across three tiers**: read (accounts, transactions, counterparties, payment drafts,
  FX quotes, webhooks, cards, team, expenses); drafts/safe-writes (payment drafts, counterparties,
  webhooks, cards, team invites); and payments/money-movement (pay, transfer, exchange, deletes) —
  **off by default**, each confirm-gated, with a server-generated `request_id` for idempotency.
- **Inbound `/mcp` protection**: OAuth 2.1 (with verified-email domain gating) or a static bearer
  token; fails closed if neither is configured.
- Rate-limited (~1 req/s), retry-aware client that never replays non-idempotent POSTs and refreshes
  once on a 401.
- Docker image, GitHub Actions CI, and a Google Cloud Run deployment guide.

### Known limitations
- Several endpoint details are marked `VERIFY` in the code (transaction filter params, own-account
  transfer path, payment cancel/status paths, counterparty create fields per region, and whether
  Revolut rotates the refresh token) — confirm against the sandbox before production use.
- No UI views yet; plain tools render in all MCP clients.
