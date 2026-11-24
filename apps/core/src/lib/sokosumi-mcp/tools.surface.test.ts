import { createMCPClient } from "@ai-sdk/mcp";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import mcpRouter from "@/routes/mcp/index";

import type { McpTokenVerification } from "./auth";
import { coreV1 } from "./dispatch";
import { MCP_TOOLS, MCP_TOOLSETS } from "./tools";

/**
 * One fixture per tool in `MCP_TOOLS`: the arguments an agent would send.
 * Each runs through a real MCP client, and the `/v1` request it makes must be
 * the tool's operation (docs/agents/agent-surface.md). Add a fixture with
 * every new tool.
 */
const FIXTURES: Record<string, Record<string, unknown>> = {
  users_get: { id: "me" },
  workspaces_list: { id: "me" },
  workspaces_create: { id: "me", body: { kind: "personal" } },
  tasks_list: { workspace: "acme", status: ["READY", "RUNNING"], limit: 5 },
  tasks_get: { id: "SOK-123", workspace: "acme" },
  tasks_create: { workspace: "acme", body: { name: "Write the launch post" } },
  tasks_update: { id: "SOK-123", body: { priority: "HIGH" } },
  tasks_archive: { id: "SOK-123" },
  tasks_events: { id: "SOK-123", limit: 20 },
  tasks_comment: { id: "SOK-123", body: { comment: "Draft is ready." } },
  tasks_jobs: { id: "SOK-123" },
  tasks_links: { id: "SOK-123" },
  tasks_link: {
    id: "SOK-123",
    body: { toTaskId: "SOK-124", relation: "BLOCKS" },
  },
  tasks_unlink: { id: "SOK-123", linkId: "link-1" },
  tasks_move: { id: "SOK-124", body: { parentTaskId: "SOK-123" } },
  tasks_receipt: { id: "SOK-123" },
  jobs_list: { workspace: "acme", status: "COMPLETED" },
  jobs_get: { id: "job-1" },
  jobs_input_request: { id: "job-1" },
  jobs_input: {
    id: "job-1",
    body: { eventId: "event-1", inputData: { topic: "Launch" } },
  },
  jobs_events: { id: "job-1" },
  jobs_files: { id: "job-1" },
  jobs_links: { id: "job-1" },
  agents_list: { limit: 10 },
  agents_input_schema: { id: "agent-1" },
  agents_hire: {
    id: "agent-1",
    body: { inputSchema: [], inputData: { topic: "Launch" }, maxCredits: 5 },
  },
  coworkers_list: { capability: "tasks" },
  coworkers_get: { id: "cw-1" },
  coworkers_register: { body: { name: "Ada", vendorId: "vendor-1" } },
  coworkers_update: { id: "cw-1", body: { caption: "Writes posts" } },
  coworkers_connect: { id: "cw-1", body: { organizationSlug: "acme" } },
  coworkers_list_api_keys: { id: "cw-1" },
  coworkers_revoke_api_key: { id: "cw-1", keyId: "key-1" },
  vendors_me: {},
  vendors_create: { body: { name: "Acme Agents", slug: "acme-agents" } },
  // SOKD-372: coworkers, vendors and developer.
  coworkers_archive: { id: "cw-1" },
  coworkers_remove_image: { id: "cw-1" },
  coworkers_update_api_key: {
    id: "cw-1",
    keyId: "key-1",
    body: { name: "Runtime" },
  },
  coworkers_list_access: { id: "cw-1" },
  coworkers_revoke_access: { id: "cw-1", body: { organizationSlug: "acme" } },
  vendors_list: {},
  vendors_update: { id: "vendor-1", body: { name: "Acme Agents" } },
  vendors_logo_cleanup: {
    id: "vendor-1",
    body: { url: "https://blob.example/vendors/vendor-1/logos/old.png" },
  },
  vendors_members: { id: "vendor-1" },
  vendors_update_member: {
    id: "vendor-1",
    userId: "user-2",
    body: { role: "admin" },
  },
  vendors_remove_member: { id: "vendor-1", userId: "user-2" },
  vendors_invites: { id: "vendor-1" },
  vendors_invite: { id: "vendor-1", body: { email: "dev@example.com" } },
  vendors_revoke_invite: { id: "vendor-1", inviteId: "invite-1" },
  vendors_my_invites: {},
  vendors_accept_invite: { inviteId: "invite-1" },
  vendors_decline_invite: { inviteId: "invite-1" },
  vendors_assignments: { id: "vendor-1", coworkerId: "cw-1" },
  vendors_assign: {
    id: "vendor-1",
    coworkerId: "cw-1",
    body: { userId: "user-2" },
  },
  vendors_unassign: { id: "vendor-1", coworkerId: "cw-1", userId: "user-2" },
  developer_tasks: { limit: 10 },
  developer_task: { id: "task-1" },
  organizations_list: { id: "me" },
  organizations_seat: { id: "org-1" },
  // SOKD-378: ads, image-studio, social and calendar reads.
  image_studio_catalog: {},
  image_studio_state: {},
  image_studio_recent_projects: {},
  projects_ads_accounts: { id: "p-1" },
  projects_ads_campaigns: { id: "p-1", accountId: "acc-1" },
  projects_ads_campaign: { id: "p-1", accountId: "acc-1", campaignId: "42" },
  projects_ads_locations: { id: "p-1", accountId: "acc-1", q: "Berlin" },
  projects_ads_languages: { id: "p-1", accountId: "acc-1" },
  projects_ads_market: { id: "p-1" },
  projects_image_studio: { id: "p-1" },
  projects_image_studio_batch: { id: "p-1", batchId: "b-1" },
  projects_image_studio_compare: { id: "p-1", batchId: "b-1" },
  projects_image_studio_scoreboard: { id: "p-1" },
  projects_image_studio_brand_kit: { id: "p-1" },
  projects_image_studio_website_copy: { id: "p-1" },
  projects_image_studio_website_draft: { id: "p-1" },
  projects_image_studio_products: { id: "p-1" },
  projects_image_studio_talking_videos: { id: "p-1" },
  projects_social_connections: { id: "p-1" },
  projects_social_connection_subscription: { id: "p-1", connectionId: "c-1" },
  projects_social_connection_tiktok_creator: { id: "p-1", connectionId: "c-1" },
  projects_social_connection_suggested_times: {
    id: "p-1",
    connectionId: "c-1",
    timezone: "Europe/Berlin",
  },
  projects_social_statistics: { id: "p-1" },
  projects_social_posts: { id: "p-1" },
  projects_social_post: { id: "p-1", postId: "sp-1" },
  projects_social_posts_statistics: { id: "p-1" },
  projects_social_queue_slots: { id: "p-1" },
  projects_calendar: {
    id: "p-1",
    from: "2026-11-01T00:00:00.000Z",
    to: "2026-12-01T00:00:00.000Z",
  },
  workspaces_calendar: {
    from: "2026-11-01T00:00:00.000Z",
    to: "2026-12-01T00:00:00.000Z",
  },
  workspaces_calendar_sources: {},
  workspaces_social_posts: {},
  workspaces_social_statistics: { id: "ws-1" },
};

