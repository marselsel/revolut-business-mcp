# Security Policy

## Reporting a vulnerability

Please report security issues privately. Open a [GitHub security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository, or email the maintainers. Do **not** open a public issue for a vulnerability.
We aim to acknowledge reports within a few business days.

## Operating this server securely

This server brokers access to **real business bank accounts** and can move **real money**. When
you self-host it:

- **Protect `/mcp`.** Use OAuth (`OAUTH_ISSUER`, …) for the custom-connector UI, or a strong
  `MCP_AUTH_TOKEN` (`openssl rand -hex 32`). The server refuses to start without auth unless you
  explicitly set `MCP_ALLOW_UNAUTHENTICATED=true` — only ever for trusted local testing.
- **Treat the private key and refresh token like banking credentials.** `REVOLUT_PRIVATE_KEY`
  (or `REVOLUT_PRIVATE_KEY_PATH`) and `REVOLUT_REFRESH_TOKEN` grant access to your accounts.
  Store them in a secret manager, never in the image or in version control. `npm run authorize`
  prints the refresh token once — keep it secret.
- **Keep money movement off unless you need it.** `REVOLUT_ENABLE_PAYMENTS` defaults to `false`;
  leave it off (or set `REVOLUT_READ_ONLY=true`) unless you intend to let the agent send money.
  When on, every money-moving tool still requires an explicit `confirm`.
- **Prefer payment drafts.** A draft must be approved by a human in the Revolut Business app
  before any money moves — keep agents on `create-payment-draft` rather than `create-payment`.
- **Keep logs clean.** The server never logs secrets or request/response bodies unless you opt
  into `REVOLUT_DEBUG_LOGGING=true`.
- **Serve over HTTPS** and **run a single instance** (the ~1 req/s rate limiter is per-process).
