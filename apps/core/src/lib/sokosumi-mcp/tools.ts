/**
 * The tools Core's MCP server offers, one per Core `/v1` operation. Each name
 * and operation must match a row in `apps/core/agent-surface/<group>.json`
 * (`src/routes/v1/agent-surface.openapi.test.ts` checks it), and each tool
 * needs a fixture in `tools.surface.test.ts`. The input schema comes from the
 * operation's OpenAPI definition (`tool-schema.ts`).
 */
export interface McpTool {
  /**
   * The CLI command with spaces and hyphens as `_`, or `<group>_<verb>`
   * (docs/agents/agent-surface.md). The first segment is its toolset.
   */
  name: string;
  /** `METHOD /path` as Core's OpenAPI document writes it. */
  operation: string;
  description: string;
  /** Deletes or overwrites data. Only meaningful for writes. */
  destructive?: boolean;
  /**
   * Spends workspace credits. Annotated destructive and open-world so
   * clients ask the person first; the description starts with the warning.
   */
  spendsCredits?: boolean;
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
    name: "workspaces_create",
    operation: "POST /users/{id}/workspaces",
    description:
      'Create a workspace for the signed-in user and make it preferred. Pass id `me` and body `{ "kind": "personal" }`, or `{ "kind": "organization", "name", "websiteUrl" }` for an organization.',
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
  {
    name: "tasks_create",
    operation: "POST /tasks",
    description:
      "Create a Task in a workspace. `body.name` is the title; `body.description` takes Markdown; `body.parentTaskId` makes it a sub-task.",
  },
  {
    name: "tasks_update",
    operation: "PATCH /tasks/{id}",
    description:
      "Change a Task's name, description, assignee, priority, project or dates. Only the fields in `body` change. Use tasks_comment to change its status.",
    destructive: true,
  },
  {
    name: "tasks_archive",
    operation: "DELETE /tasks/{id}",
    description: "Archive a Task. It leaves every list.",
  },
  {
    name: "tasks_events",
    operation: "GET /tasks/{id}/events",
    description:
      "List a Task's events, oldest first: status changes and comments. Pass `limit` and `cursor` to page.",
  },
  {
    name: "tasks_comment",
    operation: "POST /tasks/{id}/events",
    description:
      "Comment on a Task, change its status, or both: `body.comment` (Markdown) and `body.status`.",
  },
  {
    name: "tasks_jobs",
    operation: "GET /tasks/{id}/jobs",
    description: "List the Jobs that ran for a Task.",
  },
  {
    name: "tasks_links",
    operation: "GET /tasks/{id}/links",
    description:
      "List a Task's links to other Tasks (blocks, relates to, duplicates).",
  },
  {
    name: "tasks_link",
    operation: "POST /tasks/{id}/links",
    description:
      "Link a Task to another: `body.toTaskId` and `body.relation`. Use tasks_move for parent and sub-task.",
  },
  {
    name: "tasks_unlink",
    operation: "DELETE /tasks/{id}/links/{linkId}",
    description: "Remove a link between two Tasks. `linkId` from tasks_links.",
  },
  {
    name: "tasks_move",
    operation: "POST /tasks/{id}/move",
    description:
      "Move a Task in the sub-task tree: `body.parentTaskId` (null for top level) and `body.afterTaskId` for its place among siblings.",
  },
  {
    name: "tasks_receipt",
    operation: "GET /tasks/{id}/receipt",
    description:
      "Check whether a Coworker Task's payment settled, with the seller receipt.",
  },
  {
    name: "jobs_list",
    operation: "GET /jobs",
    description:
      "List Jobs in a workspace, newest first. Filter by `status`, `agentId` or `projectId`; pass `cursor` for the next page.",
  },
  {
    name: "jobs_get",
    operation: "GET /jobs/{id}",
    description: "Get a Job with its status, input and result.",
  },
  {
    name: "jobs_input_request",
    operation: "GET /jobs/{id}/input-request",
    description:
      "Get the input a Job is waiting for: its `eventId` and the fields to fill. Answer with jobs_input.",
  },
  {
    name: "jobs_input",
    operation: "POST /jobs/{id}/inputs",
    description:
      "Answer a Job waiting for input: `body.eventId` from jobs_input_request and `body.inputData`.",
  },
  {
    name: "jobs_events",
    operation: "GET /jobs/{id}/events",
    description: "List a Job's events: status changes and input requests.",
  },
  {
    name: "jobs_files",
    operation: "GET /jobs/{id}/files",
    description: "List the files a Job produced.",
  },
  {
    name: "jobs_links",
    operation: "GET /jobs/{id}/links",
    description: "List the links a Job produced.",
  },
  {
    name: "agents_list",
    operation: "GET /agents",
    description:
      "List the agents you can hire, with their price. Pass `cursor` for the next page.",
  },
  {
    name: "agents_input_schema",
    operation: "GET /agents/{id}/input-schema",
    description:
      "Get the input an agent needs. Pass it as `body.inputSchema` to agents_hire.",
  },
  {
    name: "agents_hire",
    operation: "POST /agents/{id}/jobs",
    description:
      "Spends workspace credits. Hire an agent: start a paid Job. `body.inputSchema` from agents_input_schema, `body.inputData` with the answers, and `body.maxCredits` to cap the cost. Confirm the agent and the price with the person first.",
    spendsCredits: true,
  },
  {
    name: "coworkers_list",
    operation: "GET /coworkers",
    description:
      "List the Coworkers in a workspace. Filter by `capability`, such as `tasks`.",
  },
  {
    name: "coworkers_get",
    operation: "GET /coworkers/{id}",
    description: "Get a Coworker with its vendor, capabilities and metadata.",
  },
  {
    name: "coworkers_register",
    operation: "POST /coworkers",
    description:
      "Register a private Coworker under a vendor you admin: `body.name` and `body.vendorId` from vendors_me.",
  },
  {
    name: "coworkers_update",
    operation: "PATCH /coworkers/{id}",
    description:
      "Change a Coworker's name, caption, description, URLs, capabilities or metadata. Only the fields in `body` change.",
    destructive: true,
  },
  {
    name: "coworkers_connect",
    operation: "POST /coworkers/{id}/workspace-access",
    description:
      "Give a Coworker access to a workspace, or propose it when you do not admin its vendor. `body.organizationSlug` names an organization workspace.",
  },
  {
    name: "coworkers_list_api_keys",
    operation: "GET /coworkers/{id}/api-keys",
    description: "List a Coworker's API keys, without their secrets.",
  },
  {
    name: "coworkers_revoke_api_key",
    operation: "DELETE /coworkers/{id}/api-keys/{keyId}",
    description:
      "Revoke a Coworker API key. Anything using it stops working. `keyId` from coworkers_list_api_keys.",
  },
  {
    name: "vendors_me",
    operation: "GET /vendors/me",
    description: "List the vendors you belong to, with your role.",
  },
  {
    name: "vendors_create",
    operation: "POST /vendors",
    description:
      "Create a vendor you own, to register private Coworkers under: `body.name` and `body.slug`.",
  },
  // SOKD-372: coworkers, vendors and developer.
  {
    name: "coworkers_archive",
    operation: "DELETE /coworkers/{id}",
    description:
      "Archive a Coworker you manage. Its API keys are revoked and it stops taking work.",
  },
  {
    name: "coworkers_remove_image",
    operation: "DELETE /coworkers/{id}/image",
    description: "Remove a Coworker's picture.",
  },
  {
    name: "coworkers_update_api_key",
    operation: "PATCH /coworkers/{id}/api-keys/{keyId}",
    description:
      "Rename a Coworker API key or change its expiry: `body.name`, `body.expiresAt` (null for none). `keyId` from coworkers_list_api_keys.",
    destructive: true,
  },
  {
    name: "coworkers_list_access",
    operation: "GET /coworkers/{id}/workspace-access",
    description:
      "List the workspaces a Coworker can work in, or has asked to, with each grant's status.",
  },
  {
    name: "coworkers_revoke_access",
    operation: "POST /coworkers/{id}/workspace-access/revoke",
    description:
      "Take a Coworker's access to a workspace away. `body.organizationSlug` names an organization workspace; `body.userId` a personal one.",
    destructive: true,
  },
  {
    name: "vendors_list",
    operation: "GET /vendors",
    description: "List the vendors you can pick from.",
  },
  {
    name: "vendors_update",
    operation: "PATCH /vendors/{id}",
    description:
      "Change a vendor you admin: `body.name` or `body.logos`. Only the fields in `body` change.",
    destructive: true,
  },
  {
    name: "vendors_logo_cleanup",
    operation: "POST /vendors/{id}/files/cleanup",
    description:
      "Delete a vendor's old logo file after you replace it with vendors_update: `body.url` is the old logo URL. URLs the vendor does not own are ignored.",
    destructive: true,
  },
  {
    name: "vendors_members",
    operation: "GET /vendors/{id}/members",
    description: "List a vendor's members with their role.",
  },
  {
    name: "vendors_update_member",
    operation: "PATCH /vendors/{id}/members/{userId}",
    description:
      "Change a vendor member's role: `body.role` is `admin` or `developer`.",
    destructive: true,
  },
  {
    name: "vendors_remove_member",
    operation: "DELETE /vendors/{id}/members/{userId}",
    description: "Remove a member from a vendor you admin.",
  },
  {
    name: "vendors_invites",
    operation: "GET /vendors/{id}/invites",
    description: "List a vendor's pending member invitations.",
  },
  {
    name: "vendors_invite",
    operation: "POST /vendors/{id}/invites",
    description:
      "Invite someone to a vendor you admin: `body.email` and optional `body.role` (`developer` by default). They join when they accept.",
  },
  {
    name: "vendors_revoke_invite",
    operation: "DELETE /vendors/{id}/invites/{inviteId}",
    description:
      "Withdraw a pending vendor invitation. `inviteId` from vendors_invites.",
  },
  {
    name: "vendors_my_invites",
    operation: "GET /vendors/invites",
    description:
      "List the vendor invitations waiting for you. Answer with vendors_accept_invite or vendors_decline_invite.",
  },
  {
    name: "vendors_accept_invite",
    operation: "POST /vendors/invites/{inviteId}/accept",
    description:
      "Accept a vendor invitation and join that vendor. Confirm with the person first.",
  },
  {
    name: "vendors_decline_invite",
    operation: "POST /vendors/invites/{inviteId}/decline",
    description: "Decline a vendor invitation. It cannot be accepted after.",
    destructive: true,
  },
  {
    name: "vendors_assignments",
    operation: "GET /vendors/{id}/coworkers/{coworkerId}/assignments",
    description: "List the vendor members assigned to a Coworker.",
  },
  {
    name: "vendors_assign",
    operation: "PUT /vendors/{id}/coworkers/{coworkerId}/assignments",
    description:
      "Assign a vendor member to a Coworker so they can work on it: `body.userId` from vendors_members.",
  },
  {
    name: "vendors_unassign",
    operation:
      "DELETE /vendors/{id}/coworkers/{coworkerId}/assignments/{userId}",
    description: "Remove a vendor member from a Coworker.",
  },
  {
    name: "developer_tasks",
    operation: "GET /developer/tasks",
    description:
      "List Tasks your Coworkers created or were assigned, across every workspace they work in. Filter by `coworkerId`; pass `cursor` for the next page.",
  },
  {
    name: "developer_task",
    operation: "GET /developer/tasks/{id}",
    description:
      "Get a Task one of your Coworkers created or was assigned, with its owner and workspace. `id` from developer_tasks.",
  },
  {
    name: "organizations_list",
    operation: "GET /users/{id}/organizations",
    description:
      "List the organizations the signed-in user belongs to, with their role. Pass id `me`.",
  },
  {
    name: "organizations_seat",
    operation: "GET /organizations/{id}/members/me/seat",
    description:
      "Check whether you hold a seat in an organization. Paid organizations need one to run work.",
  },
];

