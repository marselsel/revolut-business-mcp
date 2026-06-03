import { randomUUID } from "node:crypto";
import type { McpServer } from "skybridge/server";
import { z } from "zod";
import type { RevolutClient } from "../revolut/client.js";
import { paymentDraftInputShape, paymentInputShape, transferInputShape } from "./schemas.js";
import { DESTRUCTIVE, objectResult, RO, text, WRITE } from "./shared.js";

/** Read tools: payment status + payment drafts. Always registered. */
export function registerPaymentReadTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "get-payment",
      description: "Get the status/detail of a payment (transaction) by id.",
      inputSchema: { id: z.string() },
      annotations: RO,
    },
    async ({ id }) =>
      // A payment is a transaction; look it up via the transactions resource.
      objectResult(
        await client.get<Record<string, unknown>>(`/transactions/${encodeURIComponent(id)}`),
        `Payment ${id} retrieved.`,
      ),
  );

  server.registerTool(
    {
      name: "list-payment-drafts",
      description: "List pending payment drafts (created via API, awaiting in-app approval).",
      annotations: RO,
    },
    async () => objectResult(await client.get<Record<string, unknown>>("/payment-drafts"), "Payment drafts retrieved."),
  );

  server.registerTool(
    {
      name: "get-payment-draft",
      description: "Get a single payment draft by id.",
      inputSchema: { id: z.string() },
      annotations: RO,
    },
    async ({ id }) =>
      objectResult(
        await client.get<Record<string, unknown>>(`/payment-drafts/${encodeURIComponent(id)}`),
        `Payment draft ${id} retrieved.`,
      ),
  );
}

/** Drafts tier: create a payment draft — needs in-app approval, no money moves. */
export function registerPaymentDraftTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "create-payment-draft",
      description:
        "Create a payment DRAFT (one or more payments). This does NOT move money — a Revolut Business app user must review and approve it before anything is sent. Prefer this over create-payment. Returns the draft id.",
      inputSchema: paymentDraftInputShape,
      annotations: WRITE,
    },
    async (input) => {
      const created = await client.post<{ id?: string }>("/payment-drafts", input);
      return objectResult(
        created,
        `Created payment draft ${created.id ?? ""} (awaiting in-app approval; no money moved yet).`,
      );
    },
  );
}

/** Payments tier (default OFF): move real money. Each call is confirm-gated. */
export function registerPaymentMoneyTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "create-payment",
      description:
        "Send a payment to a counterparty. MOVES REAL MONEY IMMEDIATELY and is generally irreversible. Requires confirm=true. Prefer create-payment-draft unless the user explicitly wants to send now. A request_id is generated server-side for idempotency.",
      inputSchema: {
        ...paymentInputShape,
        confirm: z.literal(true).describe("Must be true to acknowledge this moves real money."),
      },
      annotations: WRITE,
    },
    async ({ confirm: _confirm, ...input }) => {
      const request_id = randomUUID();
      const created = await client.post<Record<string, unknown>>("/pay", { request_id, ...input });
      return objectResult(
        { request_id, ...created },
        `Payment submitted (request_id ${request_id}). This moves real money.`,
      );
    },
  );

  server.registerTool(
    {
      name: "create-transfer",
      description:
        "Transfer money between YOUR OWN accounts. MOVES MONEY (instant for same-currency). Requires confirm=true. A request_id is generated server-side for idempotency.",
      inputSchema: {
        ...transferInputShape,
        confirm: z.literal(true).describe("Must be true to acknowledge this moves money."),
      },
      annotations: WRITE,
    },
    async ({ confirm: _confirm, ...input }) => {
      const request_id = randomUUID();
      const created = await client.post<Record<string, unknown>>("/transfer", { request_id, ...input });
      return objectResult({ request_id, ...created }, `Transfer submitted (request_id ${request_id}).`);
    },
  );

  server.registerTool(
    {
      name: "cancel-payment",
      description:
        "Cancel a SCHEDULED transaction (a future-dated payment) by id. Already-executed transactions can't be cancelled. Requires confirm=true.",
      inputSchema: {
        id: z.string(),
        confirm: z.literal(true).describe("Must be true to confirm cancellation."),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ id }) => {
      // Revolut's cancel-transaction endpoint (singular resource); applies to SCHEDULED
      // transactions and is not exercisable in the sandbox — verify against production.
      const res = await client.post<Record<string, unknown>>(
        `/transaction/${encodeURIComponent(id)}/cancel`,
        {},
      );
      return objectResult(res ?? { id, cancelled: true }, `Requested cancellation of transaction ${id}.`);
    },
  );

  server.registerTool(
    {
      name: "delete-payment-draft",
      description:
        "Delete a payment draft by id (only if it hasn't been submitted for processing). Requires confirm=true.",
      inputSchema: {
        id: z.string(),
        confirm: z.literal(true).describe("Must be true to confirm deletion."),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ id }) => {
      await client.del(`/payment-drafts/${encodeURIComponent(id)}`);
      return { structuredContent: { id, deleted: true }, content: text(`Deleted payment draft ${id}.`) };
    },
  );
}
