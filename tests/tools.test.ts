import type { McpServer } from "skybridge/server";
import { describe, expect, it } from "vitest";
import { type Config, loadConfig } from "../src/config.js";
import type { RevolutClient } from "../src/revolut/client.js";
import { registerTools } from "../src/tools/index.js";

const READ_TOOLS = [
  "list-accounts",
  "get-account",
  "get-account-bank-details",
  "list-transactions",
  "get-transaction",
  "list-counterparties",
  "get-counterparty",
  "get-payment",
  "list-payment-drafts",
  "get-payment-draft",
  "get-exchange-rate",
  "get-exchange-reasons",
  "list-webhooks",
  "get-webhook",
  "list-cards",
  "get-card",
  "list-team-members",
  "get-team-member",
  "list-expenses",
];
const DRAFT_TOOLS = [
  "create-counterparty",
  "create-payment-draft",
  "create-webhook",
  "rotate-webhook-secret",
  "create-card",
  "freeze-card",
  "unfreeze-card",
  "invite-team-member",
];
const PAYMENT_TOOLS = [
  "delete-counterparty",
  "create-payment",
  "create-transfer",
  "cancel-payment",
  "delete-payment-draft",
  "create-exchange",
  "delete-webhook",
  "terminate-card",
];

/** Capture which tool names get registered for a given config. */
function registeredNames(config: Config): string[] {
  const names: string[] = [];
  const fakeServer = {
    registerTool(cfg: { name: string }) {
      names.push(cfg.name);
      return fakeServer;
    },
  } as unknown as McpServer;
  registerTools(fakeServer, {} as unknown as RevolutClient, config);
  return names.sort();
}

const TOKEN = "a".repeat(40);
const env = (extra: Record<string, string> = {}) =>
  ({
    REVOLUT_CLIENT_ID: "c",
    REVOLUT_PRIVATE_KEY: "pk",
    REVOLUT_REFRESH_TOKEN: "rt",
    REVOLUT_JWT_ISSUER: "example.com",
    MCP_AUTH_TOKEN: TOKEN,
    ...extra,
  }) as NodeJS.ProcessEnv;

describe("registerTools (tiered registration)", () => {
  it("read-only registers exactly the read tools", () => {
    expect(registeredNames(loadConfig(env({ REVOLUT_READ_ONLY: "true" })))).toEqual([...READ_TOOLS].sort());
  });

  it("default registers read + draft tools (no money movement)", () => {
    const names = registeredNames(loadConfig(env()));
    expect(names).toEqual([...READ_TOOLS, ...DRAFT_TOOLS].sort());
    expect(names).not.toContain("create-payment");
  });

  it("payments tier adds the money-movement + destructive tools", () => {
    const names = registeredNames(loadConfig(env({ REVOLUT_ENABLE_PAYMENTS: "true" })));
    expect(names).toEqual([...READ_TOOLS, ...DRAFT_TOOLS, ...PAYMENT_TOOLS].sort());
    expect(names).toContain("create-payment");
  });

  it("never registers a disabled tier's tools", () => {
    expect(registeredNames(loadConfig(env({ REVOLUT_ENABLE_DRAFTS: "false" })))).toEqual([...READ_TOOLS].sort());
  });
});
