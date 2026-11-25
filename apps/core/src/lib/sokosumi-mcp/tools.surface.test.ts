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
const TASK_ID = "01a20919-70ff-7529-9bd5-78b72b6a3ea2";

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
  // SOKD-369: schedules, files, follow, participants, workspace, summary, due dates.
  tasks_summary: { workspace: "acme", scope: "workspace" },
  tasks_view: { workspace: "acme" },
  tasks_set_view: { workspace: "acme", body: { query: "status=READY" } },
  tasks_move_overdue: {
    workspace: "acme",
    body: { today: "2026-11-24", to: "2026-11-25" },
  },
  tasks_undo_move_overdue: {
    workspace: "acme",
    body: {
      to: "2026-11-25",
      tasks: [
        { id: "task-1", from: "2026-11-20", version: "2026-11-24T10:00:00Z" },
      ],
    },
  },
  tasks_list_schedules: { workspace: "acme", state: "ACTIVE", limit: 10 },
  tasks_create_schedule: {
    workspace: "acme",
    body: { name: "Weekly report", rule: { expr: "0 9 * * 1" } },
  },
  tasks_schedule_assignees: { workspace: "acme" },
  tasks_get_schedule: { id: "sched-1" },
  tasks_update_schedule: {
    id: "sched-1",
    body: { expectedRevision: 3, name: "Monday report" },
  },
  tasks_delete_schedule: { id: "sched-1" },
  tasks_pause_schedule: { id: "sched-1" },
  tasks_resume_schedule: { id: "sched-1" },
  tasks_end_schedule: { id: "sched-1" },
  tasks_schedule_runs: { id: "sched-1", limit: 10 },
  tasks_run_schedule: { id: "sched-1", body: { expectedRevision: 3 } },
  tasks_update_schedule_run: {
    id: "sched-1",
    runId: "run-1",
    body: { expectedRevision: 3, action: "skip" },
  },
  tasks_update_link: {
    id: TASK_ID,
    linkId: "link-1",
    body: { note: "Waits on the copy." },
  },
  tasks_join: { id: TASK_ID },
  tasks_leave: { id: TASK_ID, userId: "user_mcp" },
  tasks_follow: { id: TASK_ID },
  tasks_unfollow: { id: TASK_ID },
  tasks_send_to_chat: {
    id: TASK_ID,
    body: {
      roomId: "01960001-0001-7001-8001-000000000001",
      clientMessageId: "msg-1",
    },
  },
  tasks_workspace: { id: TASK_ID },
  tasks_set_workspace: { id: TASK_ID, body: { organizationId: "org-1" } },
  tasks_restore: { id: TASK_ID },
  tasks_files: { id: TASK_ID },
  tasks_upload_url: {
    id: TASK_ID,
    body: { filename: "brief.pdf", contentType: "application/pdf", size: 2048 },
  },
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
  projects_image_studio_generate: {
    id: "p-1",
    body: { prompt: "A red vase", idempotencyKey: "intent-0001" },
  },
  projects_image_studio_video: {
    id: "p-1",
    body: { prompt: "A red vase turning", idempotencyKey: "intent-0002" },
  },
  projects_image_studio_short_video: {
    id: "p-1",
    body: {
      format: "voiceover",
      script: "Meet the vase that finishes every shelf.",
      idempotencyKey: "intent-0003",
    },
  },
  projects_image_studio_talking_video: {
    id: "p-1",
    body: {
      script: "Meet the vase that finishes every shelf.",
      presenter: { kind: "stock", id: "ada" },
      idempotencyKey: "intent-0004",
    },
  },
  projects_image_studio_cancel: { id: "p-1", jobId: "job-1" },
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
  // SOKD-370: jobs, agents and account reads.
  jobs_update: { id: "job-1", body: { name: "Launch brief" } },
  jobs_move: { id: "job-1", body: { organizationId: null } },
  jobs_unshare: { id: "job-1" },
  agents_get: { id: "agent-1" },
  agents_jobs: { id: "agent-1", scope: "workspace" },
  agents_reviews: { id: "agent-1", limit: 5 },
  agents_my_review: { id: "agent-1" },
  agents_rating_eligibility: { id: "agent-1" },
  categories_list: {},
  history_list: { workspace: "acme", types: ["job"] },
  transactions_list: { workspace: "acme", taskId: "task-1" },
  transactions_daily: { from: "2026-11-01", to: "2026-11-24" },
  transactions_total: { taskId: "task-1" },
  notifications_list: { isRead: "false" },
  notifications_counts: {},
  notifications_read: { id: "notification-1" },
  notifications_unread: { id: "notification-1" },
  notifications_read_many: { body: { ids: ["notification-1"] } },
  notifications_read_all: {},
  // SOKD-371: users, organizations and workspaces.
  users_update: { id: "me", body: { firstName: "Ada", lastName: "Lovelace" } },
  workspaces_credits: { id: "me" },
  users_set_design_md: {
    id: "me",
    body: { content: "# Brand", extractionId: null },
  },
  users_preferences: { id: "me" },
  users_update_preferences: { id: "me", body: { marketingOptIn: false } },
  users_files: { id: "me" },
  users_coworker_access: { id: "me" },
  users_deny_coworker_access: { id: "me", accessId: "access-1" },
  users_revoke_coworker_access: { id: "me", accessId: "access-1" },
  users_vendor_grants: { id: "me", status: "PENDING" },
  users_deny_vendor_grant: { id: "me", grantId: "grant-1" },
  users_revoke_vendor_grant: { id: "me", grantId: "grant-1" },
  users_preferred_workspace: { id: "me" },
  users_set_preferred_workspace: { id: "me", body: { workspaceId: "ws-1" } },
  users_delete_workspace: { id: "me", workspaceId: "ws-1" },
  workspaces_get: { id: "ws-1" },
  workspaces_ad_data_consent: { id: "ws-1" },
  workspaces_calendar_labels: { id: "ws-1", body: { refs: ["ref-1"] } },
  workspaces_design_md: { workspace: "acme" },
  workspaces_adhoc_design_md: {
    body: { content: "# Other brand", extractionId: null },
  },
  organizations_memberships: { id: "me" },
  organizations_credits: { id: "me", organizationId: "org-1" },
  organizations_membership: { id: "me", organizationId: "org-1" },
  organizations_pending_invitations: { id: "me" },
  organizations_get_by_slug: { slug: "acme" },
  organizations_get: { id: "org-1" },
  organizations_members: { id: "org-1" },
  organizations_assign_seat: { id: "org-1", memberId: "member-1" },
  organizations_unassign_seat: { id: "org-1", memberId: "member-1" },
  organizations_invitations: { id: "org-1" },
  organizations_coworker_access: { id: "org-1" },
  organizations_deny_coworker_access: { id: "org-1", accessId: "access-1" },
  organizations_revoke_coworker_access: { id: "org-1", accessId: "access-1" },
  organizations_vendor_grants: { id: "org-1" },
  organizations_deny_vendor_grant: { id: "org-1", grantId: "grant-1" },
  organizations_revoke_vendor_grant: { id: "org-1", grantId: "grant-1" },
  organizations_set_design_md: {
    id: "org-1",
    body: { content: "# Brand", extractionId: null },
  },
  organizations_standup: { id: "org-1" },
  organizations_set_standup: { id: "org-1", body: { enabled: false } },
  // SOKD-383
  projects_social_post_create: { id: "p-1", body: { text: "Hello" } },
  projects_social_post_update: {
    id: "p-1",
    postId: "post-1",
    body: { revision: 0, text: "Hi" },
  },
  projects_social_post_schedule: {
    id: "p-1",
    postId: "post-1",
    body: { revision: 0, scheduledAt: "2030-01-01T10:00:00Z" },
  },
  projects_social_post_queue: {
    id: "p-1",
    postId: "post-1",
    body: { revision: 0 },
  },
  projects_social_post_cancel: {
    id: "p-1",
    postId: "post-1",
    body: { revision: 0 },
  },
  projects_social_post_duplicate: { id: "p-1", postId: "post-1" },
  projects_social_post_statistics_refresh: { id: "p-1", postId: "post-1" },
  projects_social_account_post_recycle: {
    id: "p-1",
    accountPostId: "ap-1",
    body: {},
  },
  projects_social_queue_slots_update: {
    id: "p-1",
    body: { timezone: "UTC", slots: [] },
  },
  projects_social_connection_statistics_refresh: {
    id: "p-1",
    connectionId: "c-1",
  },
  projects_newsletter_issue_cancel: {
    id: "p-1",
    issueId: "issue-1",
    body: { revision: 0 },
  },
  // SOKD-373: projects and newsletter.
  projects_list: { state: "open" },
  projects_create: { body: { name: "Launch" } },
  projects_stats: {},
  projects_activity: { limit: 10 },
  projects_starred: {},
  projects_get: { id: "p-1" },
  projects_update: { id: "p-1", body: { briefing: "We sell running shoes." } },
  projects_star: { id: "p-1" },
  projects_unstar: { id: "p-1" },
  projects_hidden: { id: "p-1" },
  projects_hide: { id: "p-1" },
  projects_unhide: { id: "p-1" },
  projects_add_job: { id: "p-1", body: { jobId: "job-1" } },
  projects_remove_job: { id: "p-1", jobId: "job-1" },
  projects_add_task: { id: "p-1", body: { taskId: "task-1" } },
  projects_remove_task: { id: "p-1", taskId: "task-1" },
  projects_context: { id: "p-1" },
  projects_posting_instructions: { id: "p-1" },
  projects_set_design: { id: "p-1", body: { content: "# Design\n" } },
  projects_clear_design: { id: "p-1" },
  projects_needs_attention: { id: "p-1" },
  projects_close_status: { id: "p-1" },
  projects_close: {
    id: "p-1",
    body: { operationId: "op-1", expectedProjectRevision: 3 },
  },
  projects_retry_close: {
    id: "p-1",
    body: {
      operationId: "op-2",
      expectedProjectRevision: 3,
      reason: "Provider was down",
    },
  },
  projects_cancel_owed: {
    id: "p-1",
    body: {
      operationId: "op-3",
      expectedProjectRevision: 3,
      reason: "Not needed",
    },
  },
  projects_brand_brain: { id: "p-1" },
  projects_set_brand_brain: {
    id: "p-1",
    body: {
      brandBrain: {
        summary: "Running shoes",
        voice: {},
        audience: [],
        products: [],
        competitors: [],
        channels: [],
      },
    },
  },
  projects_answer_brand_brain: {
    id: "p-1",
    body: { questionId: "q-1", answer: "yes" },
  },
  projects_competitors: { id: "p-1" },
  projects_add_competitor: { id: "p-1", body: { name: "Acme" } },
  projects_update_competitor: {
    id: "p-1",
    competitorId: "comp-1",
    body: { pricingUrl: "https://acme.example/pricing" },
  },
  projects_remove_competitor: { id: "p-1", competitorId: "comp-1" },
  projects_competitor_checks: { id: "p-1", body: { on: true } },
  projects_check_competitors: { id: "p-1" },
  projects_suggest_competitors: { id: "p-1" },
  projects_strategies: { id: "p-1" },
  projects_create_strategy: {
    id: "p-1",
    body: {
      plan: {
        month: "2026-12",
        summary: "Grow signups",
        goals: [],
        pillars: [],
        channels: [],
        calendar: [],
      },
    },
  },
  projects_strategy: { id: "p-1", strategyId: "strat-1" },
  projects_answer_strategy: {
    id: "p-1",
    strategyId: "strat-1",
    body: { questionId: "q-1", answer: "no", note: "We only sell online." },
  },
  newsletter_availability: {},
  newsletter_get: { id: "p-1" },
  newsletter_set: {
    id: "p-1",
    body: {
      name: "Weekly",
      senderName: "Ada",
      replyTo: "ada@example.com",
      brand: {},
      welcomeEmailEnabled: false,
    },
  },
  newsletter_analytics: { id: "p-1" },
  newsletter_issue_analytics: { id: "p-1", issueId: "issue-1" },
  newsletter_issues: { id: "p-1", status: "DRAFT" },
  newsletter_create_issue: {
    id: "p-1",
    body: { subject: "December news", template: "TEXT", content: {} },
  },
  newsletter_draft_issue: { id: "p-1", body: { brief: "Our December launch" } },
  newsletter_submit_issue: {
    id: "p-1",
    issueId: "issue-1",
    body: { revision: 2 },
  },
  newsletter_preview: {
    id: "p-1",
    body: { subject: "December news", template: "TEXT", content: {} },
  },
  newsletter_issue: { id: "p-1", issueId: "issue-1" },
  newsletter_update_issue: {
    id: "p-1",
    issueId: "issue-1",
    body: { subject: "December news, updated", revision: 2 },
  },
  newsletter_delete_issue: { id: "p-1", issueId: "issue-1" },
  newsletter_sending_domain: { id: "p-1" },
  newsletter_set_sending_domain: {
    id: "p-1",
    body: { fromAddress: "news@acme.example" },
  },
  newsletter_remove_sending_domain: { id: "p-1" },
  newsletter_check_sending_domain: { id: "p-1" },
  newsletter_domain_connect: { id: "p-1" },
  newsletter_subscribers: { id: "p-1", status: "ACTIVE" },
  newsletter_update_subscriber: {
    id: "p-1",
    subscriberId: "sub-1",
    body: { name: "Ada Lovelace" },
  },
  newsletter_remove_subscriber: { id: "p-1", subscriberId: "sub-1" },
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
