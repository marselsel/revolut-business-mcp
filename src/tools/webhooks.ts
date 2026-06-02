import type { McpServer } from "skybridge/server";
import { z } from "zod";
import type { RevolutClient } from "../revolut/client.js";
import { webhookInputShape } from "./schemas.js";
import { arrayResult, DESTRUCTIVE, objectResult, RO, text, WRITE } from "./shared.js";

/** Webhooks live on the v2 API base (the rest of the Business API is v1). */
const wh = (base: string, suffix = "") => `${base}/webhooks${suffix}`;

/** Read tools for webhooks. Always registered. */
export function registerWebhookReadTools(server: McpServer, client: RevolutClient, base: string): void {
  server.registerTool(
    {
      name: "list-webhooks",
      description: "List configured webhooks (v2) and their subscribed event types.",
      annotations: RO,
    },
    async () => arrayResult(await client.get<unknown[]>(wh(base)), "webhook(s)"),
  );

  server.registerTool(
    {
      name: "get-webhook",
      description: "Get a single webhook by id.",
      inputSchema: { id: z.string() },
      annotations: RO,
    },
    async ({ id }) =>
      objectResult(
        await client.get<Record<string, unknown>>(wh(base, `/${encodeURIComponent(id)}`)),
        `Webhook ${id} retrieved.`,
      ),
  );
}

/** Drafts tier: create a webhook / rotate its signing secret (no money movement). */
export function registerWebhookDraftTools(server: McpServer, client: RevolutClient, base: string): void {
  server.registerTool(
    {
      name: "create-webhook",
      description:
        "Create a webhook (v2) for transaction events. Returns the id and signing secret — store the secret to verify incoming deliveries.",
      inputSchema: webhookInputShape,
      annotations: WRITE,
    },
    async (input) => objectResult(await client.post<Record<string, unknown>>(wh(base), input), "Webhook created."),
  );

  server.registerTool(
    {
      name: "rotate-webhook-secret",
      description: "Rotate a webhook's signing secret. Returns the new secret.",
      inputSchema: { id: z.string() },
      annotations: WRITE,
    },
    async ({ id }) =>
      objectResult(
        await client.post<Record<string, unknown>>(wh(base, `/${encodeURIComponent(id)}/rotate-signing-secret`), {}),
        `Rotated signing secret for webhook ${id}.`,
      ),
  );
}

/** Payments tier: delete a webhook (stops event delivery; irreversible). */
export function registerWebhookPaymentTools(server: McpServer, client: RevolutClient, base: string): void {
  server.registerTool(
    {
      name: "delete-webhook",
      description: "Delete a webhook by id (stops event delivery). Irreversible. Requires confirm=true.",
      inputSchema: {
        id: z.string(),
        confirm: z.literal(true).describe("Must be true to confirm deletion."),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ id }) => {
      await client.del(wh(base, `/${encodeURIComponent(id)}`));
      return { structuredContent: { id, deleted: true }, content: text(`Deleted webhook ${id}.`) };
    },
  );
}
