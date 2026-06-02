import type { McpServer } from "skybridge/server";
import { z } from "zod";
import type { RevolutClient } from "../revolut/client.js";
import { arrayResult, objectResult, RO, WRITE } from "./shared.js";

/** Read tools for team members. Always registered. */
export function registerTeamReadTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "list-team-members",
      description: "List team members and their roles/state.",
      inputSchema: { count: z.number().int().min(1).max(100).default(100).describe("Max rows (≤100).") },
      annotations: RO,
    },
    async ({ count }) => arrayResult(await client.get<unknown[]>("/team-members", { count }), "team member(s)"),
  );

  server.registerTool(
    {
      name: "get-team-member",
      description: "Get a single team member by id.",
      inputSchema: { id: z.string() },
      annotations: RO,
    },
    async ({ id }) =>
      objectResult(
        await client.get<Record<string, unknown>>(`/team-members/${encodeURIComponent(id)}`),
        `Team member ${id} retrieved.`,
      ),
  );
}

/** Drafts tier: invite a team member (they must accept; no money movement). */
export function registerTeamDraftTools(server: McpServer, client: RevolutClient): void {
  server.registerTool(
    {
      name: "invite-team-member",
      description:
        "Invite a new team member by email + role id. They must accept the invitation. Does not move money.",
      inputSchema: {
        email: z.string().email(),
        role_id: z.string().describe("Role id (or a default role name like Owner/Admin/User)."),
      },
      annotations: WRITE,
    },
    async ({ email, role_id }) =>
      objectResult(await client.post<Record<string, unknown>>("/team-members", { email, role_id }), `Invited ${email}.`),
  );
}
