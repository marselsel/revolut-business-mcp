import { describe, expect, it, vi } from "vitest";
import { RevolutClient } from "../src/revolut/client.js";
import { RevolutApiError } from "../src/revolut/errors.js";
import type { TokenManager } from "../src/revolut/token-manager.js";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A fake TokenManager exposing the mocks so tests can assert on refresh(). */
function fakeTokenManager() {
  let access = "tok-1";
  const getAccessToken = vi.fn(async () => access);
  const refresh = vi.fn(async () => {
    access = "tok-2";
    return access;
  });
  const tm = { getAccessToken, refresh } as unknown as TokenManager;
  return { tm, getAccessToken, refresh };
}

function makeClient(fetchFn: typeof fetch, tm: TokenManager, slept: number[] = []) {
  return new RevolutClient({
    baseUrl: "https://api.test/api/1.0",
    tokenManager: tm,
    fetchFn,
    sleep: async (ms) => {
      slept.push(ms);
    },
    random: () => 0,
    rateLimit: { capacity: 1000, refillPerSec: 1000 },
    maxRetries: 4,
  });
}

describe("RevolutClient", () => {
  it("sends the access token as Bearer and parses JSON", async () => {
    const { tm } = fakeTokenManager();
    const fetchFn = vi.fn(async (_url, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
      return json([{ id: "acc" }]);
    }) as unknown as typeof fetch;
    const res = await makeClient(fetchFn, tm).get<{ id: string }[]>("/accounts");
    expect(res[0].id).toBe("acc");
  });

  it("on 401 refreshes once and retries with the new token", async () => {
    const { tm, refresh } = fakeTokenManager();
    let n = 0;
    const fetchFn = vi.fn(async (_url, init) => {
      n += 1;
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (n === 1) {
        expect(auth).toBe("Bearer tok-1");
        return json({ message: "unauthorized" }, 401);
      }
      expect(auth).toBe("Bearer tok-2");
      return json({ ok: true });
    }) as unknown as typeof fetch;
    const res = await makeClient(fetchFn, tm).get<{ ok: boolean }>("/accounts");
    expect(res.ok).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(n).toBe(2);
  });

  it("gives up after a second 401 (no infinite refresh loop)", async () => {
    const { tm } = fakeTokenManager();
    const fetchFn = vi.fn(async () => json({ message: "nope" }, 401)) as unknown as typeof fetch;
    const err = await makeClient(fetchFn, tm).get("/accounts").catch((e) => e);
    expect(err).toBeInstanceOf(RevolutApiError);
    expect(err.status).toBe(401);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 honoring Retry-After (clamped)", async () => {
    const { tm } = fakeTokenManager();
    const slept: number[] = [];
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n += 1;
      return n === 1 ? json({}, 429, { "retry-after": "2" }) : json({ ok: true });
    }) as unknown as typeof fetch;
    await makeClient(fetchFn, tm, slept).get("/accounts");
    expect(slept).toContain(2000);
  });

  it("clamps a huge Retry-After so a request can't hang", async () => {
    const { tm } = fakeTokenManager();
    const slept: number[] = [];
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n += 1;
      return n === 1 ? json({}, 429, { "retry-after": "99999" }) : json({ ok: true });
    }) as unknown as typeof fetch;
    await makeClient(fetchFn, tm, slept).get("/accounts");
    expect(Math.max(...slept)).toBeLessThanOrEqual(30_000);
  });

  it("does NOT retry a POST on a network error (no duplicate money movement)", async () => {
    const { tm } = fakeTokenManager();
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(makeClient(fetchFn, tm).post("/pay", { amount: 1 })).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("POST not retried"),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries an idempotent GET on a network error, then succeeds", async () => {
    const { tm } = fakeTokenManager();
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("ETIMEDOUT");
      return json({ ok: true });
    }) as unknown as typeof fetch;
    const res = await makeClient(fetchFn, tm).get<{ ok: boolean }>("/accounts");
    expect(res.ok).toBe(true);
    expect(n).toBe(2);
  });

  it("passes an abort signal and does NOT retry a POST that times out", async () => {
    const { tm } = fakeTokenManager();
    const fetchFn = vi.fn(async (_url, init) => {
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(makeClient(fetchFn, tm).post("/pay", {})).rejects.toMatchObject({ status: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps a 400 to a validation error with safe detail", async () => {
    const { tm } = fakeTokenManager();
    const fetchFn = vi.fn(async () => json({ message: "amount must be positive", code: 1234 }, 400)) as unknown as typeof fetch;
    const err = await makeClient(fetchFn, tm).get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(RevolutApiError);
    expect(err.kind).toBe("validation");
    expect(err.message).toContain("amount must be positive");
  });
});
