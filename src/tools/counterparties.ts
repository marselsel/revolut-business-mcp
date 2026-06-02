import type { McpServer } from "skybridge/server";
import { z } from "zod";
import type { RevolutClient } from "../revolut/client.js";
import { counterpartyInputShape } from "./schemas.js";
import { arrayResult, DESTRUCTIVE, objectResult, RO, text, WRITE } from "./shared.js";

/** Read tools for counterparties (payees). Always registered. */
export function registerCounterpartyReadTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "list-counterparties",
      description: "List saved counterparties (payees) and their accounts.",
      annotations: RO,
    },
    async () => arrayResult(await client.get<unknown[]>("/counterparties"), "counterparty(ies)"),
  );

  server.registerTool(
    {
      name: "get-counterparty",
      description: "Get a single counterparty by id.",
      inputSchema: { id: z.string() },
      annotations: RO,
    },
    async ({ id }) =>
      objectResult(
        await client.get<Record<string, unknown>>(`/counterparties/${encodeURIComponent(id)}`),
        `Counterparty ${id} retrieved.`,
      ),
  );
}

/** Drafts tier: add a counterparty (does NOT move money). */
export function registerCounterpartyDraftTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "create-counterparty",
      description:
        "Add a counterparty (payee). Does NOT move money. Provide either a Revolut counterparty (profile_type + name/revtag) or an external bank account (name/company_name + iban[/bic] or account_no+sort_code). Returns the new id.",
      inputSchema: counterpartyInputShape,
      annotations: WRITE,
    },
    async (input) => {
      const created = await client.post<{ id?: string }>("/counterparties", input);
      return objectResult(created, `Created counterparty ${created.id ?? ""}.`);
    },
  );
}

/** Payments tier: delete a counterparty (irreversible config change). */
export function registerCounterpartyPaymentTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "delete-counterparty",
      description:
        "Delete a counterparty by id. Irreversible (does not affect past payments). Requires confirm=true.",
      inputSchema: {
        id: z.string(),
        confirm: z.literal(true).describe("Must be true to confirm this irreversible delete."),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ id }) => {
      await client.del(`/counterparties/${encodeURIComponent(id)}`);
      return { structuredContent: { id, deleted: true }, content: text(`Deleted counterparty ${id}.`) };
    },
  );
}
