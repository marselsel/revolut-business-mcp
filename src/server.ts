import type { Request, Response } from "express";
import { mcpAuthMetadataRouter, McpServer, requireBearerAuth } from "skybridge/server";
import { bearerAuthMiddleware } from "./auth.js";
import { type Config, ConfigError, describeCapabilities, loadConfig } from "./config.js";
import { buildOAuthMetadata, createAccessTokenVerifier } from "./oauth.js";
import { RevolutClient } from "./revolut/client.js";
import { TokenManager } from "./revolut/token-manager.js";
import { createFileRefreshTokenStore } from "./revolut/token-store.js";
import { registerTools } from "./tools/index.js";

// Fail fast with a clear, secret-free message on any misconfiguration.
let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

// Skybridge's `run()` binds `process.env.__PORT` (default 3000). When running the
// built server directly (`node dist/server.js`) make our validated `config.port`
// (which reads `PORT`, default 8080) authoritative. `skybridge dev` sets `__PORT`.
if (!process.env.__PORT) {
  process.env.__PORT = String(config.port);
}

const store = config.revolut.tokenStorePath
  ? createFileRefreshTokenStore(config.revolut.tokenStorePath)
  : undefined;

// The TokenManager parses the private key; an invalid key is fatal at startup.
let tokenManager: TokenManager;
try {
  tokenManager = new TokenManager({
    clientId: config.revolut.clientId,
    privateKeyPem: config.revolut.privateKeyPem,
    jwtIssuer: config.revolut.jwtIssuer,
    tokenUrl: config.revolut.tokenUrl,
    refreshToken: config.revolut.refreshToken,
    store,
    debug: config.debugLogging,
  });
} catch (err) {
  console.error(`Configuration error: ${err instanceof Error ? err.message : "invalid private key"}`);
  process.exit(1);
}

const client = new RevolutClient({
  baseUrl: config.revolut.apiBaseUrl,
  tokenManager,
  debug: config.debugLogging,
});

/** Repo homepage, linked from the landing page. */
const REPO_URL = "https://github.com/marselsel/revolut-business-mcp";

/** A small, unauthenticated landing page served at `/` so a browser visit shows what this is. */
function landingHtml(host: string): string {
  const tiers = ["read"];
  if (config.capabilities.drafts) tiers.push("drafts");
  if (config.capabilities.payments) tiers.push("payments");
  const authNote =
    config.auth.mode === "none"
      ? "No auth required (open demo)."
      : config.auth.mode === "oauth"
        ? "OAuth required — add it as a custom connector and sign in."
        : "Send an <code>Authorization: Bearer &lt;token&gt;</code> header.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revolut Business MCP Server</title>
<style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1.2rem}
h1{font-size:1.6rem;margin:.2rem 0}.muted{color:#888}code,pre{background:#8881;border-radius:6px}code{padding:.1em .35em}
pre{padding:.8rem 1rem;overflow:auto}a{color:#3b82f6}
.pill{display:inline-block;background:#10b98122;color:#10b981;border-radius:999px;padding:.1rem .6rem;font-size:.85rem;font-weight:600}</style>
</head><body>
<h1>Revolut Business MCP Server</h1>
<p><span class="pill">● live</span> &nbsp; env <b>${config.revolut.environment}</b> &nbsp;·&nbsp; tiers <b>${tiers.join(", ")}</b></p>
<p class="muted">An open-source <a href="https://modelcontextprotocol.io">MCP</a> server connecting Claude to the
<a href="https://developer.revolut.com/docs/business/business-api">Revolut Business API</a> — accounts,
transactions, counterparties, payments, FX and more.</p>
<h2>Connect it to an MCP client</h2>
<p>Point it at:</p><pre>https://${host}/mcp</pre>
<p class="muted">${authNote}</p>
<h2>Endpoints</h2>
<ul><li><code>POST /mcp</code> — MCP over Streamable HTTP</li><li><a href="/status">GET /status</a> — health</li></ul>
<p><a href="${REPO_URL}">Source &amp; docs on GitHub →</a></p>
</body></html>`;
}

const server = new McpServer(
  {
    name: "revolut-business",
    version: "0.1.0",
  },
  { capabilities: {} },
);

// Unauthenticated health check. Use `/status`, not `/healthz`: Google Front End
// intercepts `/healthz` on Cloud Run (it never reaches the container).
server.express.get("/status", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Unauthenticated, browser-friendly landing page at the root.
server.express.get("/", (req: Request, res: Response) => {
  res.type("html").send(landingHtml(req.get("host") ?? "your-server"));
});

// Gate the MCP endpoint according to the configured auth mode.
if (config.auth.mode === "oauth") {
  const oauth = config.auth;
  server.use(
    mcpAuthMetadataRouter({
      oauthMetadata: buildOAuthMetadata(oauth),
      resourceServerUrl: new URL(oauth.resource),
    }),
  );
  // RFC 9728: the protected-resource metadata path is the well-known segment
  // followed by the resource's path.
  const resUrl = new URL(oauth.resource);
  const resPath = resUrl.pathname === "/" ? "" : resUrl.pathname.replace(/\/$/, "");
  server.use(
    "/mcp",
    requireBearerAuth({
      verifier: { verifyAccessToken: createAccessTokenVerifier(oauth) },
      resourceMetadataUrl: `${resUrl.origin}/.well-known/oauth-protected-resource${resPath}`,
    }),
  );
} else if (config.auth.mode === "static") {
  server.use("/mcp", bearerAuthMiddleware(config.auth.token));
}
// mode "none": no gate (operator explicitly opted into unauthenticated).

registerTools(server, client, config);

console.error(`[revolut-mcp] starting — ${describeCapabilities(config)}`);

export default await server.run();

export type AppType = typeof server;
