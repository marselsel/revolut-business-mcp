import { randomUUID } from "node:crypto";
import type { McpServer } from "skybridge/server";
import { z } from "zod";
import type { RevolutClient } from "../revolut/client.js";
import { exchangeInputShape } from "./schemas.js";
import { objectResult, RO, WRITE } from "./shared.js";

/** Read tools for foreign exchange. Always registered. */
export function registerFxReadTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "get-exchange-rate",
      description: "Get an FX rate quote (read-only) for converting `from` currency into `to` currency.",
      inputSchema: {
        from: z.string().describe('Sell currency, ISO 4217 e.g. "EUR".'),
        to: z.string().describe('Buy currency, ISO 4217 e.g. "USD".'),
        amount: z.number().positive().optional().describe("Amount of `from` to quote (default 1)."),
      },
      annotations: RO,
    },
    async ({ from, to, amount }) =>
      objectResult(
        await client.get<Record<string, unknown>>("/rate", { from, to, amount }),
        `Rate ${from}->${to} retrieved.`,
      ),
  );

  server.registerTool(
    {
      name: "get-exchange-reasons",
      description:
        "List exchange reason codes that may be required for FX in your jurisdiction (used by create-exchange).",
      annotations: RO,
    },
    async () => objectResult({ reasons: await client.get<unknown>("/exchange-reasons") }, "Exchange reasons retrieved."),
  );
}

/** Payments tier (default OFF): perform an FX exchange (moves/converts money). */
export function registerFxPaymentTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "create-exchange",
      description:
        "Exchange currency between your accounts. MOVES/CONVERTS REAL MONEY. Requires confirm=true. Set `amount` on exactly one side (sell or buy). Some jurisdictions require exchange_reason_code (see get-exchange-reasons). A request_id is generated server-side for idempotency.",
      inputSchema: {
        ...exchangeInputShape,
        confirm: z.literal(true).describe("Must be true to acknowledge this moves real money."),
      },
      annotations: WRITE,
    },
    async ({ confirm: _confirm, ...input }) => {
      const request_id = randomUUID();
      const created = await client.post<Record<string, unknown>>("/exchange", { request_id, ...input });
      return objectResult({ request_id, ...created }, "Exchange submitted. This converts real money.");
    },
  );
}
