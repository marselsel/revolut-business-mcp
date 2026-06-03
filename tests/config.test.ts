import { describe, expect, it } from "vitest";
import { ConfigError, describeCapabilities, loadConfig } from "../src/config.js";

const TOKEN = "a".repeat(40);
const base = () =>
  ({
    REVOLUT_CLIENT_ID: "client-123",
    REVOLUT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ndummy\n-----END PRIVATE KEY-----",
    REVOLUT_REFRESH_TOKEN: "oa_prod_refresh",
    REVOLUT_JWT_ISSUER: "example.com",
    MCP_AUTH_TOKEN: TOKEN,
  }) as NodeJS.ProcessEnv;

const drop = (key: string) => {
  const e = base() as Record<string, string>;
  delete e[key];
  return e as NodeJS.ProcessEnv;
};

describe("loadConfig", () => {
  it("loads a valid config with sandbox defaults", () => {
    const c = loadConfig(base());
    expect(c.revolut.clientId).toBe("client-123");
    expect(c.revolut.environment).toBe("sandbox");
    expect(c.revolut.apiBaseUrl).toBe("https://sandbox-b2b.revolut.com/api/1.0");
    expect(c.revolut.tokenUrl).toBe("https://sandbox-b2b.revolut.com/api/1.0/auth/token");
    expect(c.revolut.webhooksBaseUrl).toBe("https://sandbox-b2b.revolut.com/api/2.0");
    expect(c.port).toBe(8080);
    expect(c.capabilities).toEqual({ read: true, drafts: true, payments: false });
  });

  it("switches to production hosts when REVOLUT_ENVIRONMENT=production", () => {
    const c = loadConfig({ ...base(), REVOLUT_ENVIRONMENT: "production" } as NodeJS.ProcessEnv);
    expect(c.revolut.apiBaseUrl).toBe("https://b2b.revolut.com/api/1.0");
    expect(c.revolut.tokenUrl).toBe("https://b2b.revolut.com/api/1.0/auth/token");
    expect(c.revolut.webhooksBaseUrl).toBe("https://b2b.revolut.com/api/2.0");
  });

  it("rejects an invalid environment", () => {
    expect(() => loadConfig({ ...base(), REVOLUT_ENVIRONMENT: "test" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it("requires client id / refresh token / issuer / private key", () => {
    expect(() => loadConfig(drop("REVOLUT_CLIENT_ID"))).toThrow(/REVOLUT_CLIENT_ID/);
    expect(() => loadConfig(drop("REVOLUT_REFRESH_TOKEN"))).toThrow(/REFRESH_TOKEN/);
    expect(() => loadConfig(drop("REVOLUT_JWT_ISSUER"))).toThrow(/JWT_ISSUER/);
    expect(() => loadConfig(drop("REVOLUT_PRIVATE_KEY"))).toThrow(/signing key/);
  });

  it("fails closed when no /mcp auth is configured", () => {
    expect(() => loadConfig(drop("MCP_AUTH_TOKEN"))).toThrow(/No auth configured/);
  });

  it("allows no auth only with MCP_ALLOW_UNAUTHENTICATED=true", () => {
    const e = drop("MCP_AUTH_TOKEN") as Record<string, string>;
    e.MCP_ALLOW_UNAUTHENTICATED = "true";
    expect(loadConfig(e as NodeJS.ProcessEnv).auth.mode).toBe("none");
  });

  it("uses OAuth when OAUTH_ISSUER is set, deriving JWKS/userinfo", () => {
    const c = loadConfig({
      ...base(),
      OAUTH_ISSUER: "https://auth.example.com",
      SERVER_URL: "https://mcp.example.com",
      OAUTH_ALLOWED_EMAIL_DOMAINS: "example.com, example.org",
    } as NodeJS.ProcessEnv);
    expect(c.auth).toEqual({
      mode: "oauth",
      issuer: "https://auth.example.com",
      jwksUrl: "https://auth.example.com/oauth2/jwks",
      userinfoUrl: "https://auth.example.com/oauth2/userinfo",
      resource: "https://mcp.example.com",
      verifyAudience: true,
      allowedEmailDomains: ["example.com", "example.org"],
    });
  });

  it("OAuth takes precedence over a static token", () => {
    const c = loadConfig({
      ...base(),
      OAUTH_ISSUER: "https://auth.example.com",
      SERVER_URL: "https://x.example.com",
    } as NodeJS.ProcessEnv);
    expect(c.auth.mode).toBe("oauth");
  });

  it("rejects a weak token", () => {
    expect(() => loadConfig({ ...base(), MCP_AUTH_TOKEN: "short" } as NodeJS.ProcessEnv)).toThrow(/too weak/);
  });

  it("READ_ONLY hard-overrides the enable flags", () => {
    const c = loadConfig({
      ...base(),
      REVOLUT_READ_ONLY: "true",
      REVOLUT_ENABLE_DRAFTS: "true",
      REVOLUT_ENABLE_PAYMENTS: "true",
    } as NodeJS.ProcessEnv);
    expect(c.capabilities).toEqual({ read: true, drafts: false, payments: false });
  });

  it("enables payments when requested", () => {
    expect(loadConfig({ ...base(), REVOLUT_ENABLE_PAYMENTS: "true" } as NodeJS.ProcessEnv).capabilities.payments).toBe(true);
  });

  it("can disable drafts", () => {
    expect(loadConfig({ ...base(), REVOLUT_ENABLE_DRAFTS: "false" } as NodeJS.ProcessEnv).capabilities.drafts).toBe(false);
  });

  it("reads the private key from a file path when inline is absent", () => {
    const e = drop("REVOLUT_PRIVATE_KEY") as Record<string, string>;
    e.REVOLUT_PRIVATE_KEY_PATH = "/nonexistent/key.pem";
    expect(() => loadConfig(e as NodeJS.ProcessEnv)).toThrow(/Could not read/);
  });

  it("rejects an invalid PORT", () => {
    expect(() => loadConfig({ ...base(), PORT: "0" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it("describeCapabilities is secret-free and informative", () => {
    const s = describeCapabilities(loadConfig(base()));
    expect(s).toContain("read");
    expect(s).toContain("drafts");
    expect(s).toContain("sandbox");
    expect(s).not.toContain(TOKEN);
    expect(s).not.toContain("oa_prod_refresh");
  });
});