const CORE = "https://core.example.test";

vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({ baseURL: "https://core.example.test/auth" }),
  },
}));
vi.mock("./auth", () => ({
  verifyMcpAccessToken: async (): Promise<McpTokenVerification> => ({
    status: "active",
    authContext: {
      actor: "user",
      userId: "user_mcp",
      organizationId: null,
      role: "user",
      authenticationMethod: "oauth",
    },
  }),
}));

/** `GET /tasks/{id}` → /^\/tasks\/[^/]+$/ */
function pathPattern(path: string): RegExp {
  return new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}$`);
}

let client: Awaited<ReturnType<typeof createMCPClient>>;

beforeAll(async () => {
  const app = new Hono();
  app.use(requestId());
  app.onError(errorHandler);
  app.route("/mcp", mcpRouter);
  client = await createMCPClient({
    transport: {
      type: "http",
      url: `${CORE}/mcp?toolsets=${MCP_TOOLSETS.join(",")}`,
      headers: { Authorization: "Bearer mcp-token" },
      fetch: async (input, init) => app.request(input, init),
    },
  });
});

afterAll(async () => {
  await client.close();
});

describe("MCP tool surface", () => {
  it("has a fixture for every tool, and no other", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(
      MCP_TOOLS.map((tool) => tool.name).sort(),
    );
  });

  it.each(MCP_TOOLS)(
    "$name calls $operation",
    async (tool) => {
      const fetch = vi
        .spyOn(coreV1, "fetch")
        .mockResolvedValue(Response.json({ data: {} }));

      const result = await client.callTool({
        name: tool.name,
        arguments: FIXTURES[tool.name],
      });

      expect(result.isError).toBeFalsy();
      expect(fetch).toHaveBeenCalledOnce();
      const request = fetch.mock.calls[0]?.[0] as Request;
      const [method = "", path = ""] = tool.operation.split(" ");
      expect(request.method).toBe(method);
      expect(new URL(request.url).pathname).toMatch(pathPattern(path));
      fetch.mockRestore();
    },
    15_000,
  );
});
