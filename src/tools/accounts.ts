import type { McpServer } from "skybridge/server";
import { z } from "zod";
import type { RevolutClient } from "../revolut/client.js";
import { arrayResult, objectResult, RO } from "./shared.js";

/** Read tools for accounts. Always registered. */
export function registerAccountTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "list-accounts",
      description:
        "List your Revolut Business accounts (id, name, balance, currency, state). Also serves as the connectivity smoke test.",
      annotations: RO,
    },
    async () => {
      const accounts = await client.get<unknown[]>("/accounts");
      return arrayResult(accounts, "account(s)");
    },
  );

  server.registerTool(
    {
      name: "get-account",
      description: "Get a single account by id (balance, currency, state).",
      inputSchema: { id: z.string() },
      annotations: RO,
    },
    async ({ id }) => {
      const account = await client.get<Record<string, unknown>>(`/accounts/${encodeURIComponent(id)}`);
      return objectResult(account, `Account ${id} retrieved.`);
    },
  );

  server.registerTool(
    {
      name: "get-account-bank-details",
      description:
        "Get an account's full bank details (IBAN/BIC, account number/sort code, etc.) used to receive payments.",
      inputSchema: { id: z.string() },
      annotations: RO,
    },
    async ({ id }) => {
      const details = await client.get<unknown>(`/accounts/${encodeURIComponent(id)}/bank-details`);
      // bank-details may be an array (multiple schemes) — normalize to a stable object.
      return objectResult({ details }, `Bank details for account ${id} retrieved.`);
    },
  );
}
