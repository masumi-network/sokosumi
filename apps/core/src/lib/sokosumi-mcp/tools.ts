/**
 * The tools Core's MCP server offers, one per Core `/v1` operation. Each name
 * and operation must match a row in `apps/core/agent-surface/<group>.json`
 * (`src/routes/v1/agent-surface.openapi.test.ts` checks it), and each tool
 * needs a fixture in `tools.surface.test.ts`. The input schema comes from the
 * operation's OpenAPI definition (`tool-schema.ts`).
 */
export interface McpTool {
  /** The CLI command with spaces and hyphens as `_` (docs/agents/agent-surface.md). */
  name: string;
  /** `METHOD /path` as Core's OpenAPI document writes it. */
  operation: string;
  description: string;
  /** Deletes or overwrites data. Only meaningful for writes. */
  destructive?: boolean;
}

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "users_get",
    operation: "GET /users/{id}",
    description: "Get a user's profile. Pass id `me` for the signed-in user.",
  },
  {
    name: "workspaces_list",
    operation: "GET /users/{id}/workspaces",
    description:
      "List the workspaces the signed-in user can act in. Pass id `me`. An organization workspace's `slug` is the `workspace` argument of other tools.",
  },
  {
    name: "tasks_list",
    operation: "GET /tasks",
    description:
      "List Tasks in a workspace, newest first. Pass `cursor` from `pagination.nextCursor` for the next page.",
  },
  {
    name: "tasks_get",
    operation: "GET /tasks/{id}",
    description:
      "Get a Task by id or by its identifier, such as SOK-123, with its status, assignees and description.",
  },
];
