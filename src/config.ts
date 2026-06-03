/**
 * Configuration for the Revolut Business MCP server.
 *
 * Parsed and validated once at startup from environment variables. Kept free of
 * any Skybridge/Express imports so it can be unit-tested in isolation.
 */
import { readFileSync } from "node:fs";

/** Minimum length for `MCP_AUTH_TOKEN`. A 32-hex-char token is 32 chars. */
export const MIN_TOKEN_LENGTH = 16;

/** Thrown when the environment is misconfigured. Message is safe to print. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Which tiers of tools should be registered, after applying READ_ONLY. */
export interface Capabilities {
  /** Read tools are always available. */
  read: true;
  /**
   * Safe writes that do NOT move money: payment drafts (which require in-app
   * approval), counterparties, webhooks, card controls.
   */
  drafts: boolean;
  /** Money movement (pay / transfer / exchange) and irreversible deletes. */
  payments: boolean;
}

/**
 * How `/mcp` is protected. Three modes, resolved in this precedence:
 * OAuth (if `OAUTH_ISSUER` set) → static bearer (if `MCP_AUTH_TOKEN` set) →
 * none (only if `MCP_ALLOW_UNAUTHENTICATED=true`). Otherwise startup fails closed.
 */
export type AuthConfig =
  | {
      mode: "oauth";
      /** Authorization server issuer (e.g. a WorkOS AuthKit domain URL). */
      issuer: string;
      jwksUrl: string;
      /** Expected `aud` claim / Resource Indicator — this server's public URL. */
      resource: string;
      verifyAudience: boolean;
      allowedEmailDomains: string[];
      userinfoUrl: string;
    }
  | { mode: "static"; token: string }
  | { mode: "none" };

export type RevolutEnvironment = "production" | "sandbox";

/** Upstream Revolut Business API credentials and resolved endpoints. */
export interface RevolutConfig {
  clientId: string;
  /** PEM-encoded private key used to sign the JWT client assertion (RS256). */
  privateKeyPem: string;
  /** OAuth refresh token from the one-time authorization (`npm run authorize`). */
  refreshToken: string;
  /** JWT `iss` claim — the domain registered as your OAuth redirect URI's host. */
  jwtIssuer: string;
  environment: RevolutEnvironment;
  /** API base incl. the version segment, e.g. https://b2b.revolut.com/api/1.0 (no trailing slash). */
  apiBaseUrl: string;
  /** OAuth token endpoint, e.g. https://b2b.revolut.com/api/1.0/auth/token. */
  tokenUrl: string;
  /** Webhooks live on the v2 API base, e.g. https://b2b.revolut.com/api/2.0. */
  webhooksBaseUrl: string;
  /** Optional file to persist a rotated refresh token across restarts. */
  tokenStorePath?: string;
}

export interface Config {
  revolut: RevolutConfig;
  auth: AuthConfig;
  port: number;
  debugLogging: boolean;
  capabilities: Capabilities;
}

const DEFAULT_PORT = 8080;

/** Per-environment Revolut hosts. Base already includes the `/api/1.0` version segment. */
const REVOLUT_BASE: Record<RevolutEnvironment, string> = {
  production: "https://b2b.revolut.com/api/1.0",
  sandbox: "https://sandbox-b2b.revolut.com/api/1.0",
};

/** Parse a boolean env value. Accepts true/1/yes/on (case-insensitive). */
function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  throw new ConfigError(`Invalid boolean value "${raw}" (expected true/false).`);
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new ConfigError(`Invalid PORT "${raw}" (expected an integer 1-65535).`);
  }
  return n;
}

function normalizeUrl(raw: string | undefined, fallback: string, varName: string): string {
  const value = raw?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`Invalid ${varName} "${value}".`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError(`${varName} must be http(s): "${value}".`);
  }
  // Strip a trailing slash so callers can join with `/accounts` etc.
  return url.toString().replace(/\/+$/, "");
}

