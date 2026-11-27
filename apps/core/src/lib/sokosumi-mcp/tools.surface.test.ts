import { createMCPClient } from "@ai-sdk/mcp";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import mcpRouter from "@/routes/mcp/index";

import type { McpTokenVerification } from "./auth";
import { coreV1 } from "./dispatch";
import { MCP_TOOLS, MCP_TOOLSETS } from "./tools";

const CONTACT = "01a20919-0000-7000-8000-000000000001";
const OTHER = "01a20919-0000-7000-8000-000000000002";
const COMPANY = "01a20919-0000-7000-8000-000000000003";
const LIST = "01a20919-0000-7000-8000-000000000004";

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
  // SOKD-394: edits that spend nothing.
  projects_ads_market_update: {
    id: "p-1",
    body: { keywords: ["lamp"], countryCode: "DE", languageCode: "de" },
  },
  projects_image_studio_brand_kit_update: {
    id: "p-1",
    body: {
      copy: { summary: "Lamps", tone: "Calm", audience: [], approvedLines: [] },
      version: null,
    },
  },
  projects_image_studio_brand_assets_update: {
    id: "p-1",
    body: { remove: "11111111-1111-4111-8111-111111111111" },
  },
  projects_image_studio_brand_look_update: {
    id: "p-1",
    body: { look: null, lookRevision: 0 },
  },
  projects_image_studio_website_research: { id: "p-1" },
  projects_image_studio_website_logo: { id: "p-1" },
  projects_image_studio_products_update: {
    id: "p-1",
    body: { products: [], revision: 0 },
  },
  projects_image_studio_products_import: {
    id: "p-1",
    body: { url: "https://example.com" },
  },
  projects_image_studio_product_photo: {
    id: "p-1",
    body: { name: "Lamp", imageUrl: "https://example.com/lamp.png" },
  },
  projects_image_studio_talking_video_scripts: {
    id: "p-1",
    body: { topic: "Spring sale" },
  },
  projects_image_studio_asset_headline: {
    id: "p-1",
    assetId: "a-1",
    body: { text: "Hello" },
  },
  projects_image_studio_asset_caption: { id: "p-1", assetId: "a-1" },
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
  projects_copy_organization_design: { id: "p-1" },
  projects_needs_attention: { id: "p-1" },
  projects_close_status: { id: "p-1" },
  projects_close: {
    id: "p-1",
    body: {
      operationId: "00000000-0000-4000-8000-00000000c101",
      expectedProjectRevision: 3,
    },
  },
  projects_retry_close: {
    id: "p-1",
    body: {
      operationId: "00000000-0000-4000-8000-00000000c102",
      expectedProjectRevision: 3,
      reason: "Provider was down",
    },
  },
  projects_cancel_owed: {
    id: "p-1",
    body: {
      operationId: "00000000-0000-4000-8000-00000000c103",
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
  projects_restore_competitor: {
    id: "p-1",
    competitorId: "comp-1",
    body: { removal: 1 },
  },
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
  projects_ads_campaign_create: {
    id: "project-1",
    accountId: "account-1",
    body: { name: "Spring", dailyBudget: 5, objective: "OUTCOME_TRAFFIC" },
  },
  projects_ads_campaign_update: {
    id: "project-1",
    accountId: "account-1",
    campaignId: "42",
    body: { status: "PAUSED" },
  },
  projects_ads_campaign_edit: {
    id: "project-1",
    accountId: "account-1",
    campaignId: "42",
    body: {
      name: "Spring",
      dailyBudget: 5,
      google: {
        type: "SEARCH",
        locationIds: [],
        languageIds: [],
        finalUrl: "https://example.com",
        keywords: [{ text: "running shoes", matchType: "BROAD" }],
        headlines: ["One", "Two", "Three"],
        descriptions: ["First description", "Second description"],
      },
    },
  },
  // SOKD-374: SEO
  seo_list_audits: { workspace: "acme", status: "active" },
  seo_create_audit: {
    body: { name: "Acme site", firstPage: { url: "https://example.com/" } },
  },
  seo_audit_workspace: { id: "00000000-0000-4000-8000-0000000000a1" },
  seo_audit_archive: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: { archived: true },
  },
  seo_audit_chat: { id: "00000000-0000-4000-8000-0000000000a1" },
  seo_audit_ask: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: {
      question: "Which page should I fix first?",
      idempotencyKey: "question-1",
    },
  },
  seo_audit_get: { id: "00000000-0000-4000-8000-0000000000a1" },
  seo_audit_add_page: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: { url: "https://example.com/pricing" },
  },
  seo_audit_create_scope: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: {
      name: "Pricing",
      pageIds: ["00000000-0000-4000-8000-0000000000e1"],
    },
  },
  seo_audit_update_scope: {
    id: "00000000-0000-4000-8000-0000000000a1",
    scopeId: "00000000-0000-4000-8000-0000000000c1",
    body: {
      name: "Pricing",
      pageIds: ["00000000-0000-4000-8000-0000000000e1"],
      expectedVersion: 1,
    },
  },
  seo_audit_import_report: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: { taskId: "00000000-0000-4000-8000-0000000000d1", fileId: "file-1" },
  },
  seo_audit_analyze: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: {
      kind: "page_check",
      pageIds: ["00000000-0000-4000-8000-0000000000e1"],
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      idempotencyKey: "analysis-1",
    },
  },
  seo_audit_save_keyword: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: { keyword: "seo audit", countryCode: "US", languageCode: "en" },
  },
  seo_audit_save_competitor: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: { url: "https://rival.example", confirmed: true },
  },
  seo_audit_create_task: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: {
      observationId: "00000000-0000-4000-8000-0000000000f1",
      actionId: "action-1",
      idempotencyKey: "create-task-1",
    },
  },
  seo_audit_create_monitor: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: {
      operationId: "00000000-0000-4000-8000-0000000000f1",
      rule: { expr: "0 9 * * 1", timezone: "UTC" },
      analysis: {
        kind: "page_check",
        pageIds: ["00000000-0000-4000-8000-0000000000e1"],
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop"],
        idempotencyKey: "analysis-1",
      },
    },
  },
  seo_audit_review_action: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: {
      pageId: "00000000-0000-4000-8000-0000000000e1",
      actionId: "action-1",
      kind: "kept",
      baselineObservationId: "00000000-0000-4000-8000-0000000000f1",
      observationId: "00000000-0000-4000-8000-0000000000f1",
    },
  },
  seo_audit_properties: { id: "00000000-0000-4000-8000-0000000000a1" },
  seo_audit_sync_statistics: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: {
      provider: "search_console",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-31",
    },
  },
  seo_audit_record_change: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: {
      pageIds: ["00000000-0000-4000-8000-0000000000e1"],
      occurredAt: "2026-11-01T09:00:00.000Z",
      title: "New title tag",
      idempotencyKey: "change-0001",
    },
  },
  seo_audit_set_brand_terms: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: { terms: ["acme"] },
  },
  seo_audit_brief: { id: "00000000-0000-4000-8000-0000000000a1" },
  seo_audit_save_brief: {
    id: "00000000-0000-4000-8000-0000000000a1",
    body: { expectedRevision: 0 },
  },
  seo_audit_suggest_brief: {
    id: "00000000-0000-4000-8000-0000000000a1",
    pageId: "00000000-0000-4000-8000-0000000000e1",
  },
  seo_audit_console_exports: {
    id: "00000000-0000-4000-8000-0000000000a1",
    taskId: "00000000-0000-4000-8000-0000000000d1",
  },
  seo_audit_import_console_export: {
    id: "00000000-0000-4000-8000-0000000000a1",
    taskId: "00000000-0000-4000-8000-0000000000d1",
    body: {
      kind: "indexing_examples",
      reason: "crawled_not_indexed",
      date: "2026-11-01",
      csv: "URL\nhttps://example.com/",
    },
  },
  seo_project_get: { id: "00000000-0000-4000-8000-0000000000b1" },
  seo_project_add_page: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: { url: "https://example.com/pricing" },
  },
  seo_project_create_scope: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: {
      name: "Pricing",
      pageIds: ["00000000-0000-4000-8000-0000000000e1"],
    },
  },
  seo_project_update_scope: {
    id: "00000000-0000-4000-8000-0000000000b1",
    scopeId: "00000000-0000-4000-8000-0000000000c1",
    body: {
      name: "Pricing",
      pageIds: ["00000000-0000-4000-8000-0000000000e1"],
      expectedVersion: 1,
    },
  },
  seo_project_import_report: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: { taskId: "00000000-0000-4000-8000-0000000000d1", fileId: "file-1" },
  },
  seo_project_analyze: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: {
      kind: "page_check",
      pageIds: ["00000000-0000-4000-8000-0000000000e1"],
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      idempotencyKey: "analysis-1",
    },
  },
  seo_project_save_keyword: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: { keyword: "seo audit", countryCode: "US", languageCode: "en" },
  },
  seo_project_save_competitor: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: { url: "https://rival.example", confirmed: true },
  },
  seo_project_create_task: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: {
      observationId: "00000000-0000-4000-8000-0000000000f1",
      actionId: "action-1",
      idempotencyKey: "create-task-1",
    },
  },
  seo_project_create_monitor: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: {
      operationId: "00000000-0000-4000-8000-0000000000f1",
      rule: { expr: "0 9 * * 1", timezone: "UTC" },
      analysis: {
        kind: "page_check",
        pageIds: ["00000000-0000-4000-8000-0000000000e1"],
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop"],
        idempotencyKey: "analysis-1",
      },
    },
  },
  seo_project_review_action: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: {
      pageId: "00000000-0000-4000-8000-0000000000e1",
      actionId: "action-1",
      kind: "kept",
      baselineObservationId: "00000000-0000-4000-8000-0000000000f1",
      observationId: "00000000-0000-4000-8000-0000000000f1",
    },
  },
  seo_project_properties: { id: "00000000-0000-4000-8000-0000000000b1" },
  seo_project_sync_statistics: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: {
      provider: "search_console",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-31",
    },
  },
  seo_project_record_change: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: {
      pageIds: ["00000000-0000-4000-8000-0000000000e1"],
      occurredAt: "2026-11-01T09:00:00.000Z",
      title: "New title tag",
      idempotencyKey: "change-0001",
    },
  },
  seo_project_set_brand_terms: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: { terms: ["acme"] },
  },
  seo_project_brief: { id: "00000000-0000-4000-8000-0000000000b1" },
  seo_project_save_brief: {
    id: "00000000-0000-4000-8000-0000000000b1",
    body: { expectedRevision: 0 },
  },
  seo_project_suggest_brief: {
    id: "00000000-0000-4000-8000-0000000000b1",
    pageId: "00000000-0000-4000-8000-0000000000e1",
  },
  seo_project_console_exports: {
    id: "00000000-0000-4000-8000-0000000000b1",
    taskId: "00000000-0000-4000-8000-0000000000d1",
  },
  seo_project_import_console_export: {
    id: "00000000-0000-4000-8000-0000000000b1",
    taskId: "00000000-0000-4000-8000-0000000000d1",
    body: {
      kind: "indexing_examples",
      reason: "crawled_not_indexed",
      date: "2026-11-01",
      csv: "URL\nhttps://example.com/",
    },
  },
  // SOKD-375: Drive
  drive_search: { scope: "me", q: "pricing", limit: 10 },
  drive_files: { scope: "org", organizationId: "org-1", folder: "reports" },
  drive_recents: { scope: "me" },
  drive_get: { id: "file-1", scope: "me" },
  drive_related: { id: "file-1", scope: "me" },
  drive_folders: { scope: "me" },
  drive_create_folder: { body: { scope: "me", folderPath: "reports/2026" } },
  drive_rename_folder: {
    body: {
      scope: "me",
      oldFolderPath: "reports",
      newFolderPath: "archive/reports",
    },
  },
  drive_delete_folder: { body: { scope: "me", folderPath: "drafts" } },
  drive_move: {
    body: {
      scope: "me",
      sourcePathname: "notes.pdf",
      targetFolderPath: "reports",
      itemType: "file",
    },
  },
  drive_rename: {
    body: { oldPathname: "users/u/notes.pdf", newFilename: "minutes.pdf" },
  },
  drive_delete: { body: { pathname: "users/u/notes.pdf" } },
  drive_update_metadata: {
    id: "file-1",
    scope: "me",
    body: { expectedMetadataRevision: 3, addTagLabelIds: ["label-1"] },
  },
  drive_decide_suggestion: {
    id: "file-1",
    suggestionId: "suggestion-1",
    scope: "me",
    body: { decision: "accept", expectedMetadataRevision: 3 },
  },
  drive_select: { body: { scope: "me", windowCursor: "cursor-1" } },
  drive_update_metadata_batch: {
    body: {
      scope: "me",
      selectionToken: "token-1",
      idempotencyKey: "tag-contracts-1",
      addTagLabelIds: ["label-1"],
    },
  },
  drive_reindex: { id: "file-1", scope: "me" },
  drive_add_google_sheet: {
    body: {
      scope: "me",
      url: "https://docs.google.com/spreadsheets/d/abc/edit",
    },
  },
  drive_google_sheet: { id: "file-1", scope: "me" },
  drive_refresh_google_sheet: { id: "file-1", scope: "me" },
  drive_tasks: { scope: "me", taskId: "task-1" },
  drive_copy_task_file: { body: { scope: "me", taskFileId: "task-file-1" } },
  drive_labels: { scope: "me", kind: "TAG" },
  drive_create_label: {
    body: { scope: "me", kind: "TAG", displayName: "Contracts" },
  },
  drive_update_label: {
    id: "label-1",
    body: { scope: "me", displayName: "Signed contracts" },
  },
  drive_collections: { scope: "me" },
  drive_create_collection: {
    body: { scope: "me", name: "Contracts", definition: { q: "contract" } },
  },
  drive_update_collection: {
    id: "collection-1",
    body: { scope: "me", name: "Signed contracts" },
  },
  drive_delete_collection: { id: "collection-1", scope: "me" },
  drive_share: { scope: "me", resourceId: "file-1" },
  drive_unshare: { id: "share-1", scope: "me" },
  drive_tables: { workspace: "acme", search: "leads" },
  drive_create_table: {
    workspace: "acme",
    body: {
      key: "create-leads-1",
      title: "Leads",
      columns: [{ name: "Company", type: "text" }],
    },
  },
  drive_table: { id: "table-1" },
  drive_update_table: {
    id: "table-1",
    body: { key: "rename-1", version: 2, title: "Qualified leads" },
  },
  drive_query_table: { id: "table-1", body: { limit: 50 } },
  drive_edit_rows: {
    id: "table-1",
    body: { key: "rows-1", insert: [{ cells: {} }] },
  },
  drive_save_view: {
    id: "table-1",
    body: { key: "view-1", name: "Open", definition: {} },
  },
  drive_undo_table: {
    id: "table-1",
    body: { key: "undo-1", batchId: "batch-1" },
  },
  drive_table_history: { id: "table-1", limit: 20 },
  drive_enrich_table: {
    id: "table-1",
    body: {
      key: "enrich-1",
      prompt: "Find each company's website",
      rowIds: ["row-1"],
      columnIds: ["column-1"],
      assigneeId: "cw-1",
    },
  },
  drive_data_rooms: { scope: "org", organizationId: "org-1" },
  drive_create_data_room: { body: { scope: "me", folderPath: "deal" } },
  drive_open_questions: { scope: "me" },
  drive_data_room: { id: "room-1", scope: "me" },
  drive_close_data_room: { id: "room-1", scope: "me" },
  drive_remove_data_room_member: {
    id: "room-1",
    memberId: "member-1",
    scope: "me",
  },
  drive_data_room_events: { id: "room-1", scope: "me" },
  drive_data_room_questions: { id: "room-1", scope: "me" },
  drive_order_data_room: { id: "room-1", body: { scope: "me", entries: [] } },
  drive_set_data_room_colleagues: {
    id: "room-1",
    body: { scope: "org", organizationId: "org-1", userIds: ["user-2"] },
  },
  // SOKD-376: contacts and contact lists.
  contacts_list: { workspace: "acme", stage: "PROSPECT", limit: 20 },
  contacts_create: {
    body: {
      name: "Nina Keller",
      channels: [{ type: "EMAIL", value: "nina@example.com" }],
    },
  },
  contacts_map: { search: "berlin" },
  contacts_merge: { body: { winnerId: CONTACT, loserIds: [OTHER] } },
  contacts_list_duplicates: { limit: 10 },
  contacts_dismiss_duplicates: { body: { contactIds: [CONTACT, OTHER] } },
  contacts_set_stage: { body: { contactIds: [CONTACT], stage: "PROSPECT" } },
  contacts_undo_stage: {
    body: { contacts: [{ id: CONTACT, stage: "LEAD", version: 2 }] },
  },
  contacts_list_organizations: {},
  contacts_list_companies: { industry: "Software" },
  contacts_get_company: { companyId: COMPANY },
  contacts_update_company: { companyId: COMPANY, body: { version: 1 } },
  contacts_list_company_lists: {},
  contacts_create_company_list: { body: { name: "Targets" } },
  contacts_update_company_list: { listId: LIST, body: { name: "Q1 targets" } },
  contacts_delete_company_list: { listId: LIST },
  contacts_update_company_list_members: {
    listId: LIST,
    body: { add: [COMPANY] },
  },
  contacts_breakdown: { by: "stage" },
  contacts_get: { id: CONTACT },
  contacts_update: { id: CONTACT, body: { version: 1, role: "Founder" } },
  contacts_archive: { id: CONTACT },
  contacts_unarchive: { id: CONTACT },
  contacts_add_channel: {
    id: CONTACT,
    body: { type: "EMAIL", value: "nina@example.com" },
  },
  contacts_remove_channel: { id: CONTACT, channelId: OTHER },
  contacts_list_interactions: { id: CONTACT, limit: 20 },
  contacts_add_interaction: {
    id: CONTACT,
    body: {
      occurredAt: "2026-11-24T10:00:00Z",
      channel: "EMAIL",
      summary: "Intro call booked",
    },
  },
  contacts_delete_interaction: { id: CONTACT, interactionId: OTHER },
  contacts_set_importance: { id: CONTACT, body: { importance: 80 } },
  contacts_set_user: { id: CONTACT, body: { userId: null } },
  contacts_enrich: { id: CONTACT },
  contacts_activity: { id: CONTACT },
  contacts_list_lists: {},
  contacts_create_list: { body: { name: "Investors" } },
  contacts_update_list: { id: LIST, body: { color: "blue" } },
  contacts_delete_list: { id: LIST },
  contacts_update_list_members: { id: LIST, body: { remove: [CONTACT] } },
  contacts_list_suggestions: { id: LIST },
  contacts_find_people: {
    id: LIST,
    body: { brief: "Seed investors in Berlin" },
  },
  contacts_add_suggestions: { id: LIST, body: { ids: [OTHER] } },
  contacts_dismiss_suggestions: { id: LIST, body: { ids: [OTHER] } },
  // SOKD-377 chats
  chats_invitations: {},
  chats_get_invitation: { id: "inv-1" },
  chats_accept_invitation: { id: "inv-1" },
  chats_decline_invitation: { id: "inv-1" },
  chats_people: { limit: 20 },
  chats_rooms: { workspace: "acme", kind: "channel" },
  chats_create_room: {
    workspace: "acme",
    body: { kind: "channel", name: "launch", discoverability: "public" },
  },
  chats_discoverable: { workspace: "acme", q: "launch" },
  chats_slug_available: { workspace: "acme", slug: "launch" },
  chats_order_starred: { body: { roomIds: ["room-1"] } },
  chats_pinned: { id: "room-1" },
  chats_get_room: { id: "room-1" },
  chats_update_room: { id: "room-1", body: { topic: "Launch week" } },
  chats_archive_room: { id: "room-1" },
  chats_restore_room: { id: "room-1" },
  chats_room_invitations: { id: "room-1" },
  chats_revoke_invitation: { id: "room-1", invitationId: "inv-1" },
  chats_join: { workspace: "acme", id: "room-1" },
  chats_leave: { id: "room-1" },
  chats_remove_member: { id: "room-1", userId: "user-2" },
  chats_add_members: { id: "room-1", body: { coworkerIds: ["cw-1"] } },
  chats_remove_coworker: { id: "room-1", coworkerId: "cw-1" },
  chats_remove_soko_bot: { id: "room-1", sokoBotId: "bot-1" },
  chats_mark_read: { id: "room-1" },
  chats_mark_unread: { id: "room-1" },
  chats_star: { id: "room-1" },
  chats_unstar: { id: "room-1" },
  chats_mute: { id: "room-1" },
  chats_unmute: { id: "room-1" },
  chats_threads: { id: "room-1", unread: "true" },
  chats_thread_unread_count: { id: "room-1" },
  chats_read_threads: { id: "room-1" },
  chats_get_thread: { id: "room-1", parentMessageId: "msg-1" },
  chats_thread_messages: { id: "room-1", parentMessageId: "msg-1", limit: 20 },
  chats_read_thread: { id: "room-1", parentMessageId: "msg-1" },
  chats_mute_thread: { id: "room-1", parentMessageId: "msg-1" },
  chats_unmute_thread: { id: "room-1", parentMessageId: "msg-1" },
  chats_unread_threads: { limit: 20 },
  chats_earlier_threads: { limit: 20 },
  chats_messages: { id: "room-1", limit: 20 },
  chats_send: { id: "room-1", body: { content: "Draft is ready." } },
  chats_get_message: { id: "room-1", messageId: "msg-1" },
  chats_edit_message: {
    id: "room-1",
    messageId: "msg-1",
    body: { content: "Draft is ready now." },
  },
  chats_delete_message: { id: "room-1", messageId: "msg-1" },
  chats_get_message_results: { id: "room-1", messageId: "msg-1" },
  chats_message_results: {
    id: "room-1",
    messageIds: "00000000-0000-4000-8000-000000000002",
  },
  chats_react: { id: "room-1", messageId: "msg-1", emoji: "👍" },
  chats_unreact: { id: "room-1", messageId: "msg-1", emoji: "👍" },
  chats_pin: { id: "room-1", messageId: "msg-1" },
  chats_unpin: { id: "room-1", messageId: "msg-1" },
  chats_send_to_self: { id: "room-1", messageId: "msg-1" },
  chats_remove_unfurl: {
    id: "room-1",
    messageId: "msg-1",
    body: { url: "https://example.com" },
  },
  chats_retry_mention: {
    id: "room-1",
    messageId: "msg-1",
    mentionId: "mention-1",
  },
  chats_saved: {},
  chats_save: { messageId: "msg-1" },
  chats_unsave: { messageId: "msg-1" },
  chats_decisions: { limit: 20 },
  chats_important: {},
  chats_summary: { roomId: "room-1" },
  chats_catch_up: { id: "room-1" },
  chats_room_decisions: { id: "room-1" },
  chats_correct_signal: {
    messageId: "msg-1",
    body: { tag: "decisionMade", applies: false },
  },
  chats_set_loop: {
    messageId: "msg-1",
    body: { closed: true, taskId: "task-1" },
  },
  chats_routing: { messageId: "msg-1" },
  chats_skills: { q: "seo" },
  chats_stickers: {},
  // SOKD-377 soko-bots
  soko_bots_me: {},
  soko_bots_create_mine: {
    body: { name: "Pebble", timezone: "Europe/Berlin" },
  },
  soko_bots_archive_mine: {},
  soko_bots_my_activity: {},
  soko_bots_my_usage: {},
  soko_bots_my_stats: {},
  soko_bots_my_turns: { limit: 10 },
  soko_bots_ask_mine: {
    body: { clientTurnId: "mcp-1", message: "What is due this week?" },
  },
  soko_bots_my_turn: { turnId: "turn-1" },
  soko_bots_my_turn_results: { turnId: "turn-1" },
  soko_bots_my_turn_conversation: { id: "turn-1" },
  soko_bots_cancel_my_turn: { turnId: "turn-1" },
  soko_bots_rate_my_turn: { id: "turn-1", body: { useful: true } },
  soko_bots_reset_my_memory: {},
  soko_bots_create_my_schedule: {
    body: {
      name: "Standup",
      prompt: "Summarize yesterday",
      cronExpression: "0 9 * * 1-5",
      timezone: "Europe/Berlin",
    },
  },
  soko_bots_update_my_schedule: {
    scheduleId: "schedule-1",
    body: { enabled: false },
  },
  soko_bots_delete_my_schedule: { scheduleId: "schedule-1" },
  soko_bots_introduce_mine: { body: { roomId: "room-1" } },
  soko_bots_rename_mine: { body: { name: "Pebble" } },
  soko_bots_set_my_avatar: { body: { code: "ab12" } },
  soko_bots_set_my_version: { body: { versionId: "version-1" } },
  soko_bots_set_my_proactive: { body: { paused: true } },
  soko_bots_set_my_board_following: { body: { enabled: false } },
  soko_bots_set_my_team_standup: { body: { enabled: false } },
  soko_bots_my_skills: {},
  soko_bots_my_integrations: {},
  soko_bots_integrations: { sokoBotId: "bot-1" },
  soko_bots_integration_catalog: { query: "gmail" },
  soko_bots_remove_my_skill: { skillId: "skill-1" },
  soko_bots_lab_ingest: { body: { beat: "standup" } },
  soko_bots_lab_task_event: { body: { status: "COMPLETED", comment: "Done" } },
  soko_bots_lab_runs: { limit: 10 },
  soko_bots_lab_judge: { body: { turnId: "turn-1", scenarioId: "standup" } },
  soko_bots_versions: {},
  soko_bots_team: { workspace: "acme" },
  soko_bots_search_skills: { q: "seo" },
  soko_bots_browse_skills: { page: 1 },
  soko_bots_create: {
    workspace: "acme",
    body: { scope: "workspace", name: "Ops" },
  },
  soko_bots_get: { sokoBotId: "bot-1" },
  soko_bots_reactivate: { sokoBotId: "bot-1" },
  soko_bots_archive: { sokoBotId: "bot-1" },
  soko_bots_activity: { sokoBotId: "bot-1" },
  soko_bots_usage: { sokoBotId: "bot-1" },
  soko_bots_stats: { sokoBotId: "bot-1" },
  soko_bots_turns: { sokoBotId: "bot-1", limit: 10 },
  soko_bots_ask: {
    sokoBotId: "bot-1",
    body: { clientTurnId: "mcp-1", message: "What is due this week?" },
  },
  soko_bots_turn: { sokoBotId: "bot-1", turnId: "turn-1" },
  soko_bots_turn_results: { sokoBotId: "bot-1", turnId: "turn-1" },
  soko_bots_cancel_turn: { sokoBotId: "bot-1", turnId: "turn-1" },
  soko_bots_reset_memory: { sokoBotId: "bot-1" },
  soko_bots_create_schedule: {
    sokoBotId: "bot-1",
    body: {
      name: "Standup",
      prompt: "Summarize yesterday",
      cronExpression: "0 9 * * 1-5",
      timezone: "Europe/Berlin",
    },
  },
  soko_bots_update_schedule: {
    sokoBotId: "bot-1",
    scheduleId: "schedule-1",
    body: { enabled: false },
  },
  soko_bots_delete_schedule: { sokoBotId: "bot-1", scheduleId: "schedule-1" },
  soko_bots_rename: { sokoBotId: "bot-1", body: { name: "Ops" } },
  soko_bots_set_avatar: { sokoBotId: "bot-1", body: { code: "ab12" } },
  soko_bots_set_version: {
    sokoBotId: "bot-1",
    body: { versionId: "version-1" },
  },
  soko_bots_set_proactive: { sokoBotId: "bot-1", body: { paused: true } },
  soko_bots_set_board_following: {
    sokoBotId: "bot-1",
    body: { enabled: false },
  },
  soko_bots_set_team_standup: { sokoBotId: "bot-1", body: { enabled: false } },
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
