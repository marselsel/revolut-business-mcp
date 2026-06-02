import { randomUUID } from "node:crypto";
import type { McpServer } from "skybridge/server";
import { z } from "zod";
import type { RevolutClient } from "../revolut/client.js";
import { cardInputShape } from "./schemas.js";
import { arrayResult, DESTRUCTIVE, objectResult, RO, text, WRITE } from "./shared.js";

/** Read tools for business cards. Always registered. (May need API enablement; not in all sandboxes.) */
export function registerCardReadTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "list-cards",
      description:
        "List business cards (virtual/physical) and their state. Note: the Cards API may require enablement and isn't available in all sandboxes.",
      annotations: RO,
    },
    async () => arrayResult(await client.get<unknown[]>("/cards"), "card(s)"),
  );

  server.registerTool(
    {
      name: "get-card",
      description: "Get a single card by id (state, limits, linked accounts).",
      inputSchema: { id: z.string() },
      annotations: RO,
    },
    async ({ id }) =>
      objectResult(await client.get<Record<string, unknown>>(`/cards/${encodeURIComponent(id)}`), `Card ${id} retrieved.`),
  );
}

/** Drafts tier: create a virtual card / freeze / unfreeze (no money movement). */
export function registerCardDraftTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "create-card",
      description: "Create a virtual card. Does not move money. VERIFY required fields for your account.",
      inputSchema: cardInputShape,
      annotations: WRITE,
    },
    async (input) => {
      const body = { ...input, request_id: input.request_id ?? randomUUID() };
      return objectResult(await client.post<Record<string, unknown>>("/cards", body), "Virtual card created.");
    },
  );

  server.registerTool(
    {
      name: "freeze-card",
      description: "Freeze a card (blocks spending; reversible with unfreeze-card).",
      inputSchema: { id: z.string() },
      annotations: WRITE,
    },
    async ({ id }) =>
      objectResult(
        (await client.post<Record<string, unknown>>(`/cards/${encodeURIComponent(id)}/freeze`, {})) ?? { id, frozen: true },
        `Froze card ${id}.`,
      ),
  );

  server.registerTool(
    {
      name: "unfreeze-card",
      description: "Unfreeze a previously frozen card.",
      inputSchema: { id: z.string() },
      annotations: WRITE,
    },
    async ({ id }) =>
      objectResult(
        (await client.post<Record<string, unknown>>(`/cards/${encodeURIComponent(id)}/unfreeze`, {})) ?? { id, frozen: false },
        `Unfroze card ${id}.`,
      ),
  );
}

/** Payments tier: terminate (permanently delete) a card. */
export function registerCardPaymentTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "terminate-card",
      description: "Terminate (permanently delete) a card by id. Irreversible. Requires confirm=true.",
      inputSchema: {
        id: z.string(),
        confirm: z.literal(true).describe("Must be true to confirm this irreversible termination."),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ id }) => {
      await client.del(`/cards/${encodeURIComponent(id)}`);
      return { structuredContent: { id, terminated: true }, content: text(`Terminated card ${id}.`) };
    },
  );
}
