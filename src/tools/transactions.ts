import type { McpServer } from "skybridge/server";
import { z } from "zod";
import type { RevolutClient } from "../revolut/client.js";
import { TRANSACTION_STATES, TRANSACTION_TYPES } from "../revolut/types.js";
import { arrayResult, objectResult, RO } from "./shared.js";

/** Read tools for transactions. Always registered. */
export function registerTransactionTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "list-transactions",
      description:
        "List transactions (newest first). Filter by account, counterparty, date range and type. To page, pass the previous page's oldest created_at as the next `to`.",
      inputSchema: {
        account_id: z.string().optional().describe("Filter to one account."),
        counterparty_id: z.string().optional().describe("Filter to one counterparty."),
        from: z.string().optional().describe("ISO date/time lower bound (inclusive)."),
        to: z.string().optional().describe("ISO date/time upper bound (exclusive)."),
        type: z.string().optional().describe(`Filter by type, e.g. one of: ${TRANSACTION_TYPES.join(", ")}.`),
        count: z.number().int().min(1).max(1000).default(100).describe("Max rows to return (≤1000)."),
      },
      annotations: RO,
    },
    async ({ account_id, counterparty_id, from, to, type, count }) => {
      // Revolut filters by `account` and `counterparty` query keys (account filter verified live).
      const txns = await client.get<unknown[]>("/transactions", {
        account: account_id,
        counterparty: counterparty_id,
        from,
        to,
        type,
        count,
      });
      return arrayResult(txns, "transaction(s)");
    },
  );

  server.registerTool(
    {
      name: "get-transaction",
      description: `Get a single transaction by id (full detail incl. legs and state). Common states: ${TRANSACTION_STATES.join(", ")}.`,
      inputSchema: { id: z.string() },
      annotations: RO,
    },
    async ({ id }) => {
      const txn = await client.get<Record<string, unknown>>(`/transactions/${encodeURIComponent(id)}`);
      return objectResult(txn, `Transaction ${id} retrieved.`);
    },
  );
}
