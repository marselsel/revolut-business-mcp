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

console.error(`[revolut-business-mcp] starting — ${describeCapabilities(config)}`);
if (config.auth.mode === "oauth" && config.auth.allowedEmailDomains.length === 0) {
  console.error(
    "[revolut-business-mcp] WARNING: OAuth mode with no OAUTH_ALLOWED_EMAIL_DOMAINS — ANY user who " +
      "can authenticate with your issuer can reach this server. Set OAUTH_ALLOWED_EMAIL_DOMAINS to restrict access.",
  );
}

export default await server.run();

export type AppType = typeof server;
