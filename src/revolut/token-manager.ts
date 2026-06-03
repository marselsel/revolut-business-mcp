import { createPrivateKey, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { RevolutApiError } from "./errors.js";
import type { RefreshTokenStore } from "./token-store.js";

/** Audience for the Revolut client-assertion JWT (the token endpoint). */
const JWT_AUDIENCE = "https://revolut.com";
/** Refresh a little before the access token actually expires to avoid races. */
const EXPIRY_SKEW_MS = 60_000;
/** Network timeout for the token-endpoint call. */
const TOKEN_TIMEOUT_MS = 15_000;
/** Fallback access-token lifetime if the response omits `expires_in` (~40 min). */
const DEFAULT_TTL_SEC = 2399;

export interface TokenManagerOptions {
  clientId: string;
  /** PEM private key (PKCS#1 or PKCS#8) used to sign the client assertion. */
  privateKeyPem: string;
  /** JWT `iss` — your registered redirect-URI domain. */
  jwtIssuer: string;
  tokenUrl: string;
  /** Initial refresh token (from config / bootstrap). */
  refreshToken: string;
  store?: RefreshTokenStore;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
  now?: () => number;
  debug?: boolean;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

/**
 * Owns the Revolut OAuth client-assertion flow: signs a short-lived JWT with the
 * operator's private key and exchanges the refresh token for ~40-minute access
 * tokens, caching the current one and refreshing on demand. Concurrent callers
 * share a single in-flight refresh, and a rotated refresh token is persisted via
 * the optional {@link RefreshTokenStore}.
 */
export class TokenManager {
  private readonly clientId: string;
  private readonly privateKey: KeyObject;
  private readonly jwtIssuer: string;
  private readonly tokenUrl: string;
  private readonly store?: RefreshTokenStore;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly debug: boolean;

  private refreshToken: string;
  private accessToken?: string;
  private expiresAtMs = 0;
  private inFlight?: Promise<string>;

  constructor(opts: TokenManagerOptions) {
    this.clientId = opts.clientId;
    try {
      this.privateKey = createPrivateKey(opts.privateKeyPem);
    } catch (e) {
      throw new Error(
        `Invalid REVOLUT_PRIVATE_KEY (expected a PEM RSA private key): ${
          e instanceof Error ? e.message : "unknown"
        }`,
      );
    }
    this.jwtIssuer = opts.jwtIssuer;
    this.tokenUrl = opts.tokenUrl;
    this.store = opts.store;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? (() => Date.now());
    this.debug = opts.debug ?? false;
    // Prefer a persisted (rotated) refresh token over the env-provided one.
    this.refreshToken = this.store?.load() ?? opts.refreshToken;
  }

  /** Return a valid access token, refreshing if the cached one is missing/near expiry. */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAtMs) {
      return this.accessToken;
    }
    return this.refresh();
  }

  /** Force a refresh (e.g. after a 401). Dedupes concurrent callers to one request. */
  refresh(): Promise<string> {
    if (this.inFlight) return this.inFlight;
    const run = this.doRefresh().finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = run;
    return run;
  }

  private async doRefresh(): Promise<string> {
    const assertion = await this.buildClientAssertion();
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    });

    let res: Response;
    try {
      res = await this.fetchFn(this.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form.toString(),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
    } catch (e) {
      throw new RevolutApiError(
        0,
        `Could not reach the Revolut token endpoint: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }

    const text = await res.text();
    if (!res.ok) {
      // 400/401 here usually means the refresh token expired (90-day max) or the
      // certificate/client changed — the operator must re-run `npm run authorize`.
      throw new RevolutApiError(
        res.status,
        `Revolut token refresh failed (${res.status}). The refresh token may have expired (90-day max) — ` +
          `re-run \`npm run authorize\`. ${text.slice(0, 200)}`,
      );
    }

    let data: TokenResponse;
    try {
      data = JSON.parse(text) as TokenResponse;
    } catch {
      throw new RevolutApiError(0, "Revolut token endpoint returned a non-JSON response.");
    }
    if (!data.access_token) {
      throw new RevolutApiError(0, "Revolut token endpoint response did not include an access_token.");
    }

    this.accessToken = data.access_token;
    const ttlMs = (data.expires_in ?? DEFAULT_TTL_SEC) * 1000;
    // Refresh ahead of expiry, but never reserve more than half of a short-lived token's life
    // (so a token with a small `expires_in` still gets cached instead of minting on every call).
    const skewMs = Math.min(EXPIRY_SKEW_MS, Math.floor(ttlMs / 2));
    this.expiresAtMs = this.now() + ttlMs - skewMs;

    // Revolut MAY rotate the refresh token; persist a new one so restarts survive.
    if (data.refresh_token && data.refresh_token !== this.refreshToken) {
      this.refreshToken = data.refresh_token;
      if (this.store) {
        this.store.save(this.refreshToken);
      } else if (this.debug) {
        console.error(
          "[revolut-business-mcp] note: Revolut rotated the refresh token; set REVOLUT_TOKEN_STORE_PATH to persist it across restarts.",
        );
      }
    }

    if (this.debug) {
      console.error(`[revolut-business-mcp] minted access token (ttl ~${Math.round(ttlMs / 1000)}s)`);
    }
    return this.accessToken;
  }

  /** Sign the short-lived JWT client assertion used to authenticate to the token endpoint. */
  private buildClientAssertion(): Promise<string> {
    const nowSec = Math.floor(this.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.jwtIssuer)
      .setSubject(this.clientId)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 600) // 10 min; only needs to outlive one token request
      .sign(this.privateKey);
  }
}
