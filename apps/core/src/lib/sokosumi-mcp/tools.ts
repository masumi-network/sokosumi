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
