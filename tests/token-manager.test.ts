import { generateKeyPairSync } from "node:crypto";
import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TokenManager } from "../src/revolut/token-manager.js";

let pem: string;
beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
});

function tokenResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function make(opts: {
  fetchFn: typeof fetch;
  now?: () => number;
  store?: { load: () => string | undefined; save: (t: string) => void };
  refreshToken?: string;
}): TokenManager {
  return new TokenManager({
    clientId: "client-123",
    privateKeyPem: pem,
    jwtIssuer: "example.com",
    tokenUrl: "https://b2b.revolut.com/api/1.0/auth/token",
    refreshToken: opts.refreshToken ?? "rt-0",
    fetchFn: opts.fetchFn,
    now: opts.now,
    store: opts.store,
  });
}

describe("TokenManager", () => {
  it("signs a correct client assertion and mints an access token", async () => {
    let sentAssertion = "";
    const fetchFn = vi.fn(async (_url, init) => {
      const body = new URLSearchParams(String((init as RequestInit).body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("rt-0");
      expect(body.get("client_assertion_type")).toBe(
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      );
      sentAssertion = body.get("client_assertion") ?? "";
      return tokenResponse({ access_token: "at-1", expires_in: 2399, refresh_token: "rt-0" });
    }) as unknown as typeof fetch;

    const tm = make({ fetchFn, now: () => 1_000_000 });
    expect(await tm.getAccessToken()).toBe("at-1");

    const claims = decodeJwt(sentAssertion);
    expect(claims.iss).toBe("example.com");
    expect(claims.sub).toBe("client-123");
    expect(claims.aud).toBe("https://revolut.com");
  });

  it("caches the access token until near expiry, then refreshes", async () => {
    let now = 1_000_000;
    const fetchFn = vi.fn(async () => tokenResponse({ access_token: "at", expires_in: 100 })) as unknown as typeof fetch;
    const tm = make({ fetchFn, now: () => now });
    await tm.getAccessToken();
    await tm.getAccessToken(); // served from cache
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 100_000; // past (expiry − skew)
    await tm.getAccessToken();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("persists a rotated refresh token via the store", async () => {
    const saved: string[] = [];
    const store = { load: () => undefined, save: (t: string) => saved.push(t) };
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      return tokenResponse({ access_token: `at-${call}`, expires_in: 1, refresh_token: `rt-${call}` });
    }) as unknown as typeof fetch;
    const tm = make({ fetchFn, now: () => call * 1_000_000, store });
    await tm.refresh();
    expect(saved).toEqual(["rt-1"]);
  });

  it("dedupes concurrent refreshes into a single request", async () => {
    let inFlight = 0;
    let max = 0;
    const fetchFn = vi.fn(async () => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return tokenResponse({ access_token: "at", expires_in: 2399 });
    }) as unknown as typeof fetch;
    const tm = make({ fetchFn, now: () => 0 });
    await Promise.all([tm.getAccessToken(), tm.getAccessToken(), tm.getAccessToken()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(max).toBe(1);
  });

  it("throws a helpful error when the refresh token is rejected", async () => {
    const fetchFn = vi.fn(async () => new Response("expired", { status: 401 })) as unknown as typeof fetch;
    const tm = make({ fetchFn, now: () => 0 });
    await expect(tm.getAccessToken()).rejects.toThrow(/authorize/);
  });

  it("prefers a persisted refresh token over the env-provided one", async () => {
    const store = { load: () => "rt-persisted", save: () => {} };
    let used = "";
    const fetchFn = vi.fn(async (_url, init) => {
      used = new URLSearchParams(String((init as RequestInit).body)).get("refresh_token") ?? "";
      return tokenResponse({ access_token: "at", expires_in: 2399 });
    }) as unknown as typeof fetch;
    const tm = make({ fetchFn, now: () => 0, store, refreshToken: "rt-env" });
    await tm.getAccessToken();
    expect(used).toBe("rt-persisted");
  });
});
