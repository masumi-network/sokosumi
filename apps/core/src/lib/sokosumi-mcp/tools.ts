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
  /** Acts on a service outside Sokosumi (Google, Meta). Annotated open-world. */
  openWorld?: boolean;
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
  // SOKD-369: schedules, files, follow, participants, workspace, summary, due dates.
  {
    name: "tasks_summary",
    operation: "GET /tasks/summary",
    description:
      "Count a workspace's Tasks over the last 24 hours, with the 24 hours before for a trend. `scope`: `owned` (default) or `workspace`.",
  },
  {
    name: "tasks_view",
    operation: "GET /tasks/view",
    description:
      "Get the Tasks page view the signed-in user last chose in a workspace, as a query string.",
  },
  {
    name: "tasks_set_view",
    operation: "PUT /tasks/view",
    description:
      "Save the Tasks page view the signed-in user sees next in a workspace: `body.query`, a URL query string without `?`.",
    destructive: true,
  },
  {
    name: "tasks_move_overdue",
    operation: "POST /tasks/due-dates/move-overdue",
    description:
      "Move the signed-in user's overdue open Tasks to a new due day: `body.today` and `body.to` (YYYY-MM-DD). At most 100. Keep the returned moves to undo with tasks_undo_move_overdue.",
    destructive: true,
  },
  {
    name: "tasks_undo_move_overdue",
    operation: "POST /tasks/due-dates/undo",
    description:
      "Undo tasks_move_overdue: `body.to` and `body.tasks` (`id`, `from`, `version`) from its result. A Task changed since keeps its day.",
    destructive: true,
  },
  {
    name: "tasks_list_schedules",
    operation: "GET /tasks/schedules",
    description:
      "List a workspace's Task Schedules, the repeating rules that create Tasks. Filter by `state`, `projectId` or `q`; pass `cursor` for the next page.",
  },
  {
    name: "tasks_create_schedule",
    operation: "POST /tasks/schedules",
    description:
      "Spends workspace credits. Each Run creates a Task that may start a paid Coworker or audit, with no approval at the Run. Create a Task Schedule: `body.name`, `body.rule.expr` (five-field cron, read in `body.rule.timezone`) and the blueprint of each Task, such as `body.description` and `body.assigneeId` from tasks_schedule_assignees. Confirm the rule and assignee with the person first.",
    spendsCredits: true,
  },
  {
    name: "tasks_schedule_assignees",
    operation: "GET /tasks/schedules/assignees",
    description:
      "List the Coworkers and Soko Bot a Task Schedule in a workspace can assign its Tasks to.",
  },
  {
    name: "tasks_get_schedule",
    operation: "GET /tasks/schedules/{id}",
    description:
      "Get a Task Schedule with its rule, blueprint, state, next Run and `revision`.",
  },
  {
    name: "tasks_update_schedule",
    operation: "PATCH /tasks/schedules/{id}",
    description:
      "Change a Task Schedule's name, blueprint or rule. `body.expectedRevision` from tasks_get_schedule; `body.rule` replaces the whole rule. Future Runs only.",
    destructive: true,
  },
  {
    name: "tasks_delete_schedule",
    operation: "DELETE /tasks/schedules/{id}",
    description:
      "Delete a Task Schedule. The Tasks it created stay. Use tasks_end_schedule to stop it and keep it readable.",
  },
  {
    name: "tasks_pause_schedule",
    operation: "POST /tasks/schedules/{id}/pause",
    description:
      "Pause an active Task Schedule. No Run creates a Task while it is paused.",
  },
  {
    name: "tasks_resume_schedule",
    operation: "POST /tasks/schedules/{id}/resume",
    description:
      "Spends workspace credits. Each Run creates a Task that may start a paid Coworker or audit, with no approval at the Run. Resume a paused Task Schedule from its next Run after now; it ends instead when its end rule passed. Confirm with the person first.",
    spendsCredits: true,
  },
  {
    name: "tasks_end_schedule",
    operation: "POST /tasks/schedules/{id}/end",
    description:
      "End a Task Schedule for good. It stays readable with the Tasks it created.",
  },
  {
    name: "tasks_schedule_runs",
    operation: "GET /tasks/schedules/{id}/runs",
    description:
      "List a Task Schedule's Runs in time order: past ones with their Tasks, skipped and moved ones, and planned ones. Filter by `from` and `to`; pass `cursor` for the next page.",
  },
  {
    name: "tasks_run_schedule",
    operation: "POST /tasks/schedules/{id}/runs",
    description:
      "Spends workspace credits. Run a Task Schedule now: create one extra Task at once, which may start a paid Coworker or audit. `body.expectedRevision` from tasks_get_schedule. Confirm with the person first.",
    spendsCredits: true,
  },
  {
    name: "tasks_update_schedule_run",
    operation: "PATCH /tasks/schedules/{id}/runs/{runId}",
    description:
      "Skip, move or restore one planned Run: `body.action` (`skip`, `move` with `body.scheduledAt`, `restore`) and `body.expectedRevision`. The rule stays.",
    destructive: true,
  },
  {
    name: "tasks_update_link",
    operation: "PATCH /tasks/{id}/links/{linkId}",
    description:
      "Change a link's `body.relation` or `body.note`. `linkId` from tasks_links. Use tasks_move for parent and sub-task.",
    destructive: true,
  },
  {
    name: "tasks_join",
    operation: "POST /tasks/{id}/participants",
    description:
      "Join a Task as a participant: the signed-in user gets its notifications.",
  },
  {
    name: "tasks_leave",
    operation: "DELETE /tasks/{id}/participants/{userId}",
    description:
      "Leave a Task as a participant. `userId` is the signed-in user's id from users_get.",
    destructive: false,
  },
  {
    name: "tasks_follow",
    operation: "POST /tasks/{id}/follow",
    description:
      "Follow a Task with the signed-in user's personal Soko Bot, which reports its moments to them. Needs a Soko Bot in the Task's workspace.",
  },
  {
    name: "tasks_unfollow",
    operation: "DELETE /tasks/{id}/follow",
    description: "Stop following a Task with the signed-in user's Soko Bot.",
    destructive: false,
  },
  {
    name: "tasks_send_to_chat",
    operation: "POST /tasks/{id}/chat-messages",
    description:
      "Post a link to a Task, with an optional `body.note`, into a chat room the signed-in user belongs to: `body.roomId` and a unique `body.clientMessageId`. It mentions no one and starts no agent.",
  },
  {
    name: "tasks_workspace",
    operation: "GET /tasks/{id}/workspace",
    description:
      "Find which workspace a Task is in, across the workspaces the signed-in user can open.",
  },
  {
    name: "tasks_set_workspace",
    operation: "PUT /tasks/{id}/workspace",
    description:
      "Move a Task to another workspace: `body.organizationId`, or null for the personal workspace. Only its owner may move it.",
    destructive: true,
  },
  {
    name: "tasks_restore",
    operation: "POST /tasks/{id}/restore",
    description:
      "Restore an archived Task. A Task that was waiting to run comes back as a Draft, so nothing runs until someone starts it.",
  },
  {
    name: "tasks_files",
    operation: "GET /tasks/{id}/files",
    description: "List the files uploaded to a Task, newest first.",
  },
  {
    name: "tasks_upload_url",
    operation: "POST /tasks/{id}/files",
    description:
      "Get an upload URL for a Task file: `body.filename`, `body.contentType` and `body.size` in bytes (at most 100 MB). PUT the bytes to `uploadUrl` with the returned headers; the file then shows in tasks_files.",
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
    name: "jobs_update",
    operation: "PATCH /jobs/{id}",
    description: "Rename a Job: `body.name`, or null to clear the custom name.",
    destructive: true,
  },
  {
    name: "jobs_move",
    operation: "PUT /jobs/{id}/workspace",
    description:
      "Move a Job to another workspace: `body.organizationId`, or null for your personal workspace. People in the old workspace lose access. Only the Job's owner may move it; an organization owner or admin moves one without an owner.",
    destructive: true,
  },
  {
    name: "jobs_unshare",
    operation: "DELETE /jobs/{id}/share",
    description:
      "Turn off a Job's public share link. Anyone holding the link loses access.",
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
    name: "agents_get",
    operation: "GET /agents/{id}",
    description:
      "Get an agent with its description, price in credits, categories and ratings.",
  },
  {
    name: "agents_jobs",
    operation: "GET /agents/{id}/jobs",
    description:
      "List your Jobs with one agent, newest first. Pass `scope` `workspace` for everyone's in the workspace, and `cursor` for the next page.",
  },
  {
    name: "agents_reviews",
    operation: "GET /agents/{id}/reviews",
    description:
      "Get an agent's rating summary and its latest commented reviews. `limit` caps the reviews.",
  },
  {
    name: "agents_my_review",
    operation: "GET /agents/{id}/reviews/me",
    description: "Get your own rating and review of an agent, if any.",
  },
  {
    name: "agents_rating_eligibility",
    operation: "GET /agents/{id}/ratings/eligibility",
    description:
      "Check whether you may rate an agent: you need a finished Job with it.",
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
  // SOKD-378: ads, image-studio, social and calendar reads.
  {
    name: "image_studio_catalog",
    operation: "GET /image-studio/catalog",
    description:
      "List the Image Studio's image, video and talking-video models: what each can do and its credit price. The same for every Project.",
  },
  {
    name: "image_studio_state",
    operation: "GET /image-studio/state",
    description:
      "Get Image Studio results across every Project in the workspace: versions and recent generation jobs, newest first, each with its Project.",
  },
  {
    name: "image_studio_recent_projects",
    operation: "GET /image-studio/recent-projects",
    description:
      "List the three Projects with the newest Image Studio images, each with its image count and newest image.",
  },
  {
    name: "projects_ads_accounts",
    operation: "GET /projects/{id}/ads/accounts",
    description:
      "List the Google Ads and Meta ad accounts attached to a Project.",
  },
  {
    name: "projects_ads_campaigns",
    operation: "GET /projects/{id}/ads/accounts/{accountId}/campaigns",
    description:
      "List an ad account's campaigns with spend, impressions, clicks, CTR, CPC and conversions over `range`. Money is in the account currency.",
  },
  {
    name: "projects_ads_campaign",
    operation:
      "GET /projects/{id}/ads/accounts/{accountId}/campaigns/{campaignId}",
    description:
      "Get one Google campaign: settings, targeting, keywords, ad, sitelinks, and daily performance over `range`. Google Ads accounts only.",
  },
  {
    name: "projects_ads_locations",
    operation:
      "GET /projects/{id}/ads/accounts/{accountId}/targeting/locations",
    description:
      "Search the Google Ads locations a campaign can target, by name (`q`) or by geo target ids (`ids`); send exactly one.",
  },
  {
    name: "projects_ads_languages",
    operation:
      "GET /projects/{id}/ads/accounts/{accountId}/targeting/languages",
    description:
      "List the languages a Google campaign of this ad account can target.",
  },
  {
    name: "projects_ads_market",
    operation: "GET /projects/{id}/ads/market",
    description:
      "Get a Project's ads market profile: keywords, country and language. `profile` is null until a person saves one.",
  },
  {
    name: "projects_image_studio",
    operation: "GET /projects/{id}/image-studio",
    description:
      "Get a Project's Image Studio: versions, recent generation jobs and their assets, and the Studio conversations of this Project.",
  },
  {
    name: "projects_image_studio_batch",
    operation: "GET /projects/{id}/image-studio/batches/{batchId}/assets",
    description: "List the images one Image Studio generation batch produced.",
  },
  {
    name: "projects_image_studio_compare",
    operation: "GET /projects/{id}/image-studio/batches/{batchId}/compare",
    description:
      "Get the next pair of images from a batch that the signed-in person has not compared yet; `pair` is null when none is left.",
  },
  {
    name: "projects_image_studio_scoreboard",
    operation: "GET /projects/{id}/image-studio/model-scoreboard",
    description:
      "Rank image models for a Project by the workspace members' side-by-side picks. Under ten comparisons is provisional.",
  },
  {
    name: "projects_image_studio_brand_kit",
    operation: "GET /projects/{id}/image-studio/brand-kit",
    description:
      "Get a Project's brand kit: logo, colors, fonts, summary, tone, audience and approved lines.",
  },
  {
    name: "projects_image_studio_website_copy",
    operation: "GET /projects/{id}/image-studio/brand-kit/website-copy",
    description:
      "Read a summary and candidate lines from the Project's website, for its brand kit. Fetches the website.",
  },
  {
    name: "projects_image_studio_website_draft",
    operation: "GET /projects/{id}/image-studio/website-draft",
    description:
      "Draft a brand kit and product list from the Project's website. Fetches the website; saves nothing.",
  },
  {
    name: "projects_image_studio_products",
    operation: "GET /projects/{id}/image-studio/products",
    description: "List a Project's product catalog in the Image Studio.",
  },
  {
    name: "projects_image_studio_talking_videos",
    operation: "GET /projects/{id}/image-studio/talking-videos",
    description:
      "List a Project's talking videos, newest first. Pass the oldest job's createdAt as `before` and its id as `beforeId` for the next 30.",
  },
  {
    name: "projects_social_connections",
    operation: "GET /projects/{id}/social-connections",
    description:
      "List a Project's connected social accounts (provider, name, avatar, status). Connecting and disconnecting stay with a person.",
  },
  {
    name: "projects_social_connection_subscription",
    operation:
      "GET /projects/{id}/social-connections/{connectionId}/subscription",
    description:
      "Get an X account's subscription tier and post length limit, refreshed from X when it answers.",
  },
  {
    name: "projects_social_connection_tiktok_creator",
    operation:
      "GET /projects/{id}/social-connections/{connectionId}/tiktok-creator",
    description:
      "Get a connected TikTok creator's current posting options: privacy levels and whether comments, duets and stitches are allowed.",
  },
  {
    name: "projects_social_connection_suggested_times",
    operation:
      "GET /projects/{id}/social-connections/{connectionId}/suggested-times",
    description:
      "Suggest two or three posting hours for an account from its measured history, in the IANA `timezone` given. Empty without enough history.",
  },
  {
    name: "projects_social_statistics",
    operation: "GET /projects/{id}/social-connections/statistics",
    description:
      "Read a Project's cached social account metrics and published posts, including posts made outside Sokosumi. Does not refresh from the providers.",
  },
  {
    name: "projects_social_posts",
    operation: "GET /projects/{id}/social-posts",
    description:
      "List a Project's Social posts with their status, text, media and schedule. Filter with `status`, `provider` or `search`.",
  },
  {
    name: "projects_social_post",
    operation: "GET /projects/{id}/social-posts/{postId}",
    description: "Get one Social post of a Project.",
  },
  {
    name: "projects_social_posts_statistics",
    operation: "GET /projects/{id}/social-posts/statistics",
    description:
      "Read cached lifetime statistics of a Project's published Social posts, filtered by publication date.",
  },
  {
    name: "projects_social_queue_slots",
    operation: "GET /projects/{id}/social-queue-slots",
    description: "List a Project's weekly posting-queue times.",
  },
  {
    name: "projects_calendar",
    operation: "GET /projects/{id}/calendar",
    description:
      "List a Project's Calendar between `from` and `to`: scheduled and queued Tasks, plus the `types` asked for (social, newsletter, contacts, marketing, sokoBot).",
  },
  {
    name: "workspaces_calendar",
    operation: "GET /workspaces/calendar",
    description:
      "List the workspace Calendar between `from` and `to`: scheduled and queued Tasks, plus the `types` asked for (social, newsletter, contacts, marketing, sokoBot).",
  },
  {
    name: "workspaces_calendar_sources",
    operation: "GET /workspaces/calendar/sources",
    description:
      "List the workspace's Calendar sources (the workspace and each Project) and the `types` this caller may ask the Calendar for.",
  },
  {
    name: "workspaces_social_posts",
    operation: "GET /workspaces/social-posts",
    description:
      "List the Social posts of every Project in the workspace, each with its Project's name. Filter with `status`.",
  },
  {
    name: "workspaces_social_statistics",
    operation: "GET /workspaces/{id}/social-connections/statistics",
    description:
      "Read cached metrics and published posts for every connected social account in the workspace. `id` must be the id of the workspace this call acts in (from workspaces_list).",
  },
  // SOKD-371: users, organizations and workspaces. `/users/{id}` tools take
  // id `me`: an MCP caller is never an admin, so another id answers 403.
  {
    name: "users_update",
    operation: "PATCH /users/{id}",
    description:
      "Change the signed-in user's first and last name. Pass id `me` and `body.firstName`, `body.lastName`.",
    destructive: true,
  },
  {
    name: "workspaces_credits",
    operation: "GET /users/{id}/credits",
    description:
      "Get the credit balance of a workspace: the personal one, or the organization named by `workspace`. Pass id `me`. Check it before agents_hire.",
  },
  {
    name: "users_set_design_md",
    operation: "PUT /users/{id}/design-md",
    description:
      "Replace the signed-in user's DESIGN.md, the brand guide agents follow in the personal workspace. Pass id `me`, `body.content` (Markdown, or null to clear) and `body.extractionId` (null when unknown).",
    destructive: true,
  },
  {
    name: "users_preferences",
    operation: "GET /users/{id}/preferences",
    description:
      "Get the signed-in user's preferences: marketing and push opt-in, unread counts and notification settings. Pass id `me`.",
  },
  {
    name: "users_update_preferences",
    operation: "PATCH /users/{id}/preferences",
    description:
      "Change the signed-in user's preferences. Pass id `me`; only the fields in `body` change.",
    destructive: true,
  },
  {
    name: "users_files",
    operation: "GET /users/{id}/files",
    description: "List the files the signed-in user uploaded. Pass id `me`.",
  },
  {
    name: "users_coworker_access",
    operation: "GET /users/{id}/coworker-access",
    description:
      "List the Coworkers that have or ask for access to the personal workspace, with their status. Pass id `me`. A person approves requests in Sokosumi.",
  },
  {
    name: "users_deny_coworker_access",
    operation: "POST /users/{id}/coworker-access/{accessId}/deny",
    description:
      "Deny a Coworker's pending request for the personal workspace. Pass id `me` and `accessId` from users_coworker_access.",
  },
  {
    name: "users_revoke_coworker_access",
    operation: "POST /users/{id}/coworker-access/{accessId}/revoke",
    description:
      "Revoke a Coworker's access to the personal workspace. Pass id `me` and `accessId` from users_coworker_access.",
    destructive: true,
  },
  {
    name: "users_vendor_grants",
    operation: "GET /users/{id}/vendor-grants",
    description:
      "List the vendors granted or asking for access to the personal workspace. Pass id `me`; filter by `status` or `vendorId`. A person approves grants in Sokosumi.",
  },
  {
    name: "users_deny_vendor_grant",
    operation: "POST /users/{id}/vendor-grants/{grantId}/deny",
    description:
      "Deny a vendor's pending grant for the personal workspace. Its Tasks waiting on the grant are cancelled. Pass id `me` and `grantId` from users_vendor_grants.",
    destructive: true,
  },
  {
    name: "users_revoke_vendor_grant",
    operation: "POST /users/{id}/vendor-grants/{grantId}/revoke",
    description:
      "Revoke a vendor's grant for the personal workspace. Its Tasks waiting on the grant are cancelled. Pass id `me` and `grantId` from users_vendor_grants.",
    destructive: true,
  },
  {
    name: "users_preferred_workspace",
    operation: "GET /users/{id}/workspaces/preferred",
    description:
      "Get the workspace a new session opens for the signed-in user. Pass id `me`.",
  },
  {
    name: "users_set_preferred_workspace",
    operation: "PUT /users/{id}/workspaces/preferred",
    description:
      "Set the workspace a new session opens. Pass id `me` and `body.workspaceId` from workspaces_list.",
    destructive: true,
  },
  {
    name: "users_delete_workspace",
    operation: "DELETE /users/{id}/workspaces/{workspaceId}",
    description:
      "Delete the signed-in user's personal workspace. Pass id `me` and `workspaceId`. Refused for an organization workspace, the last workspace, or one with Jobs or Tasks.",
  },
  {
    name: "workspaces_get",
    operation: "GET /workspaces/{id}",
    description:
      "Resolve a workspace id to its organization id; null for a personal workspace.",
  },
  {
    name: "workspaces_ad_data_consent",
    operation: "GET /workspaces/{id}/ad-data-consent",
    description:
      "Get a workspace's choices on internal use of its ad data. A person changes them in Sokosumi.",
  },
  {
    name: "workspaces_calendar_labels",
    operation: "POST /workspaces/{id}/calendar/identity-labels",
    description:
      "Turn up to 50 Calendar actor references into names. Pass the active workspace's id and `body.refs`; a person who left shows as a former member.",
  },
  {
    name: "workspaces_design_md",
    operation: "GET /workspaces/design-md",
    description:
      "Get the DESIGN.md in effect for a workspace: the organization's for `workspace`, otherwise the personal one. Follow it for branded work.",
  },
  {
    name: "workspaces_adhoc_design_md",
    operation: "POST /workspaces/design-md/adhoc",
    description:
      "Store a one-off DESIGN.md, such as another company's brand for one Task, and get its URL. It changes no workspace's DESIGN.md. Pass `body.content` and `body.extractionId` (null when unknown).",
  },
  {
    name: "organizations_memberships",
    operation: "GET /users/{id}/members",
    description:
      "List the signed-in user's organization memberships, each with its organization and role. Pass id `me`.",
  },
  {
    name: "organizations_credits",
    operation: "GET /users/{id}/organizations/{organizationId}/credits",
    description:
      "Get an organization's credit balance for the signed-in member. Pass id `me` and `organizationId`.",
  },
  {
    name: "organizations_membership",
    operation: "GET /users/{id}/organizations/{organizationId}/member",
    description:
      "Get the signed-in user's membership in one organization, with role and seat. Pass id `me` and `organizationId`.",
  },
  {
    name: "organizations_pending_invitations",
    operation: "GET /users/{id}/pending-organization-invitations",
    description:
      "List the organization invitations waiting for the signed-in user. Pass id `me`. The person accepts them in Sokosumi.",
  },
  {
    name: "organizations_get_by_slug",
    operation: "GET /organizations/slug/{slug}",
    description: "Get an organization you belong to by its slug.",
  },
  {
    name: "organizations_get",
    operation: "GET /organizations/{id}",
    description: "Get an organization you belong to by its id.",
  },
  {
    name: "organizations_members",
    operation: "GET /organizations/{id}/members",
    description:
      "List an organization's members with their role, seat and last-seen time.",
  },
  {
    name: "organizations_assign_seat",
    operation: "PUT /organizations/{id}/members/{memberId}/seat",
    description:
      "Give a member a seat, so they can use the organization's credits. Owners and admins only. `memberId` from organizations_members. It buys nothing.",
  },
  {
    name: "organizations_unassign_seat",
    operation: "DELETE /organizations/{id}/members/{memberId}/seat",
    description:
      "Take a member's seat away. Owners and admins only. `memberId` from organizations_members.",
  },
  {
    name: "organizations_invitations",
    operation: "GET /organizations/{id}/invitations",
    description:
      "List an organization's pending email invitations. Owners and admins only.",
  },
  {
    name: "organizations_coworker_access",
    operation: "GET /organizations/{id}/coworker-access",
    description:
      "List the Coworkers that have or ask for access to an organization workspace. Owners and admins only. A person approves requests in Sokosumi.",
  },
  {
    name: "organizations_deny_coworker_access",
    operation: "POST /organizations/{id}/coworker-access/{accessId}/deny",
    description:
      "Deny a Coworker's pending request for an organization workspace. `accessId` from organizations_coworker_access.",
  },
  {
    name: "organizations_revoke_coworker_access",
    operation: "POST /organizations/{id}/coworker-access/{accessId}/revoke",
    description:
      "Revoke a Coworker's access to an organization workspace. `accessId` from organizations_coworker_access.",
    destructive: true,
  },
  {
    name: "organizations_vendor_grants",
    operation: "GET /organizations/{id}/vendor-grants",
    description:
      "List the vendors granted or asking for access to an organization workspace. Filter by `status` or `vendorId`. A person approves grants in Sokosumi.",
  },
  {
    name: "organizations_deny_vendor_grant",
    operation: "POST /organizations/{id}/vendor-grants/{grantId}/deny",
    description:
      "Deny a vendor's pending grant for an organization workspace. Its Tasks waiting on the grant are cancelled. `grantId` from organizations_vendor_grants.",
    destructive: true,
  },
  {
    name: "organizations_revoke_vendor_grant",
    operation: "POST /organizations/{id}/vendor-grants/{grantId}/revoke",
    description:
      "Revoke a vendor's grant for an organization workspace. Its Tasks waiting on the grant are cancelled. `grantId` from organizations_vendor_grants.",
    destructive: true,
  },
  {
    name: "organizations_set_design_md",
    operation: "PUT /organizations/{id}/design-md",
    description:
      "Replace an organization's DESIGN.md, the brand guide agents follow in its workspace. Owners and admins only. `body.content` (Markdown, or null to clear) and `body.extractionId` (null when unknown).",
    destructive: true,
  },
  {
    name: "organizations_standup",
    operation: "GET /organizations/{id}/standup",
    description:
      "Get an organization's daily agent stand-up: on or off, channel, time, weekdays and time zone.",
  },
  {
    name: "organizations_set_standup",
    operation: "PUT /organizations/{id}/standup",
    description:
      "Turn an organization's daily agent stand-up on or off and set its time (HH:MM), weekdays and time zone. Owners and admins only.",
    destructive: true,
  },
  // SOKD-370: categories, history, transactions and notifications.
  {
    name: "categories_list",
    operation: "GET /categories",
    description:
      "List agent categories that have at least one agent. A category's slug filters agents_list by `category`.",
  },
  {
    name: "history_list",
    operation: "GET /history",
    description:
      "List the workspace's history feed, newest first: Jobs, Tasks and images. Filter by `types`, `status`, `projectId` or `q`; pass `cursor` for the next page.",
  },
  {
    name: "transactions_list",
    operation: "GET /transactions",
    description:
      "List the workspace's credit ledger, newest first: spends and top ups. Filter by `types`, `projectId`, `taskId` or `q`; pass `cursor` for the next page.",
  },
  {
    name: "transactions_daily",
    operation: "GET /transactions/daily",
    description:
      "Credits spent per UTC day, zero on days without spend. `from` and `to` (YYYY-MM-DD) are optional; the default is the last 30 days. Takes the transactions_list filters.",
  },
  {
    name: "transactions_total",
    operation: "GET /transactions/total",
    description:
      "Net credits and row count under the transactions_list filters, such as everything one Task cost (`taskId`).",
  },
  {
    name: "notifications_list",
    operation: "GET /notifications",
    description:
      "List your notifications, newest first. Filter by `isRead`, `kind`, `needsAction` or `mentions`; pass `cursor` for the next page.",
  },
  {
    name: "notifications_counts",
    operation: "GET /notifications/counts",
    description:
      "Count your unread notifications, the ones waiting on you, and unread mentions.",
  },
  {
    name: "notifications_read",
    operation: "PATCH /notifications/{id}/read",
    description: "Mark one notification as read.",
  },
  {
    name: "notifications_unread",
    operation: "PATCH /notifications/{id}/unread",
    description: "Mark one notification as unread again.",
  },
  {
    name: "notifications_read_many",
    operation: "PATCH /notifications/read",
    description:
      'Mark several notifications as read: `body.ids`, or every one about a Task or Job with `{ "kind": "TASK" | "JOB", "referenceId" }`.',
  },
  {
    name: "notifications_read_all",
    operation: "PATCH /notifications/read-all",
    description: "Mark all your notifications as read.",
  },
  // SOKD-385: Image Studio generations (ADR 0077: credits are the cap).
  {
    name: "projects_image_studio_generate",
    operation: "POST /projects/{id}/image-studio/jobs",
    description:
      "Spends workspace credits. Start an Image Studio image for a Project from `body.prompt`. Send a fresh `body.idempotencyKey` (8 to 200 characters) per image and the same one on a retry: a repeat returns the first job instead of buying another. Refused when the balance cannot cover it and the jobs already running.",
    spendsCredits: true,
  },
  {
    name: "projects_image_studio_video",
    operation: "POST /projects/{id}/image-studio/video-jobs",
    description:
      "Spends workspace credits. Start an Image Studio video from `body.prompt`, or animate a Studio image with `body.sourceAssetId`. Send a fresh `body.idempotencyKey` per video and the same one on a retry: a repeat returns the first job.",
    spendsCredits: true,
  },
  {
    name: "projects_image_studio_short_video",
    operation: "POST /projects/{id}/image-studio/short-video-jobs",
    description:
      "Spends workspace credits. Start a short vertical video: a voice reads `body.script` over the Project's pictures and site, in `body.format`. Send a fresh `body.idempotencyKey` per video and the same one on a retry: a repeat returns the first job.",
    spendsCredits: true,
  },
  {
    name: "projects_image_studio_talking_video",
    operation: "POST /projects/{id}/image-studio/talking-video-jobs",
    description:
      "Spends workspace credits. Start a talking video: a presenter speaks `body.script`. Use a stock presenter (`presenter.kind` `stock`). A photo of a real person (`file`) is person-only: an agent gets 403 `person_approval_required` with a link to send the person to. Send a fresh `body.idempotencyKey` per video and the same one on a retry: a repeat returns the first job.",
    spendsCredits: true,
  },
  {
    name: "projects_image_studio_cancel",
    operation: "POST /projects/{id}/image-studio/jobs/{jobId}/cancel",
    description:
      "Ask to stop a queued or running Image Studio job. `accepted` means the provider took the request, not that the work stopped.",
  },
  // SOKD-383: an agent drafts, plans and cancels Social posts and cancels newsletters (ADR 0077).
  {
    name: "projects_social_post_create",
    operation: "POST /projects/{id}/social-posts",
    description:
      "Draft a Social post for a Project; pass `scheduledAt` and `socialConnectionId` to plan it. It lands as Needs approval and publishes only after a person approves it in Sokosumi.",
  },
  {
    name: "projects_social_post_update",
    operation: "PATCH /projects/{id}/social-posts/{postId}",
    description:
      "Edit a Social post. `body.revision` is the revision you last read. The post goes back to Needs approval, whatever its status was.",
    destructive: true,
  },
  {
    name: "projects_social_post_schedule",
    operation: "POST /projects/{id}/social-posts/{postId}/schedule",
    description:
      "Plan a Social post for a time on a connected account. It lands as Needs approval and publishes at that time only after a person approves it.",
  },
  {
    name: "projects_social_post_queue",
    operation: "POST /projects/{id}/social-posts/{postId}/queue",
    description:
      "Plan a Social post in its account's next free queue slot. It lands as Needs approval.",
  },
  {
    name: "projects_social_post_cancel",
    operation: "POST /projects/{id}/social-posts/{postId}/cancel",
    description:
      "Cancel a draft, planned or Needs approval Social post so it never publishes, or dismiss a failed or missed one.",
    destructive: true,
  },
  {
    name: "projects_social_post_duplicate",
    operation: "POST /projects/{id}/social-posts/{postId}/duplicate",
    description:
      "Copy a published, failed or missed Social post into a new post that needs approval.",
  },
  {
    name: "projects_social_post_statistics_refresh",
    operation: "POST /projects/{id}/social-posts/{postId}/statistics/refresh",
    description:
      "Fetch a published Social post's latest performance counters from its account.",
  },
  {
    name: "projects_social_account_post_recycle",
    operation:
      "POST /projects/{id}/social-account-posts/{accountPostId}/recycle",
    description:
      "Copy a post from an account's Performance list into a new Social post that needs approval. `delayDays` with `timezone` also plans it.",
  },
  {
    name: "projects_social_queue_slots_update",
    operation: "PUT /projects/{id}/social-queue-slots",
    description:
      "Replace a Project's weekly posting-queue times. Send the whole list: a time left out is removed.",
    destructive: true,
  },
  {
    name: "projects_social_connection_statistics_refresh",
    operation:
      "POST /projects/{id}/social-connections/{connectionId}/statistics/refresh",
    description:
      "Queue a background refresh of a connected account's statistics. Returns the stored data and sync state.",
  },
  {
    name: "projects_newsletter_issue_cancel",
    operation: "POST /projects/{id}/newsletter/issues/{issueId}/cancel",
    description:
      "Stop a scheduled newsletter issue before it sends. It goes back to a draft that a person approves again.",
  },
  // SOKD-373: projects and newsletter.
  {
    name: "projects_list",
    operation: "GET /projects",
    description:
      "List the workspace's Projects by latest activity. `state` filters to open, hidden or closed; `q` searches name, identifier, briefing and website; `pinnedFirst` puts your Pins first. Pass `cursor` from `pagination.nextCursor` for the next page.",
  },
  {
    name: "projects_create",
    operation: "POST /projects",
    description:
      "Create a Project in the workspace. `body.name` is required; `body.identifier` (such as SOK), `body.websiteUrl` and `body.briefing` are optional.",
  },
  {
    name: "projects_stats",
    operation: "GET /projects/stats",
    description:
      "Count each Project's Tasks and Jobs by status. `projectIds` (comma-separated) narrows it; omit it for every Project.",
  },
  {
    name: "projects_activity",
    operation: "GET /projects/activity",
    description:
      "The newest Task, Job and Project events across the workspace's open Projects, newest first. Pass `projectId` for one Project.",
  },
  {
    name: "projects_starred",
    operation: "GET /projects/starred",
    description:
      "List the Projects you pinned in this workspace, oldest Pin first.",
  },
  {
    name: "projects_get",
    operation: "GET /projects/{id}",
    description:
      "Get a Project: name, identifier, briefing, website, logo, DESIGN.md and close state.",
  },
  {
    name: "projects_update",
    operation: "PATCH /projects/{id}",
    description:
      "Change a Project's name, identifier, briefing, website, logo or social posting instructions (`postingInstructionsMd`). Only the fields sent change; null clears one. DESIGN.md has its own tools.",
  },
  {
    name: "projects_star",
    operation: "POST /projects/{id}/star",
    description:
      "Pin a Project for yourself. Personal, never shared; pinning a hidden Project shows it again. Idempotent.",
  },
  {
    name: "projects_unstar",
    operation: "DELETE /projects/{id}/star",
    description: "Unpin a Project for yourself. Idempotent.",
    destructive: false,
  },
  {
    name: "projects_hidden",
    operation: "GET /projects/{id}/hide",
    description: "Whether you have hidden this Project.",
  },
  {
    name: "projects_hide",
    operation: "POST /projects/{id}/hide",
    description:
      "Hide a Project for yourself: it leaves your Project list and recent activity, and loses your Pin. Personal, never shared. Idempotent.",
  },
  {
    name: "projects_unhide",
    operation: "DELETE /projects/{id}/hide",
    description: "Show a hidden Project again for yourself. Idempotent.",
    destructive: false,
  },
  {
    name: "projects_add_job",
    operation: "POST /projects/{id}/jobs",
    description:
      "Add an existing Job to a Project. `body.jobId` is the Job's id.",
  },
  {
    name: "projects_remove_job",
    operation: "DELETE /projects/{id}/jobs/{jobId}",
    description: "Take a Job out of a Project. The Job itself stays.",
    destructive: false,
  },
  {
    name: "projects_add_task",
    operation: "POST /projects/{id}/tasks",
    description:
      "Add an existing Task to a Project. `body.taskId` is the Task's UUID, not its identifier.",
  },
  {
    name: "projects_remove_task",
    operation: "DELETE /projects/{id}/tasks/{taskId}",
    description:
      "Take a Task out of a Project. The Task itself stays. `taskId` is the Task's UUID.",
    destructive: false,
  },
  {
    name: "projects_context",
    operation: "GET /projects/{id}/context-md",
    description:
      "Read a Project's CONTEXT.md: the memory Sokosumi keeps about the business. Read-only.",
  },
  {
    name: "projects_posting_instructions",
    operation: "GET /projects/{id}/posting-instructions",
    description:
      "Read a Project's social posting instructions: Markdown to follow before drafting a Social post. Null when none are set.",
  },
  {
    name: "projects_set_design",
    operation: "PUT /projects/{id}/design-md",
    description:
      "Store a DESIGN.md for a Project and assign it, replacing the current one. `body.content` is the Markdown.",
    destructive: true,
  },
  {
    name: "projects_clear_design",
    operation: "DELETE /projects/{id}/design-md",
    description: "Clear a Project's DESIGN.md assignment.",
  },
  {
    name: "projects_needs_attention",
    operation: "GET /projects/{id}/needs-attention",
    description:
      "A Project's Task and Job counts and the five items that most need a person.",
  },
  {
    name: "projects_close_status",
    operation: "GET /projects/{id}/close",
    description:
      "Read a Project's close status: state, `projectRevision`, and any failure or owed work. 404 until a close has started.",
  },
  {
    name: "projects_close",
    operation: "POST /projects/{id}/close",
    description:
      "Close a Project. `body.expectedProjectRevision` is the Project's `projectRevision` from projects_get; `body.operationId` is a fresh UUID you choose, so a retry never closes twice. Confirm with the person first.",
    destructive: true,
  },
  {
    name: "projects_retry_close",
    operation: "POST /projects/{id}/close/retry",
    description:
      "Retry a failed close with a new `body.operationId` (a UUID), `body.expectedProjectRevision` (`projectRevision` from projects_close_status) and a `body.reason`.",
  },
  {
    name: "projects_cancel_owed",
    operation: "POST /projects/{id}/close/cancel-owed",
    description:
      "Cancel the owed work of a failed close and carry on closing; the owed work never runs. Send a new `body.operationId` (a UUID), `body.expectedProjectRevision` (`projectRevision` from projects_close_status) and a `body.reason`. Confirm with the person first.",
    destructive: true,
  },
  {
    name: "projects_brand_brain",
    operation: "GET /projects/{id}/brand-brain",
    description:
      "Read a Project's Brand Brain: what it knows about the business (summary, voice, audience, products, competitors, channels), its open yes/no questions, and who confirmed it.",
  },
  {
    name: "projects_set_brand_brain",
    operation: "PUT /projects/{id}/brand-brain",
    description:
      "Save a Project's Brand Brain. Each section in `body.brandBrain` replaces its own; answers to its questions are kept. Read it with projects_brand_brain first and send it back changed.",
    destructive: true,
  },
  {
    name: "projects_answer_brand_brain",
    operation: "POST /projects/{id}/brand-brain/answers",
    description:
      "Answer one of the Brand Brain's yes/no questions with the person's answer: `body.questionId`, `body.answer` (yes, no or unsure) and an optional `body.note`. Ask the person; do not guess.",
  },
  {
    name: "projects_competitors",
    operation: "GET /projects/{id}/competitors",
    description:
      "The competitors a Project tracks, this week's moves, what the weekly checks found with sources, and whether the paid weekly check is on and what it costs.",
  },
  {
    name: "projects_add_competitor",
    operation: "POST /projects/{id}/competitors",
    description:
      "Track a competitor: `body.name`, and optionally its website, pricing page, Instagram and Facebook handles. The next weekly check reads it.",
  },
  {
    name: "projects_update_competitor",
    operation: "PATCH /projects/{id}/competitors/{competitorId}",
    description:
      "Change a tracked competitor's name, website, pricing page or handles. Null or an empty string clears a field.",
  },
  {
    name: "projects_remove_competitor",
    operation: "DELETE /projects/{id}/competitors/{competitorId}",
    description:
      "Stop tracking a competitor. What the checks found about it is kept.",
  },
  {
    name: "projects_restore_competitor",
    operation: "POST /projects/{id}/competitors/{competitorId}/restore",
    description:
      "Undo a projects_remove_competitor: send back the `removal` number it answered with as `body.removal`. 409 if a later removal happened, the name is taken or the limit is reached.",
  },
  {
    name: "projects_competitor_checks",
    operation: "PUT /projects/{id}/competitors/checks",
    description:
      "Spends workspace credits. Turn the weekly competitor check on (`body.on: true`) or off. On, the first check starts at once and each competitor costs credits every week; projects_competitors shows the price. Confirm with the person first.",
    spendsCredits: true,
  },
  {
    name: "projects_check_competitors",
    operation: "POST /projects/{id}/competitors/check",
    description:
      "Spends workspace credits. Run the weekly competitor check now when one is due, charged like every weekly check. Takes up to a few minutes. Confirm with the person first.",
    spendsCredits: true,
  },
  {
    name: "projects_suggest_competitors",
    operation: "POST /projects/{id}/competitors/suggestions",
    description:
      "Suggest competitors from the Project's website. Free; adds nothing. Add the ones the person picks with projects_add_competitor.",
  },
  {
    name: "projects_strategies",
    operation: "GET /projects/{id}/marketing-strategies",
    description:
      "List the versions of a Project's Marketing strategy, newest first, without their plans. At most one is approved.",
  },
  {
    name: "projects_create_strategy",
    operation: "POST /projects/{id}/marketing-strategies",
    description:
      "Write a new version of a Project's Marketing strategy as `body.plan` (month, summary, goals, pillars, channels, calendar, ...). Nothing runs until an owner approves it in Sokosumi.",
  },
  {
    name: "projects_strategy",
    operation: "GET /projects/{id}/marketing-strategies/{strategyId}",
    description:
      "Get one version of a Project's Marketing strategy with its plan and yes/no questions.",
  },
  {
    name: "projects_answer_strategy",
    operation: "POST /projects/{id}/marketing-strategies/{strategyId}/answers",
    description:
      "Answer one of a strategy version's yes/no questions with the person's answer: `body.questionId`, `body.answer` (yes, no or unsure) and an optional `body.note`. Ask the person; do not guess.",
  },
  {
    name: "newsletter_availability",
    operation: "GET /newsletter/availability",
    description:
      "Whether the newsletter is available in this workspace. Other newsletter tools answer 404 where it is not.",
  },
  {
    name: "newsletter_get",
    operation: "GET /projects/{id}/newsletter",
    description:
      "Get a Project's newsletter settings: name, sender, reply-to, brand and welcome email. 404 when the Project has no newsletter.",
  },
  {
    name: "newsletter_set",
    operation: "PUT /projects/{id}/newsletter",
    description:
      "Create or replace a Project's newsletter settings: `body.name`, `senderName`, `replyTo`, `brand` and `welcomeEmailEnabled`. Read them with newsletter_get first.",
    destructive: true,
  },
  {
    name: "newsletter_analytics",
    operation: "GET /projects/{id}/newsletter/analytics",
    description:
      "A Project's newsletter activity over a UTC date range (`from`, `to`; default the last 30 days): sends, opens, clicks, unsubscribes, bounces, by day and by issue.",
  },
  {
    name: "newsletter_issue_analytics",
    operation: "GET /projects/{id}/newsletter/issues/{issueId}/analytics",
    description:
      "Lifetime analytics for one newsletter issue: deliveries, opens, clicks, rates and top links.",
  },
  {
    name: "newsletter_issues",
    operation: "GET /projects/{id}/newsletter/issues",
    description:
      "List a Project's newsletter issues, newest first. `status` and `search` filter them.",
  },
  {
    name: "newsletter_create_issue",
    operation: "POST /projects/{id}/newsletter/issues",
    description:
      "Create a draft newsletter issue: `body.subject`, `body.template` and `body.content`. It never sends; submit it with newsletter_submit_issue for a person to approve.",
  },
  {
    name: "newsletter_draft_issue",
    operation: "POST /projects/{id}/newsletter/issues/draft-with-ai",
    description:
      "Draft a newsletter issue with AI from `body.brief`, optionally using the Project's memory and recent Social posts. Always a draft; never sends. Free.",
  },
  {
    name: "newsletter_submit_issue",
    operation: "POST /projects/{id}/newsletter/issues/{issueId}/submit",
    description:
      "Submit a draft issue for a person to approve and send in Sokosumi. `body.revision` is the issue's current revision.",
  },
  {
    name: "newsletter_preview",
    operation: "POST /projects/{id}/newsletter/issues/preview",
    description:
      "Render unsaved issue content (`body.subject`, `template`, `content`, optional `brand`) as the email would look. Sends nothing and saves nothing.",
  },
  {
    name: "newsletter_issue",
    operation: "GET /projects/{id}/newsletter/issues/{issueId}",
    description:
      "Get one newsletter issue with its content, status and `revision`.",
  },
  {
    name: "newsletter_update_issue",
    operation: "PATCH /projects/{id}/newsletter/issues/{issueId}",
    description:
      "Edit a DRAFT or NEEDS_APPROVAL issue. `body.revision` is its current revision. An edit returns it to DRAFT and withdraws any approval.",
    destructive: true,
  },
  {
    name: "newsletter_delete_issue",
    operation: "DELETE /projects/{id}/newsletter/issues/{issueId}",
    description: "Delete a DRAFT or CANCELED newsletter issue.",
  },
  {
    name: "newsletter_sending_domain",
    operation: "GET /projects/{id}/newsletter/sending-domain",
    description:
      "Read a Project's newsletter sending domain, the DNS records to publish and their verification status.",
  },
  {
    name: "newsletter_set_sending_domain",
    operation: "PUT /projects/{id}/newsletter/sending-domain",
    description:
      "Set a Project's newsletter From address (`body.fromAddress`). A new domain returns the DNS records the person must publish.",
    destructive: true,
  },
  {
    name: "newsletter_remove_sending_domain",
    operation: "DELETE /projects/{id}/newsletter/sending-domain",
    description:
      "Remove a Project's newsletter sending domain. Until a new one is verified, issues send from the shared Sokosumi sender where one is configured, and are refused otherwise. Confirm with the person first.",
  },
  {
    name: "newsletter_check_sending_domain",
    operation: "POST /projects/{id}/newsletter/sending-domain/check",
    description:
      "Ask the mail provider to verify the sending domain's DNS records now and return the new status.",
  },
  {
    name: "newsletter_domain_connect",
    operation: "GET /projects/{id}/newsletter/sending-domain/domain-connect",
    description:
      "Get a one-click link that adds the sending domain's DNS records at the person's DNS provider, or null when the provider does not support it. Give the link to the person; do not open it yourself.",
  },
  {
    name: "newsletter_subscribers",
    operation: "GET /projects/{id}/newsletter/subscribers",
    description:
      "List a Project's newsletter subscribers. `status` and `search` (email) filter them; counts cover every subscriber.",
  },
  {
    name: "newsletter_update_subscriber",
    operation: "PATCH /projects/{id}/newsletter/subscribers/{subscriberId}",
    description:
      "Change a subscriber's name, or unsubscribe an active subscriber (`body.status: UNSUBSCRIBED`).",
  },
  {
    name: "newsletter_remove_subscriber",
    operation: "DELETE /projects/{id}/newsletter/subscribers/{subscriberId}",
    description:
      "Delete an active or pending subscriber. Unsubscribed and bounced ones are kept so they are never emailed again (409).",
  },
  // Ad campaign writes (SOKD-384, ADR 0077). Ad money is billed by Google or
  // Meta outside Sokosumi credits, so these are destructive and say so first.
  {
    name: "projects_ads_campaign_create",
    operation: "POST /projects/{id}/ads/accounts/{accountId}/campaigns",
    description:
      "Can lead to ad spend once a person resumes the campaign. Create a campaign in a Project's attached ad account; it is always created paused. `body.name` and `body.dailyBudget` (decimal in the account currency), plus `body.objective` for Meta or `body.google` for Google. A person resumes it in Sokosumi.",
    destructive: true,
    openWorld: true,
  },
  {
    name: "projects_ads_campaign_update",
    operation:
      "PATCH /projects/{id}/ads/accounts/{accountId}/campaigns/{campaignId}",
    description:
      'Can lead to ad spend once a person resumes the campaign. Pause a campaign with `body: { "status": "PAUSED" }` at any time, or change a paused campaign\'s budget with `body.dailyBudget` (409 if it is not paused). Send one of the two per call. Only a person resumes a campaign: `ACTIVE` answers 403 with `details.webUrl`, the page to send the person to.',
    destructive: true,
    openWorld: true,
  },
  {
    name: "projects_ads_campaign_edit",
    operation:
      "PUT /projects/{id}/ads/accounts/{accountId}/campaigns/{campaignId}",
    description:
      "Can lead to ad spend once a person resumes the campaign. Edit a paused Google campaign (409 if it is not paused): `body.name`, `body.dailyBudget` and the whole `body.google` spec, as for a create. Pause it first with projects_ads_campaign_update.",
    destructive: true,
    openWorld: true,
  },
  // SOKD-374: SEO audits and Project SEO. Not a default toolset.
  {
    name: "seo_list_audits",
    operation: "GET /seo/audits",
    description:
      "List the workspace's SEO audits, newest first. Filter by `status` (`active` or `archived`) or `projectId`; pass `cursor` from `pagination.nextCursor` for the next page.",
  },
  {
    name: "seo_create_audit",
    operation: "POST /seo/audits",
    description:
      "Create an SEO audit with its first page: `body.name`, `body.firstPage.url`, and optional `body.projectId` to link a Project. It runs no analysis; use seo_audit_analyze for that.",
  },
  {
    name: "seo_audit_workspace",
    operation: "GET /seo/audits/{id}/workspace",
    description:
      "Find which of the signed-in person's workspaces an SEO audit is in: its `name`, `workspaceId` and `organizationId` (null for the personal workspace). Match it in workspaces_list and pass that workspace's slug as `workspace` to the other seo tools.",
  },
  {
    name: "seo_audit_archive",
    operation: "PATCH /seo/audits/{id}",
    description:
      "Archive an SEO audit and its Tasks with `body.archived: true`, or restore them with `false`.",
    destructive: true,
  },
  {
    name: "seo_audit_chat",
    operation: "GET /seo/audits/{id}/chat",
    description:
      "Read the conversation about an SEO audit: the questions asked and the answers.",
  },
  {
    name: "seo_audit_ask",
    operation: "POST /seo/audits/{id}/chat",
    description:
      "Spends workspace credits. Ask a question about an SEO audit's findings: `body.question` and a `body.idempotencyKey` you choose (8 or more characters). A daily allowance applies. Confirm with the person first.",
    spendsCredits: true,
  },
  {
    name: "seo_audit_get",
    operation: "GET /seo/audits/{id}",
    description:
      "Get an SEO audit: pages, scopes, keywords, competitors, findings, recommendations and statistics. Narrow it with `scopeId`, `pageId` or `pageIds`, and `from` and `to`. `id` is the audit id from seo_list_audits.",
  },
  {
    name: "seo_audit_add_page",
    operation: "POST /seo/audits/{id}/pages",
    description:
      "Add a page to an SEO audit: `body.url`, optional `body.label`, and `body.relationship` (`primary`, or `related` with `body.relatedToPageId`). `id` is the audit id from seo_list_audits.",
  },
  {
    name: "seo_audit_create_scope",
    operation: "POST /seo/audits/{id}/scopes",
    description:
      "Save a named set of pages in an SEO audit: `body.name` and `body.pageIds`.",
  },
  {
    name: "seo_audit_update_scope",
    operation: "PUT /seo/audits/{id}/scopes/{scopeId}",
    description:
      "Rename a saved scope in an SEO audit or replace its pages: `body.name`, `body.pageIds`, and `body.expectedVersion` from seo_audit_get.",
    destructive: true,
  },
  {
    name: "seo_audit_import_report",
    operation: "POST /seo/audits/{id}/imports",
    description:
      "Import a finished SEO report into an SEO audit from a Task's file: `body.taskId` and `body.fileId`.",
  },
  {
    name: "seo_audit_analyze",
    operation: "POST /seo/audits/{id}/analyses",
    description:
      "Spends workspace credits. Request an SEO analysis of the audit's pages: `body.kind` (`page_check`, `rankings`, `links`, `audit_lite` or `audit_full`), the pages as `body.scopeId` or `body.pageIds`, `body.countryCode`, `body.languageCode`, `body.devices`, and a `body.idempotencyKey` you choose (8 or more characters). Confirm the analysis and its price with the person first.",
    spendsCredits: true,
  },
  {
    name: "seo_audit_save_keyword",
    operation: "POST /seo/audits/{id}/keywords",
    description:
      "Track a keyword in an SEO audit, or change one: `body.keyword`, `body.countryCode`, `body.languageCode`, optional `body.pageId` and `body.priority`. `body.saved: false` stops tracking it.",
  },
  {
    name: "seo_audit_save_competitor",
    operation: "POST /seo/audits/{id}/competitors",
    description:
      "Confirm or dismiss a competitor site in an SEO audit: `body.url` and `body.confirmed`.",
  },
  {
    name: "seo_audit_create_task",
    operation: "POST /seo/audits/{id}/actions",
    description:
      "Turn a recommendation in an SEO audit into a Task: `body.observationId` and `body.actionId` from seo_audit_get, and a `body.idempotencyKey` you choose (8 or more characters).",
  },
  {
    name: "seo_audit_create_monitor",
    operation: "POST /seo/audits/{id}/monitors",
    description:
      "Spends workspace credits. Each run of this monitor is paid. Schedule a recurring SEO analysis of the audit's pages: `body.operationId` (a new UUID you choose), `body.rule` (`expr`, a cron that runs at most once a day, and `timezone`), and `body.analysis` as for seo_audit_analyze, with its own `idempotencyKey`. Confirm the schedule and the price per run with the person first.",
    spendsCredits: true,
  },
  {
    name: "seo_audit_review_action",
    operation: "POST /seo/audits/{id}/actions/reviews",
    description:
      "Record that the person reviewed a recommendation's result in an SEO audit: `body.pageId`, `body.actionId`, `body.kind`, `body.baselineObservationId` and `body.observationId`.",
  },
  {
    name: "seo_audit_properties",
    operation: "GET /seo/audits/{id}/statistics/properties",
    description:
      "List the Search Console properties the signed-in person's connection can read for an SEO audit.",
  },
  {
    name: "seo_audit_sync_statistics",
    operation: "POST /seo/audits/{id}/statistics/sync",
    description:
      "Collect search statistics for the audit's pages through the signed-in person's connection: `body.provider`, `body.propertyId` from seo_audit_properties, `body.from` and `body.to` (YYYY-MM-DD).",
  },
  {
    name: "seo_audit_record_change",
    operation: "POST /seo/audits/{id}/page-changes",
    description:
      "Note a change made to pages in an SEO audit, so later statistics compare before and after: `body.pageIds`, `body.occurredAt`, `body.title`, optional `body.note`, and a `body.idempotencyKey` you choose.",
  },
  {
    name: "seo_audit_set_brand_terms",
    operation: "PUT /seo/audits/{id}/brand-terms",
    description:
      "Replace the brand terms of an SEO audit, which split branded from unbranded searches: `body.terms`. The list replaces the saved one.",
    destructive: true,
  },
  {
    name: "seo_audit_brief",
    operation: "GET /seo/audits/{id}/brief",
    description:
      "Get the SEO brief of an SEO audit: its objective and each page's role, with `revision`.",
  },
  {
    name: "seo_audit_save_brief",
    operation: "PUT /seo/audits/{id}/brief",
    description:
      "Replace the SEO brief of an SEO audit. Send the whole brief from seo_audit_brief with your changes and `body.expectedRevision`.",
    destructive: true,
  },
  {
    name: "seo_audit_suggest_brief",
    operation: "GET /seo/audits/{id}/brief/suggestion",
    description:
      "Suggest a role in the SEO brief of an SEO audit for one page, or null. Pass `pageId`.",
  },
  {
    name: "seo_audit_console_exports",
    operation: "GET /seo/audits/{id}/console-exports/{taskId}",
    description:
      "List the Search Console export samples imported for an SEO Task of an SEO audit. Only the person who imported them sees them.",
  },
  {
    name: "seo_audit_import_console_export",
    operation: "POST /seo/audits/{id}/console-exports/{taskId}",
    description:
      "Import a Search Console CSV export for an SEO Task of an SEO audit: `body.kind`, `body.date` (YYYY-MM-DD) and `body.csv`; an `indexing_examples` export also takes `body.reason`.",
  },
  {
    name: "seo_project_get",
    operation: "GET /projects/{id}/seo",
    description:
      "Get a Project's SEO workspace: pages, scopes, keywords, competitors, findings, recommendations and statistics. Narrow it with `scopeId`, `pageId` or `pageIds`, and `from` and `to`. `id` is the Project id.",
  },
  {
    name: "seo_project_add_page",
    operation: "POST /projects/{id}/seo/pages",
    description:
      "Add a page to a Project's SEO workspace: `body.url`, optional `body.label`, and `body.relationship` (`primary`, or `related` with `body.relatedToPageId`). `id` is the Project id.",
  },
  {
    name: "seo_project_create_scope",
    operation: "POST /projects/{id}/seo/scopes",
    description:
      "Save a named set of pages in a Project's SEO workspace: `body.name` and `body.pageIds`.",
  },
  {
    name: "seo_project_update_scope",
    operation: "PUT /projects/{id}/seo/scopes/{scopeId}",
    description:
      "Rename a saved scope in a Project's SEO workspace or replace its pages: `body.name`, `body.pageIds`, and `body.expectedVersion` from seo_project_get.",
    destructive: true,
  },
  {
    name: "seo_project_import_report",
    operation: "POST /projects/{id}/seo/imports",
    description:
      "Import a finished SEO report into a Project's SEO workspace from a Task's file: `body.taskId` and `body.fileId`.",
  },
  {
    name: "seo_project_analyze",
    operation: "POST /projects/{id}/seo/analyses",
    description:
      "Spends workspace credits. Request an SEO analysis of the Project's pages: `body.kind` (`page_check`, `rankings`, `links`, `audit_lite` or `audit_full`), the pages as `body.scopeId` or `body.pageIds`, `body.countryCode`, `body.languageCode`, `body.devices`, and a `body.idempotencyKey` you choose (8 or more characters). Confirm the analysis and its price with the person first.",
    spendsCredits: true,
  },
  {
    name: "seo_project_save_keyword",
    operation: "POST /projects/{id}/seo/keywords",
    description:
      "Track a keyword in a Project's SEO workspace, or change one: `body.keyword`, `body.countryCode`, `body.languageCode`, optional `body.pageId` and `body.priority`. `body.saved: false` stops tracking it.",
  },
  {
    name: "seo_project_save_competitor",
    operation: "POST /projects/{id}/seo/competitors",
    description:
      "Confirm or dismiss a competitor site in a Project's SEO workspace: `body.url` and `body.confirmed`.",
  },
  {
    name: "seo_project_create_task",
    operation: "POST /projects/{id}/seo/actions",
    description:
      "Turn a recommendation in a Project's SEO workspace into a Task: `body.observationId` and `body.actionId` from seo_project_get, and a `body.idempotencyKey` you choose (8 or more characters).",
  },
  {
    name: "seo_project_create_monitor",
    operation: "POST /projects/{id}/seo/monitors",
    description:
      "Spends workspace credits. Each run of this monitor is paid. Schedule a recurring SEO analysis of the Project's pages: `body.operationId` (a new UUID you choose), `body.rule` (`expr`, a cron that runs at most once a day, and `timezone`), and `body.analysis` as for seo_project_analyze, with its own `idempotencyKey`. Confirm the schedule and the price per run with the person first.",
    spendsCredits: true,
  },
  {
    name: "seo_project_review_action",
    operation: "POST /projects/{id}/seo/actions/reviews",
    description:
      "Record that the person reviewed a recommendation's result in a Project's SEO workspace: `body.pageId`, `body.actionId`, `body.kind`, `body.baselineObservationId` and `body.observationId`.",
  },
  {
    name: "seo_project_properties",
    operation: "GET /projects/{id}/seo/statistics/properties",
    description:
      "List the Search Console properties the signed-in person's connection can read for a Project's SEO workspace.",
  },
  {
    name: "seo_project_sync_statistics",
    operation: "POST /projects/{id}/seo/statistics/sync",
    description:
      "Collect search statistics for the Project's pages through the signed-in person's connection: `body.provider`, `body.propertyId` from seo_project_properties, `body.from` and `body.to` (YYYY-MM-DD).",
  },
  {
    name: "seo_project_record_change",
    operation: "POST /projects/{id}/seo/page-changes",
    description:
      "Note a change made to pages in a Project's SEO workspace, so later statistics compare before and after: `body.pageIds`, `body.occurredAt`, `body.title`, optional `body.note`, and a `body.idempotencyKey` you choose.",
  },
  {
    name: "seo_project_set_brand_terms",
    operation: "PUT /projects/{id}/seo/brand-terms",
    description:
      "Replace the brand terms of a Project's SEO workspace, which split branded from unbranded searches: `body.terms`. The list replaces the saved one.",
    destructive: true,
  },
  {
    name: "seo_project_brief",
    operation: "GET /projects/{id}/seo/brief",
    description:
      "Get the SEO brief of a Project's SEO workspace: its objective and each page's role, with `revision`.",
  },
  {
    name: "seo_project_save_brief",
    operation: "PUT /projects/{id}/seo/brief",
    description:
      "Replace the SEO brief of a Project's SEO workspace. Send the whole brief from seo_project_brief with your changes and `body.expectedRevision`.",
    destructive: true,
  },
  {
    name: "seo_project_suggest_brief",
    operation: "GET /projects/{id}/seo/brief/suggestion",
    description:
      "Suggest a role in the SEO brief of a Project's SEO workspace for one page, or null. Pass `pageId`.",
  },
  {
    name: "seo_project_console_exports",
    operation: "GET /projects/{id}/seo/console-exports/{taskId}",
    description:
      "List the Search Console export samples imported for an SEO Task of a Project's SEO workspace. Only the person who imported them sees them.",
  },
  {
    name: "seo_project_import_console_export",
    operation: "POST /projects/{id}/seo/console-exports/{taskId}",
    description:
      "Import a Search Console CSV export for an SEO Task of a Project's SEO workspace: `body.kind`, `body.date` (YYYY-MM-DD) and `body.csv`; an `indexing_examples` export also takes `body.reason`.",
  },
  // SOKD-375: Drive, in the non-default `drive` toolset.
  {
    name: "drive_search",
    operation: "GET /drive/search",
    description:
      "Search a Drive's files by name, extracted text and metadata. Pass `scope` `me` for the personal Drive, or `org` with `organizationId`. Filter with `q`, labels, projects, `folder`, type or dates; page with `cursor`.",
  },
  {
    name: "drive_files",
    operation: "GET /drive/files",
    description:
      "List the folders and files at one level of a Drive; `folder` is the path, the root when omitted. Page with `cursor`.",
  },
  {
    name: "drive_recents",
    operation: "GET /drive/recents",
    description: "List a Drive's recent files and Task outputs, newest first.",
  },
  {
    name: "drive_get",
    operation: "GET /drive/resources/{id}",
    description:
      "Get one Drive file with its category, tags, projects, pending suggestions and `metadataRevision`.",
  },
  {
    name: "drive_related",
    operation: "GET /drive/resources/{id}/related",
    description: "List up to six documents related to one Drive file.",
  },
  {
    name: "drive_folders",
    operation: "GET /drive/folders",
    description: "List the folder paths in a Drive that hold a file.",
  },
  {
    name: "drive_create_folder",
    operation: "POST /drive/folders",
    description: "Create an empty Drive folder at `body.folderPath`.",
  },
  {
    name: "drive_rename_folder",
    operation: "PATCH /drive/folders/rename",
    description:
      "Rename or move a Drive folder and everything in it, from `body.oldFolderPath` to `body.newFolderPath`.",
  },
  {
    name: "drive_delete_folder",
    operation: "DELETE /drive/folders/delete",
    description:
      "Delete a Drive folder and every file in it. This cannot be undone.",
  },
  {
    name: "drive_move",
    operation: "PATCH /drive/files/move",
    description:
      "Move a Drive file or folder (`body.itemType`) by its pathname into `body.targetFolderPath`.",
  },
  {
    name: "drive_rename",
    operation: "PATCH /drive/files/rename",
    description:
      "Rename a Drive file: `body.oldPathname` is its `pathname` from drive_files, `body.newFilename` the new name.",
  },
  {
    name: "drive_delete",
    operation: "DELETE /drive/files/delete",
    description:
      "Delete a Drive file by its `pathname` from drive_files. This cannot be undone.",
  },
  {
    name: "drive_update_metadata",
    operation: "PATCH /drive/resources/{id}/metadata",
    description:
      "Change one Drive file's category, tags and confirmed projects. Pass its current `metadataRevision` from drive_get as `body.expectedMetadataRevision`; a stale one answers 409.",
    destructive: true,
  },
  {
    name: "drive_decide_suggestion",
    operation: "POST /drive/resources/{id}/suggestions/{suggestionId}/decision",
    description:
      "Accept, dismiss or restore one metadata suggestion on a Drive file (`body.decision`), with its current `metadataRevision`.",
  },
  {
    name: "drive_select",
    operation: "POST /drive/resources/selection-token",
    description:
      "Turn the result window behind a drive_search cursor (`body.windowCursor`) into a short-lived selection token for drive_update_metadata_batch. It never selects more than that window.",
  },
  {
    name: "drive_update_metadata_batch",
    operation: "POST /drive/resources/metadata-batch",
    description:
      "Add or remove tags, or set the category, on up to 100 Drive files: `body.resourceIds` or a `body.selectionToken` from drive_select, with an `idempotencyKey`. Each file succeeds or fails on its own; `outcomes` lists each.",
    destructive: true,
  },
  {
    name: "drive_reindex",
    operation: "POST /drive/resources/{id}/reindex",
    description:
      "Queue a Drive file for text extraction again. Once a minute per file.",
  },
  {
    name: "drive_add_google_sheet",
    operation: "POST /drive/files/google-sheets",
    description:
      "Save a Google Sheet into Drive as a PDF copy that Sokosumi refreshes every hour. The sheet must be shared as 'Anyone with the link can view'; pass its link as `body.url`.",
  },
  {
    name: "drive_google_sheet",
    operation: "GET /drive/resources/{id}/google-sheet",
    description:
      "Get the Google Sheet a Drive file copies. Empty for a plain file.",
  },
  {
    name: "drive_refresh_google_sheet",
    operation: "POST /drive/resources/{id}/google-sheet/refresh",
    description:
      "Read a Drive file's Google Sheet now and rewrite the copy if it changed. A failure comes back in `error`; the copy stays as it was.",
    destructive: true,
  },
  {
    name: "drive_tasks",
    operation: "GET /drive/tasks",
    description:
      "List the Task output files in a Drive. Filter by `projectId`, `taskId` or `assigneeId`; page with `cursor`.",
  },
  {
    name: "drive_copy_task_file",
    operation: "POST /drive/tasks/copy",
    description:
      "Copy a Task output file (`body.taskFileId` from drive_tasks) to the Drive root. The Task's file stays.",
  },
  {
    name: "drive_labels",
    operation: "GET /drive/labels",
    description:
      "List a Drive's categories and tags. `kind` filters; `includeArchived` adds archived ones.",
  },
  {
    name: "drive_create_label",
    operation: "POST /drive/labels",
    description:
      "Create a Drive tag or category (`body.kind`) named `body.displayName`.",
  },
  {
    name: "drive_update_label",
    operation: "PATCH /drive/labels/{id}",
    description:
      "Rename, describe or archive a Drive tag or category. A rename keeps its id. Merging it into another label (`body.mergeIntoLabelId`) is an admin step: only do it when the person asks.",
    destructive: true,
  },
  {
    name: "drive_collections",
    operation: "GET /drive/collections",
    description:
      "List saved Drive views: your own collections and those shared in the workspace.",
  },
  {
    name: "drive_create_collection",
    operation: "POST /drive/collections",
    description:
      "Save Drive search filters (`body.definition`) and a sort as a collection. Private unless `body.isShared`.",
  },
  {
    name: "drive_update_collection",
    operation: "PATCH /drive/collections/{id}",
    description: "Rename a collection, or replace its filters and sort.",
    destructive: true,
  },
  {
    name: "drive_delete_collection",
    operation: "DELETE /drive/collections/{id}",
    description: "Delete one of your collections. The files in it stay.",
  },
  {
    name: "drive_share",
    operation: "GET /drive/shares",
    description:
      "Get the public link of a Drive file (`resourceId`) or folder (`folderPath`), if it has one.",
  },
  {
    name: "drive_unshare",
    operation: "DELETE /drive/shares/{id}",
    description:
      "Stop sharing a Drive file or folder: its public link stops working at once.",
  },
  {
    name: "drive_tables",
    operation: "GET /drive/tables",
    description:
      "List a workspace's tables. Filter by `projectId`, `search` or `archived`; page with `cursor`.",
  },
  {
    name: "drive_create_table",
    operation: "POST /drive/tables",
    description:
      "Create a table with `body.columns` and optional `body.rows`. `body.key` is a retry key: send the same key to retry without creating a second table.",
  },
  {
    name: "drive_table",
    operation: "GET /drive/tables/{id}",
    description: "Get a table's columns, views and `version`.",
  },
  {
    name: "drive_update_table",
    operation: "PATCH /drive/tables/{id}",
    description:
      "Change a table's title, description, columns or archived state. Pass its current `version` and a retry `key`.",
    destructive: true,
  },
  {
    name: "drive_query_table",
    operation: "POST /drive/tables/{id}/query",
    description:
      "Read a table's rows with filters, sort and paging. Changes nothing.",
  },
  {
    name: "drive_edit_rows",
    operation: "POST /drive/tables/{id}/rows",
    description:
      "Insert rows (`body.insert`) and change cells (`body.patch`) in one batch with a retry `key`. drive_undo_table reverts the batch.",
    destructive: true,
  },
  {
    name: "drive_save_view",
    operation: "POST /drive/tables/{id}/views",
    description:
      "Create a saved view of a table, or change one by `body.id` and its `version`.",
  },
  {
    name: "drive_undo_table",
    operation: "POST /drive/tables/{id}/undo",
    description:
      "Undo one batch of row edits by `body.batchId`, with a retry `key`.",
    destructive: true,
  },
  {
    name: "drive_table_history",
    operation: "GET /drive/tables/{id}/history",
    description:
      "List a table's edits, newest first. Filter by `rowId` or `columnId`; page with `cursor`.",
  },
  {
    name: "drive_enrich_table",
    operation: "POST /drive/tables/{id}/enrich",
    description:
      "Create a Task for a Coworker (`body.assigneeId`) or a Soko Bot (`body.assigneeSokoBotId`) to fill the chosen cells following `body.prompt`.",
  },
  {
    name: "drive_data_rooms",
    operation: "GET /drive/data-rooms",
    description:
      "List a Drive's data rooms: folders whose files only the people let in see.",
  },
  {
    name: "drive_create_data_room",
    operation: "POST /drive/data-rooms",
    description:
      "Turn a Drive folder (`body.folderPath`) into a data room. Its files move to private storage, and public links to it or anything in it stop working.",
    destructive: true,
  },
  {
    name: "drive_open_questions",
    operation: "GET /drive/data-rooms/questions",
    description:
      "List unanswered viewer questions across the data rooms you manage.",
  },
  {
    name: "drive_data_room",
    operation: "GET /drive/data-rooms/{id}",
    description:
      "Get a data room's settings, the people let in and what each may see.",
  },
  {
    name: "drive_close_data_room",
    operation: "DELETE /drive/data-rooms/{id}",
    description:
      "Close a data room: its files move back to ordinary Drive storage and the folder becomes an ordinary folder.",
  },
  {
    name: "drive_remove_data_room_member",
    operation: "DELETE /drive/data-rooms/{id}/members/{memberId}",
    description:
      "Take someone out of a data room at once; their open sessions end.",
  },
  {
    name: "drive_data_room_events",
    operation: "GET /drive/data-rooms/{id}/events",
    description:
      "List a data room's activity, newest first: who came in and what they opened. Filter by `memberId`; page with `before`.",
  },
  {
    name: "drive_data_room_questions",
    operation: "GET /drive/data-rooms/{id}/questions",
    description:
      "List the questions viewers asked about a data room's documents, newest first.",
  },
  {
    name: "drive_order_data_room",
    operation: "PUT /drive/data-rooms/{id}/order",
    description:
      "Set the order of a data room's folders and files (`body.entries`), which also numbers them for viewers.",
    destructive: true,
  },
  {
    name: "drive_set_data_room_colleagues",
    operation: "PUT /drive/data-rooms/{id}/colleagues",
    description:
      "Choose which organization members (`body.userIds`) may see and run an organization data room, besides its maker, owners and admins. Replaces the list.",
    destructive: true,
  },
];

/** Route groups with a hyphen, which their tool names spell with `_`. */
const HYPHENATED_TOOLSETS = ["image-studio"];

/** A tool's toolset: the route group its name starts with. */
export function toolsetOf(name: string): string {
  return (
    HYPHENATED_TOOLSETS.find((group) =>
      name.startsWith(`${group.replaceAll("-", "_")}_`),
    ) ??
    name.split("_", 1)[0] ??
    name
  );
}

/** Every toolset, in registry order. */
export const MCP_TOOLSETS: readonly string[] = [
  ...new Set(MCP_TOOLS.map((tool) => toolsetOf(tool.name))),
];

/** The toolsets a server URL without `?toolsets=` gets. */
export const DEFAULT_TOOLSETS = ["workspaces", "tasks", "coworkers"] as const;

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