/** A tool's toolset: the route group its name starts with. */
export function toolsetOf(name: string): string {
  return name.split("_", 1)[0] ?? name;
}

/** Every toolset, in registry order. */
export const MCP_TOOLSETS: readonly string[] = [
  ...new Set(MCP_TOOLS.map((tool) => toolsetOf(tool.name))),
];

/** The toolsets a server URL without `?toolsets=` gets. */
export const DEFAULT_TOOLSETS = [
  "workspaces",
  "users",
  "tasks",
  "jobs",
  "agents",
  "coworkers",
] as const;

/**
 * The toolsets `?toolsets=` names (comma-separated, or repeated), or the
 * default ones when the URL has none.
 */
export function selectToolsets(
  values: readonly string[] | undefined,
): { toolsets: readonly string[] } | { error: string } {
  if (values === undefined) return { toolsets: DEFAULT_TOOLSETS };

  const names = values.flatMap((value) =>
    value
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const known = `Toolsets: ${MCP_TOOLSETS.join(", ")}.`;
  const unknown = names.find((name) => !MCP_TOOLSETS.includes(name));
  if (unknown !== undefined) {
    return { error: `Unknown toolset "${unknown}". ${known}` };
  }
  if (names.length === 0) {
    return { error: `Name at least one toolset. ${known}` };
  }
  return { toolsets: [...new Set(names)] };
}
