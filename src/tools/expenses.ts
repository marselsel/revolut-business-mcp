import type { McpServer } from "skybridge/server";
import { z } from "zod";
import type { RevolutClient } from "../revolut/client.js";
import { arrayResult, RO } from "./shared.js";

/** Read tools for expenses. Always registered. (Note: not available in sandbox.) */
export function registerExpenseTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "list-expenses",
      description:
        "List expenses (card spend with categories/receipts), newest first. Filter by date range. Note: the expenses API is production-only (not in sandbox).",
      inputSchema: {
        from: z.string().optional().describe("ISO date lower bound."),
        to: z.string().optional().describe("ISO date upper bound."),
        count: z.number().int().min(1).max(500).default(100).describe("Max rows (≤500)."),
      },
      annotations: RO,
    },
    async ({ from, to, count }) => {
      const expenses = await client.get<unknown[]>("/expenses", { from, to, count });
      return arrayResult(expenses, "expense(s)");
    },
  );
}
