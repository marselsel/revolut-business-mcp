# Revolut Business MCP Server

An open-source, self-hostable **[MCP](https://modelcontextprotocol.io) server** for the
[Revolut Business](https://developer.revolut.com/docs/business/business-api) banking API. Run your
own instance, connect it to Claude, and let an agent read your accounts, transactions and
counterparties — and (optionally) move money under explicit, gated control.

Bring your own Revolut Business API credentials — the server is single-tenant per deployment and
never stores anyone else's. It runs as a remote HTTP server on any container host, built with the
[Skybridge](https://docs.skybridge.tech) framework.

**Two authentication layers — don't confuse them:**
- **Upstream (server → Revolut):** OAuth 2.0 **JWT client assertion**. You upload an API
  certificate, get a Client ID, and authorize once to obtain a refresh token; the server then
  mints short-lived access tokens automatically. Set up with `npm run authorize`.
- **Inbound (client → `/mcp`):** how *your* MCP client authenticates to this server. Choose
  **OAuth 2.1** (required for the Claude app / web / ChatGPT custom connector) or a **static
  bearer token** (Claude Code / Desktop only).

> ⚠️ **This brokers real bank accounts and can move real money.** Read [SECURITY.md](SECURITY.md).
> Money movement is **off by default** (`REVOLUT_ENABLE_PAYMENTS=false`) and every money-moving
> tool requires an explicit `confirm`. You are responsible for what you enable. No warranty (MIT).

## Capabilities

~35 tools across three tiers you enable via environment variables:

| Tier | Default | What it covers |
|------|---------|----------------|
| **Read** | always on | Accounts & balances, bank details; transactions; counterparties; payment drafts & payment status; FX rate quotes & exchange reasons; webhooks; cards; team members; expenses |
| **Drafts / safe writes** (`REVOLUT_ENABLE_DRAFTS`) | on | Create **payment drafts** (require in-app approval — no money moves), create counterparties, create/rotate webhooks, create/freeze/unfreeze cards, invite team members |
| **Payments / money movement** (`REVOLUT_ENABLE_PAYMENTS`) | off | **Send payments**, transfer between own accounts, FX **exchange** (all confirm-gated, irreversible); destructive deletes (counterparty, draft, webhook, card) |

Set `REVOLUT_READ_ONLY=true` to force read-only (overrides the flags above).

## Get your Revolut API credentials

In the [Revolut Business app](https://business.revolut.com) → **Settings → APIs**:

1. **Generate a key pair** and upload the public certificate:
   ```bash
   openssl genpkey -algorithm RSA -out privatecert.pem -pkeyopt rsa_keygen_bits:2048
   openssl req -new -x509 -key privatecert.pem -out publiccert.cer -days 1825
   ```
   Upload `publiccert.cer`, copy the **Client ID**, and set an **OAuth redirect URI** — its domain
   becomes your `REVOLUT_JWT_ISSUER`.
2. **Authorize once** to get a refresh token (start with the **sandbox**):
   ```bash
   REVOLUT_CLIENT_ID=... REVOLUT_JWT_ISSUER=example.com \
   REVOLUT_PRIVATE_KEY_PATH=./privatecert.pem REVOLUT_ENVIRONMENT=sandbox \
   npm run authorize
   ```
   Open the printed URL, approve, paste the `code`, and save the `REVOLUT_REFRESH_TOKEN` it prints.
   Add `REVOLUT_SCOPE="READ,WRITE,PAY"` if you intend to enable the payments tier.

See Revolut's [getting-started guide](https://developer.revolut.com/docs/guides/build-banking-apps/get-started/make-your-first-api-request).

## Quick start (Docker)

```bash
git clone https://github.com/marselsel/revolut-business-mcp && cd revolut-business-mcp
cp .env.example .env          # set REVOLUT_* + /mcp auth
docker compose up --build     # serves on http://localhost:8080/mcp
```

Without Docker: `npm install && npm run build && npm start`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `REVOLUT_CLIENT_ID` | — (**required**) | Client ID from your uploaded API certificate |
| `REVOLUT_PRIVATE_KEY` / `REVOLUT_PRIVATE_KEY_PATH` | — (**one required**) | PEM private key (contents or file path) used to sign the JWT |
| `REVOLUT_REFRESH_TOKEN` | — (**required**) | From `npm run authorize` |
| `REVOLUT_JWT_ISSUER` | — (**required**) | JWT `iss` = your redirect URI's domain (e.g. `example.com`) |
| `REVOLUT_ENVIRONMENT` | `production` | `production` or `sandbox` |
| `REVOLUT_TOKEN_STORE_PATH` | — | File to persist a rotated refresh token (hosts with a volume) |
| `REVOLUT_READ_ONLY` | `false` | Register only read tools (hard override) |
| `REVOLUT_ENABLE_DRAFTS` | `true` | Enable safe-write tools (payment drafts, counterparties, …) |
| `REVOLUT_ENABLE_PAYMENTS` | `false` | Enable money movement (pay/transfer/exchange) + deletes |
| `OAUTH_ISSUER` | — | OAuth authorization-server issuer; setting it enables OAuth mode for `/mcp`¹ |
| `OAUTH_RESOURCE` / `SERVER_URL` | — | This server's public URL (token audience). Required in OAuth mode |
| `OAUTH_ALLOWED_EMAIL_DOMAINS` | — | Comma-separated allow-list (enforced via the token's verified email) |
| `OAUTH_VERIFY_AUDIENCE` | `true` | Verify token `aud`; keep `true` (see SECURITY) |
| `MCP_AUTH_TOKEN` | — (**required**¹) | Static bearer token for `/mcp` (used when OAuth is off) |
| `MCP_ALLOW_UNAUTHENTICATED` | `false` | Opt out of `/mcp` auth (trusted local use only) |
| `PORT` | `8080` | Listen port (your platform may inject this) |
| `REVOLUT_DEBUG_LOGGING` | `false` | Verbose logs (never secrets/bodies) |

¹ The server needs **either** `OAUTH_ISSUER` **or** `MCP_AUTH_TOKEN` for `/mcp`. It refuses to
start with neither unless `MCP_ALLOW_UNAUTHENTICATED=true`.

## Connect to Claude (Code / Desktop, static token)

```json
{
  "mcpServers": {
    "revolut": {
      "type": "http",
      "url": "https://<your-host>/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

For the Claude app / web custom connector, deploy with OAuth (`OAUTH_ISSUER`, `OAUTH_RESOURCE`)
and add the server URL under **Connectors → Add custom connector**.

## Deploy

A standard Docker container ([Dockerfile](Dockerfile)) — run it on any HTTPS-capable host:

```bash
docker build -t revolut-business-mcp .
docker run -p 8080:8080 --env-file .env revolut-business-mcp
```

Production notes:
- Serve over **HTTPS**.
- Set both auth layers (`REVOLUT_*` upstream + `OAUTH_*`/`MCP_AUTH_TOKEN` inbound) — fails closed otherwise.
- **Run a single instance** (the ~1 req/s rate limiter is per-process).
- Health check: `GET /status` (returns `200`).
- **Refresh-token persistence:** if Revolut rotates the refresh token, set `REVOLUT_TOKEN_STORE_PATH`
  to a persistent volume (or keep one warm instance) so restarts survive. Re-authorize at most
  every ~90 days.

**Google Cloud Run:** a step-by-step recipe is in [docs/cloud-run.md](docs/cloud-run.md).

## How it works

- `src/config.ts` — env parsing/validation, fail-closed `/mcp` auth, capability tiers.
- `src/revolut/token-manager.ts` — signs the JWT client assertion, mints/refreshes access tokens
  (concurrency-deduped; optional rotated-token persistence).
- `src/revolut/client.ts` — rate-limited (~1 req/s), retry-aware client; 401 → refresh → retry once;
  never retries non-idempotent POSTs (no duplicate payments).
- `src/auth.ts` / `src/oauth.ts` — inbound `/mcp` protection (static bearer / OAuth 2.1 + verified-email gate).
- `src/tools/` — tools registered conditionally by tier.

## Verify against the live API

A few endpoint details are marked `VERIFY` in the code — confirm against the **sandbox** before
relying on them in production: transaction filter param names; the own-account transfer endpoint;
the payment-status / cancel paths; counterparty create fields per region; and whether Revolut
rotates the refresh token (which determines whether you need `REVOLUT_TOKEN_STORE_PATH`).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm run dev` starts the Skybridge dev server + DevTools
at `http://localhost:3000`.

## License

[MIT](LICENSE) © marselsel. Not affiliated with or endorsed by Revolut.