/**
 * Validate an OAuth issuer URL **without** altering it. The `iss` claim must match
 * byte-for-byte, and some providers' canonical issuers end in `/` (Auth0) while
 * others don't (WorkOS) — so we preserve the operator's exact string.
 */
function validateIssuerUrl(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`Invalid OAUTH_ISSUER "${value}".`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError(`OAUTH_ISSUER must be http(s): "${value}".`);
  }
  return value;
}

/** Resolve how `/mcp` is authenticated, failing closed if nothing is configured. */
function resolveAuth(env: NodeJS.ProcessEnv): AuthConfig {
  const issuerRaw = env.OAUTH_ISSUER?.trim();
  const token = env.MCP_AUTH_TOKEN?.trim() || undefined;

  // 1) OAuth takes precedence when an issuer is configured.
  if (issuerRaw) {
    const issuer = validateIssuerUrl(issuerRaw);
    const issuerBase = issuer.replace(/\/+$/, "");
    const resourceRaw = env.OAUTH_RESOURCE?.trim() || env.SERVER_URL?.trim();
    if (!resourceRaw) {
      throw new ConfigError(
        "OAUTH_RESOURCE (or SERVER_URL) is required in OAuth mode — set it to this server's public URL (the token audience / Resource Indicator).",
      );
    }
    const resource = normalizeUrl(resourceRaw, resourceRaw, "OAUTH_RESOURCE");
    const allowedEmailDomains = (env.OAUTH_ALLOWED_EMAIL_DOMAINS ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    const userinfoUrl = normalizeUrl(
      env.OAUTH_USERINFO_URL,
      `${issuerBase}/oauth2/userinfo`,
      "OAUTH_USERINFO_URL",
    );
    const jwksUrl = normalizeUrl(env.OAUTH_JWKS_URL, `${issuerBase}/oauth2/jwks`, "OAUTH_JWKS_URL");
    const verifyAudience = parseBool(env.OAUTH_VERIFY_AUDIENCE, true);
    return { mode: "oauth", issuer, jwksUrl, resource, verifyAudience, allowedEmailDomains, userinfoUrl };
  }

  // 2) Static bearer token.
  if (token) {
    if (token.length < MIN_TOKEN_LENGTH) {
      throw new ConfigError(
        `MCP_AUTH_TOKEN is too weak (min ${MIN_TOKEN_LENGTH} chars). Generate one with \`openssl rand -hex 32\`.`,
      );
    }
    return { mode: "static", token };
  }

  // 3) Explicitly unauthenticated, or fail closed.
  if (parseBool(env.MCP_ALLOW_UNAUTHENTICATED, false)) {
    return { mode: "none" };
  }
  throw new ConfigError(
    "No auth configured for /mcp. Set OAUTH_ISSUER (OAuth) or MCP_AUTH_TOKEN (static bearer, " +
      "e.g. `openssl rand -hex 32`), or set MCP_ALLOW_UNAUTHENTICATED=true to run without auth (NOT recommended).",
  );
}

function parseEnvironment(raw: string | undefined): RevolutEnvironment {
  // Default to sandbox: it's free (no paid plan), safe (fake money), and lets anyone run
  // the project out of the box. Set REVOLUT_ENVIRONMENT=production for a real account.
  const v = (raw?.trim() || "sandbox").toLowerCase();
  if (v === "production" || v === "sandbox") return v;
  throw new ConfigError(`Invalid REVOLUT_ENVIRONMENT "${raw}" (expected "production" or "sandbox").`);
}

/** Load the signing private key from inline PEM or a file path. */
function loadPrivateKey(env: NodeJS.ProcessEnv): string {
  const inline = env.REVOLUT_PRIVATE_KEY?.trim();
  if (inline) {
    // Allow `\n`-escaped PEMs (common when the key is set as a single-line env var).
    return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  }
  const path = env.REVOLUT_PRIVATE_KEY_PATH?.trim();
  if (path) {
    try {
      return readFileSync(path, "utf8");
    } catch (e) {
      throw new ConfigError(
        `Could not read REVOLUT_PRIVATE_KEY_PATH "${path}": ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  }
  throw new ConfigError(
    "A signing key is required: set REVOLUT_PRIVATE_KEY (PEM contents) or REVOLUT_PRIVATE_KEY_PATH (file path).",
  );
}

/**
 * Load and validate configuration. Throws {@link ConfigError} on any problem so
 * the process can exit with a clear, secret-free message.
 *
 * @param env - environment source (defaults to `process.env`); injectable for tests.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const clientId = env.REVOLUT_CLIENT_ID?.trim();
  if (!clientId) {
    throw new ConfigError(
      "REVOLUT_CLIENT_ID is required (shown when you upload the API certificate in Revolut Business → APIs).",
    );
  }

  const refreshToken = env.REVOLUT_REFRESH_TOKEN?.trim();
  if (!refreshToken) {
    throw new ConfigError("REVOLUT_REFRESH_TOKEN is required. Obtain it once with `npm run authorize`.");
  }

  const jwtIssuer = env.REVOLUT_JWT_ISSUER?.trim();
  if (!jwtIssuer) {
    throw new ConfigError(
      'REVOLUT_JWT_ISSUER is required — the domain registered as your OAuth redirect URI host, used as the JWT `iss` (e.g. "example.com").',
    );
  }

  const privateKeyPem = loadPrivateKey(env);
  const environment = parseEnvironment(env.REVOLUT_ENVIRONMENT);
  const base = REVOLUT_BASE[environment];
  const apiBaseUrl = normalizeUrl(env.REVOLUT_API_BASE_URL, base, "REVOLUT_API_BASE_URL");
  const tokenUrl = normalizeUrl(env.REVOLUT_TOKEN_URL, `${base}/auth/token`, "REVOLUT_TOKEN_URL");
  const webhooksBaseUrl = normalizeUrl(
    env.REVOLUT_WEBHOOKS_BASE_URL,
    base.replace("/api/1.0", "/api/2.0"),
    "REVOLUT_WEBHOOKS_BASE_URL",
  );
  const tokenStorePath = env.REVOLUT_TOKEN_STORE_PATH?.trim() || undefined;

  const auth = resolveAuth(env);

  const readOnly = parseBool(env.REVOLUT_READ_ONLY, false);
  // READ_ONLY is a hard override: it wins over the individual enable flags.
  const enableDrafts = readOnly ? false : parseBool(env.REVOLUT_ENABLE_DRAFTS, true);
  const enablePayments = readOnly ? false : parseBool(env.REVOLUT_ENABLE_PAYMENTS, false);

  return {
    revolut: {
      clientId,
      privateKeyPem,
      refreshToken,
      jwtIssuer,
      environment,
      apiBaseUrl,
      tokenUrl,
      webhooksBaseUrl,
      tokenStorePath,
    },
    auth,
    port: parsePort(env.PORT),
    debugLogging: parseBool(env.REVOLUT_DEBUG_LOGGING, false),
    capabilities: { read: true, drafts: enableDrafts, payments: enablePayments },
  };
}

/** One-line, secret-free summary of effective capabilities for startup logging. */
export function describeCapabilities(config: Config): string {
  const tiers = ["read"];
  if (config.capabilities.drafts) tiers.push("drafts");
  if (config.capabilities.payments) tiers.push("payments");
  const auth =
    config.auth.mode === "oauth"
      ? "oauth"
      : config.auth.mode === "static"
        ? "token-protected"
        : "UNAUTHENTICATED";
  return `env=${config.revolut.environment} tiers=[${tiers.join(", ")}] auth=${auth} base=${config.revolut.apiBaseUrl}`;
}
