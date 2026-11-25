export type CoreMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface CliCommandCatalogEntry {
  readonly command: string;
  readonly usage: string;
  /**
   * The Core operation (`METHOD /path`, as in apps/core/agent-surface) a row
   * without a bespoke handler runs: positionals fill the path parameters.
   */
  readonly operation?: `${CoreMethod} /${string}`;
  /** The operation takes no JSON body: the command refuses --input-json like a read. */
  readonly noBody?: true;
  /** A DELETE whose operation takes a JSON body: the command needs --input-json like a write. */
  readonly body?: true;
}

export const CLI_COMMAND_CATALOG = [
  { command: "discover", usage: "" },
  { command: "skills", usage: "" },
  { command: "skills path", usage: "" },
  { command: "auth login", usage: "" },
  { command: "auth status", usage: "" },
  { command: "auth whoami", usage: "" },
  { command: "auth logout", usage: "" },
  { command: "admin members", usage: "WORKSPACE_SLUG" },
  { command: "admin add-member", usage: "WORKSPACE_SLUG --email EMAIL" },
  { command: "admin assign-seat", usage: "WORKSPACE_SLUG --email EMAIL" },
  {
    command: "evals run",
    usage: "[--suite S] [--cases IDS] [--repeats N] [--wait]",
  },
  { command: "evals show", usage: "RUN_ID [--markdown]" },
  { command: "evals list", usage: "[--limit N]" },
  { command: "evals cases", usage: "" },
  { command: "agents list", usage: "" },
  { command: "agents hire", usage: "AGENT_ID" },
  { command: "agents get", usage: "AGENT_ID", operation: "GET /agents/{id}" },
  {
    command: "agents jobs",
    usage: "AGENT_ID [--query scope=workspace]",
    operation: "GET /agents/{id}/jobs",
  },
  {
    command: "agents reviews",
    usage: "AGENT_ID [--query limit=N]",
    operation: "GET /agents/{id}/reviews",
  },
  {
    command: "agents my-review",
    usage: "AGENT_ID",
    operation: "GET /agents/{id}/reviews/me",
  },
  {
    command: "agents rating-eligibility",
    usage: "AGENT_ID",
    operation: "GET /agents/{id}/ratings/eligibility",
  },
  { command: "coworkers list", usage: "" },
  { command: "coworkers register", usage: "[--personal] [options]" },
  { command: "coworkers provision", usage: "[options]" },
  { command: "coworkers connect", usage: "COWORKER_ID [--personal] [options]" },
  { command: "coworkers update", usage: "COWORKER_ID [options]" },
  { command: "coworkers api-key", usage: "COWORKER_ID [options]" },
  {
    command: "coworkers list-api-keys",
    usage: "COWORKER_ID",
    operation: "GET /coworkers/{id}/api-keys",
  },
  {
    command: "coworkers revoke-api-key",
    usage: "COWORKER_ID KEY_ID",
    operation: "DELETE /coworkers/{id}/api-keys/{keyId}",
  },
  { command: "coworkers me", usage: "" },
  { command: "vendors me", usage: "" },
  { command: "vendors create", usage: "--name NAME --slug SLUG" },
  // SOKD-372: coworkers, vendors and developer.
  {
    command: "coworkers events",
    usage: "",
    operation: "GET /coworkers/me/events",
  },
  {
    command: "coworkers report-usage",
    usage: "--input-json JSON",
    operation: "POST /coworkers/me/usage",
  },
  {
    command: "coworkers archive",
    usage: "COWORKER_ID",
    operation: "DELETE /coworkers/{id}",
  },
  {
    command: "coworkers unarchive",
    usage: "COWORKER_ID --input-json '{}'",
    operation: "POST /coworkers/{id}/unarchive",
  },
  {
    command: "coworkers whitelist",
    usage: "COWORKER_ID --input-json JSON",
    operation: "PATCH /coworkers/{id}/whitelist",
  },
  {
    command: "coworkers remove-image",
    usage: "COWORKER_ID",
    operation: "DELETE /coworkers/{id}/image",
  },
  {
    command: "coworkers update-api-key",
    usage: "COWORKER_ID KEY_ID --input-json JSON",
    operation: "PATCH /coworkers/{id}/api-keys/{keyId}",
  },
  {
    command: "coworkers list-access",
    usage: "COWORKER_ID",
    operation: "GET /coworkers/{id}/workspace-access",
  },
  {
    command: "coworkers revoke-access",
    usage: "COWORKER_ID --input-json JSON",
    operation: "POST /coworkers/{id}/workspace-access/revoke",
  },
  {
    command: "vendors list",
    usage: "",
    operation: "GET /vendors",
  },
  {
    command: "vendors update",
    usage: "VENDOR_ID --input-json JSON",
    operation: "PATCH /vendors/{id}",
  },
  {
    command: "vendors logo-upload",
    usage: "VENDOR_ID --input-json JSON",
    operation: "POST /vendors/{id}/files",
  },
  {
    command: "vendors logo-cleanup",
    usage: "VENDOR_ID --input-json JSON",
    operation: "POST /vendors/{id}/files/cleanup",
  },
  {
    command: "vendors members",
    usage: "VENDOR_ID",
    operation: "GET /vendors/{id}/members",
  },
  {
    command: "vendors update-member",
    usage: "VENDOR_ID USER_ID --input-json JSON",
    operation: "PATCH /vendors/{id}/members/{userId}",
  },
  {
    command: "vendors remove-member",
    usage: "VENDOR_ID USER_ID",
    operation: "DELETE /vendors/{id}/members/{userId}",
  },
  {
    command: "vendors invites",
    usage: "VENDOR_ID",
    operation: "GET /vendors/{id}/invites",
  },
  {
    command: "vendors invite",
    usage: "VENDOR_ID --input-json JSON",
    operation: "POST /vendors/{id}/invites",
  },
  {
    command: "vendors revoke-invite",
    usage: "VENDOR_ID INVITE_ID",
    operation: "DELETE /vendors/{id}/invites/{inviteId}",
  },
  {
    command: "vendors my-invites",
    usage: "",
    operation: "GET /vendors/invites",
  },
  {
    command: "vendors accept-invite",
    usage: "INVITE_ID --input-json '{}'",
    operation: "POST /vendors/invites/{inviteId}/accept",
  },
  {
    command: "vendors decline-invite",
    usage: "INVITE_ID --input-json '{}'",
    operation: "POST /vendors/invites/{inviteId}/decline",
  },
  {
    command: "vendors assignments",
    usage: "VENDOR_ID COWORKER_ID",
    operation: "GET /vendors/{id}/coworkers/{coworkerId}/assignments",
  },
  {
    command: "vendors assign",
    usage: "VENDOR_ID COWORKER_ID --input-json JSON",
    operation: "PUT /vendors/{id}/coworkers/{coworkerId}/assignments",
  },
  {
    command: "vendors unassign",
    usage: "VENDOR_ID COWORKER_ID USER_ID",
    operation:
      "DELETE /vendors/{id}/coworkers/{coworkerId}/assignments/{userId}",
  },
  {
    command: "developer tasks",
    usage: "[--query coworkerId=ID]",
    operation: "GET /developer/tasks",
  },
  {
    command: "developer task",
    usage: "TASK_ID",
    operation: "GET /developer/tasks/{id}",
  },
  { command: "workspaces list", usage: "[--personal]" },
  { command: "workspaces check", usage: "ORGANIZATION_ID" },
  { command: "runtime key-import", usage: "[options]" },
  { command: "runtime start", usage: "TASK_ID [options]" },
  { command: "runtime complete", usage: "TASK_ID [options]" },
  { command: "runtime run", usage: "TASK_ID [options]" },
  { command: "runtime receipt", usage: "TASK_ID [options]" },
  { command: "tasks list", usage: "[options]" },
  {
    command: "tasks create",
    usage: "[--organization-slug WORKSPACE_SLUG | --personal]",
  },
  {
    command: "tasks get",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks events",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks jobs",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks comment",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks update",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks links",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks link",
    usage:
      "TASK_ID --to TASK_ID --relation RELATION [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks unlink",
    usage:
      "TASK_ID --to TASK_ID [--relation RELATION] [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks relink",
    usage:
      "TASK_ID --to TASK_ID --relation RELATION [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks archive",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks subtasks",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks move",
    usage:
      "TASK_ID [--parent TASK_ID | --detach] [--after TASK_ID | --first] [--organization-slug WORKSPACE_SLUG]",
  },
  // SOKD-369: schedules, files, follow, participants, workspace, summary, due dates.
  {
    command: "tasks summary",
    usage: "[--query scope=owned|workspace]",
    operation: "GET /tasks/summary",
  },
  { command: "tasks view", usage: "", operation: "GET /tasks/view" },
  {
    command: "tasks set-view",
    usage: "--input-json JSON",
    operation: "PUT /tasks/view",
  },
  {
    command: "tasks move-overdue",
    usage: "--input-json JSON",
    operation: "POST /tasks/due-dates/move-overdue",
  },
  {
    command: "tasks undo-move-overdue",
    usage: "--input-json JSON",
    operation: "POST /tasks/due-dates/undo",
  },
  {
    command: "tasks list-schedules",
    usage: "[--query KEY=VALUE]",
    operation: "GET /tasks/schedules",
  },
  {
    command: "tasks create-schedule",
    usage: "--input-json JSON",
    operation: "POST /tasks/schedules",
  },
  {
    command: "tasks schedule-assignees",
    usage: "",
    operation: "GET /tasks/schedules/assignees",
  },
  {
    command: "tasks get-schedule",
    usage: "SCHEDULE_ID",
    operation: "GET /tasks/schedules/{id}",
  },
  {
    command: "tasks update-schedule",
    usage: "SCHEDULE_ID --input-json JSON",
    operation: "PATCH /tasks/schedules/{id}",
  },
  {
    command: "tasks delete-schedule",
    usage: "SCHEDULE_ID",
    operation: "DELETE /tasks/schedules/{id}",
  },
  {
    command: "tasks pause-schedule",
    usage: "SCHEDULE_ID",
    operation: "POST /tasks/schedules/{id}/pause",
    noBody: true,
  },
  {
    command: "tasks resume-schedule",
    usage: "SCHEDULE_ID",
    operation: "POST /tasks/schedules/{id}/resume",
    noBody: true,
  },
  {
    command: "tasks end-schedule",
    usage: "SCHEDULE_ID",
    operation: "POST /tasks/schedules/{id}/end",
    noBody: true,
  },
  {
    command: "tasks schedule-runs",
    usage: "SCHEDULE_ID [--query KEY=VALUE]",
    operation: "GET /tasks/schedules/{id}/runs",
  },
  {
    command: "tasks run-schedule",
    usage: "SCHEDULE_ID --input-json JSON",
    operation: "POST /tasks/schedules/{id}/runs",
  },
  {
    command: "tasks update-schedule-run",
    usage: "SCHEDULE_ID RUN_ID --input-json JSON",
    operation: "PATCH /tasks/schedules/{id}/runs/{runId}",
  },
  {
    command: "tasks update-link",
    usage: "TASK_ID LINK_ID --input-json JSON",
    operation: "PATCH /tasks/{id}/links/{linkId}",
  },
  {
    command: "tasks join",
    usage: "TASK_ID",
    operation: "POST /tasks/{id}/participants",
    noBody: true,
  },
  {
    command: "tasks leave",
    usage: "TASK_ID USER_ID",
    operation: "DELETE /tasks/{id}/participants/{userId}",
  },
  {
    command: "tasks follow",
    usage: "TASK_ID",
    operation: "POST /tasks/{id}/follow",
    noBody: true,
  },
  {
    command: "tasks unfollow",
    usage: "TASK_ID",
    operation: "DELETE /tasks/{id}/follow",
  },
  {
    command: "tasks send-to-chat",
    usage: "TASK_ID --input-json JSON",
    operation: "POST /tasks/{id}/chat-messages",
  },
  {
    command: "tasks workspace",
    usage: "TASK_ID",
    operation: "GET /tasks/{id}/workspace",
  },
  {
    command: "tasks set-workspace",
    usage: "TASK_ID --input-json JSON",
    operation: "PUT /tasks/{id}/workspace",
  },
  {
    command: "tasks restore",
    usage: "TASK_ID",
    operation: "POST /tasks/{id}/restore",
    noBody: true,
  },
  {
    command: "tasks files",
    usage: "TASK_ID",
    operation: "GET /tasks/{id}/files",
  },
  {
    command: "tasks upload-url",
    usage: "TASK_ID --input-json JSON",
    operation: "POST /tasks/{id}/files",
  },
  { command: "jobs list", usage: "[--organization-slug WORKSPACE_SLUG]" },
  {
    command: "jobs get",
    usage: "JOB_ID [--details] [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "jobs input",
    usage: "JOB_ID --event-id EVENT_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "jobs events",
    usage: "JOB_ID",
    operation: "GET /jobs/{id}/events",
  },
  { command: "jobs files", usage: "JOB_ID", operation: "GET /jobs/{id}/files" },
  { command: "jobs links", usage: "JOB_ID", operation: "GET /jobs/{id}/links" },
  // SOKD-378: ads, image-studio, social and calendar reads.
  {
    command: "image-studio catalog",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /image-studio/catalog",
  },
  {
    command: "image-studio state",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /image-studio/state",
  },
  {
    command: "image-studio recent-projects",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /image-studio/recent-projects",
  },
  {
    command: "projects ads-accounts",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/ads/accounts",
  },
  {
    command: "projects ads-campaigns",
    usage: "PROJECT_ID ACCOUNT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/ads/accounts/{accountId}/campaigns",
  },
  {
    command: "projects ads-campaign",
    usage:
      "PROJECT_ID ACCOUNT_ID CAMPAIGN_ID [--organization-slug WORKSPACE_SLUG]",
    operation:
      "GET /projects/{id}/ads/accounts/{accountId}/campaigns/{campaignId}",
  },
  {
    command: "projects ads-locations",
    usage:
      "PROJECT_ID ACCOUNT_ID --query q=NAME [--organization-slug WORKSPACE_SLUG]",
    operation:
      "GET /projects/{id}/ads/accounts/{accountId}/targeting/locations",
  },
  {
    command: "projects ads-languages",
    usage: "PROJECT_ID ACCOUNT_ID [--organization-slug WORKSPACE_SLUG]",
    operation:
      "GET /projects/{id}/ads/accounts/{accountId}/targeting/languages",
  },
  {
    command: "projects ads-market",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/ads/market",
  },
  {
    command: "projects image-studio",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/image-studio",
  },
  {
    command: "projects image-studio-batch",
    usage: "PROJECT_ID BATCH_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/image-studio/batches/{batchId}/assets",
  },
  {
    command: "projects image-studio-compare",
    usage: "PROJECT_ID BATCH_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/image-studio/batches/{batchId}/compare",
  },
  {
    command: "projects image-studio-scoreboard",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/image-studio/model-scoreboard",
  },
  {
    command: "projects image-studio-brand-kit",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/image-studio/brand-kit",
  },
  {
    command: "projects image-studio-website-copy",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/image-studio/brand-kit/website-copy",
  },
  {
    command: "projects image-studio-website-draft",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/image-studio/website-draft",
  },
  {
    command: "projects image-studio-products",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/image-studio/products",
  },
  {
    command: "projects image-studio-talking-videos",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/image-studio/talking-videos",
  },
  {
    command: "projects social-connections",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/social-connections",
  },
  {
    command: "projects social-connection-subscription",
    usage: "PROJECT_ID CONNECTION_ID [--organization-slug WORKSPACE_SLUG]",
    operation:
      "GET /projects/{id}/social-connections/{connectionId}/subscription",
  },
  {
    command: "projects social-connection-tiktok-creator",
    usage: "PROJECT_ID CONNECTION_ID [--organization-slug WORKSPACE_SLUG]",
    operation:
      "GET /projects/{id}/social-connections/{connectionId}/tiktok-creator",
  },
  {
    command: "projects social-connection-suggested-times",
    usage:
      "PROJECT_ID CONNECTION_ID --query timezone=IANA_ZONE [--organization-slug WORKSPACE_SLUG]",
    operation:
      "GET /projects/{id}/social-connections/{connectionId}/suggested-times",
  },
  {
    command: "projects social-statistics",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/social-connections/statistics",
  },
  {
    command: "projects social-posts",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/social-posts",
  },
  {
    command: "projects social-post",
    usage: "PROJECT_ID POST_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/social-posts/{postId}",
  },
  {
    command: "projects social-posts-statistics",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/social-posts/statistics",
  },
  {
    command: "projects social-queue-slots",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/social-queue-slots",
  },
  {
    command: "projects calendar",
    usage:
      "PROJECT_ID --query from=ISO --query to=ISO [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/calendar",
  },
  {
    command: "workspaces calendar",
    usage:
      "--query from=ISO --query to=ISO [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /workspaces/calendar",
  },
  {
    command: "workspaces calendar-sources",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /workspaces/calendar/sources",
  },
  {
    command: "workspaces social-posts",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /workspaces/social-posts",
  },
  {
    command: "workspaces social-statistics",
    usage: "WORKSPACE_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /workspaces/{id}/social-connections/statistics",
  },
  // SOKD-371: users, organizations and workspaces. `/users/{id}` commands take `me`.
  {
    command: "users registered",
    usage: "--query email=EMAIL",
    operation: "GET /users/registered",
  },
  {
    command: "users update",
    usage: "me --input-json JSON",
    operation: "PATCH /users/{id}",
  },
  {
    command: "workspaces credits",
    usage: "me [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /users/{id}/credits",
  },
  {
    command: "users set-design-md",
    usage: "me --input-json JSON",
    operation: "PUT /users/{id}/design-md",
  },
  {
    command: "users preferences",
    usage: "me",
    operation: "GET /users/{id}/preferences",
  },
  {
    command: "users update-preferences",
    usage: "me --input-json JSON",
    operation: "PATCH /users/{id}/preferences",
  },
  {
    command: "users files",
    usage: "me",
    operation: "GET /users/{id}/files",
  },
  {
    command: "users file-upload",
    usage: "me --input-json JSON",
    operation: "POST /users/{id}/files",
  },
  {
    command: "users coworker-access",
    usage: "me",
    operation: "GET /users/{id}/coworker-access",
  },
  {
    command: "users deny-coworker-access",
    usage: "me ACCESS_ID --input-json '{}'",
    operation: "POST /users/{id}/coworker-access/{accessId}/deny",
  },
  {
    command: "users revoke-coworker-access",
    usage: "me ACCESS_ID --input-json '{}'",
    operation: "POST /users/{id}/coworker-access/{accessId}/revoke",
  },
  {
    command: "users vendor-grants",
    usage: "me [--query status=STATUS]",
    operation: "GET /users/{id}/vendor-grants",
  },
  {
    command: "users deny-vendor-grant",
    usage: "me GRANT_ID --input-json '{}'",
    operation: "POST /users/{id}/vendor-grants/{grantId}/deny",
  },
  {
    command: "users revoke-vendor-grant",
    usage: "me GRANT_ID --input-json '{}'",
    operation: "POST /users/{id}/vendor-grants/{grantId}/revoke",
  },
  {
    command: "workspaces create",
    usage: "me --input-json JSON",
    operation: "POST /users/{id}/workspaces",
  },
  {
    command: "users preferred-workspace",
    usage: "me",
    operation: "GET /users/{id}/workspaces/preferred",
  },
  {
    command: "users set-preferred-workspace",
    usage: "me --input-json JSON",
    operation: "PUT /users/{id}/workspaces/preferred",
  },
  {
    command: "users delete-workspace",
    usage: "me WORKSPACE_ID",
    operation: "DELETE /users/{id}/workspaces/{workspaceId}",
  },
  {
    command: "workspaces get",
    usage: "WORKSPACE_ID",
    operation: "GET /workspaces/{id}",
  },
  {
    command: "workspaces ad-data-consent",
    usage: "WORKSPACE_ID",
    operation: "GET /workspaces/{id}/ad-data-consent",
  },
  {
    command: "workspaces set-ad-data-consent",
    usage: "WORKSPACE_ID --input-json JSON",
    operation: "PUT /workspaces/{id}/ad-data-consent",
  },
  {
    command: "workspaces design-md",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /workspaces/design-md",
  },
  {
    command: "workspaces calendar-labels",
    usage: "WORKSPACE_ID --input-json JSON",
    operation: "POST /workspaces/{id}/calendar/identity-labels",
  },
  {
    command: "workspaces adhoc-design-md",
    usage: "--input-json JSON",
    operation: "POST /workspaces/design-md/adhoc",
  },
  {
    command: "organizations memberships",
    usage: "me",
    operation: "GET /users/{id}/members",
  },
  {
    command: "organizations credits",
    usage: "me ORGANIZATION_ID",
    operation: "GET /users/{id}/organizations/{organizationId}/credits",
  },
  {
    command: "organizations membership",
    usage: "me ORGANIZATION_ID",
    operation: "GET /users/{id}/organizations/{organizationId}/member",
  },
  {
    command: "organizations pending-invitations",
    usage: "me",
    operation: "GET /users/{id}/pending-organization-invitations",
  },
  {
    command: "organizations get-by-slug",
    usage: "SLUG",
    operation: "GET /organizations/slug/{slug}",
  },
  {
    command: "organizations get",
    usage: "ORGANIZATION_ID",
    operation: "GET /organizations/{id}",
  },
  {
    command: "organizations members",
    usage: "ORGANIZATION_ID",
    operation: "GET /organizations/{id}/members",
  },
  {
    command: "organizations assign-seat",
    usage: "ORGANIZATION_ID MEMBER_ID --input-json '{}'",
    operation: "PUT /organizations/{id}/members/{memberId}/seat",
  },
  {
    command: "organizations unassign-seat",
    usage: "ORGANIZATION_ID MEMBER_ID",
    operation: "DELETE /organizations/{id}/members/{memberId}/seat",
  },
  {
    command: "organizations invitations",
    usage: "ORGANIZATION_ID",
    operation: "GET /organizations/{id}/invitations",
  },
  {
    command: "organizations invite-links",
    usage: "ORGANIZATION_ID",
    operation: "GET /organizations/{id}/invite-links",
  },
  {
    command: "organizations create-invite-link",
    usage: "ORGANIZATION_ID --input-json JSON",
    operation: "POST /organizations/{id}/invite-links",
  },
  {
    command: "organizations revoke-invite-link",
    usage: "ORGANIZATION_ID TOKEN",
    operation: "DELETE /organizations/{id}/invite-links/{token}",
  },
  {
    command: "organizations coworker-access",
    usage: "ORGANIZATION_ID",
    operation: "GET /organizations/{id}/coworker-access",
  },
  {
    command: "organizations deny-coworker-access",
    usage: "ORGANIZATION_ID ACCESS_ID --input-json '{}'",
    operation: "POST /organizations/{id}/coworker-access/{accessId}/deny",
  },
  {
    command: "organizations revoke-coworker-access",
    usage: "ORGANIZATION_ID ACCESS_ID --input-json '{}'",
    operation: "POST /organizations/{id}/coworker-access/{accessId}/revoke",
  },
  {
    command: "organizations vendor-grants",
    usage: "ORGANIZATION_ID [--query status=STATUS]",
    operation: "GET /organizations/{id}/vendor-grants",
  },
  {
    command: "organizations deny-vendor-grant",
    usage: "ORGANIZATION_ID GRANT_ID --input-json '{}'",
    operation: "POST /organizations/{id}/vendor-grants/{grantId}/deny",
  },
  {
    command: "organizations revoke-vendor-grant",
    usage: "ORGANIZATION_ID GRANT_ID --input-json '{}'",
    operation: "POST /organizations/{id}/vendor-grants/{grantId}/revoke",
  },
  {
    command: "organizations set-design-md",
    usage: "ORGANIZATION_ID --input-json JSON",
    operation: "PUT /organizations/{id}/design-md",
  },
  {
    command: "organizations standup",
    usage: "ORGANIZATION_ID",
    operation: "GET /organizations/{id}/standup",
  },
  {
    command: "organizations set-standup",
    usage: "ORGANIZATION_ID --input-json JSON",
    operation: "PUT /organizations/{id}/standup",
  },
  {
    command: "jobs update",
    usage: "JOB_ID --input-json JSON",
    operation: "PATCH /jobs/{id}",
  },
  {
    command: "jobs move",
    usage: "JOB_ID --input-json JSON",
    operation: "PUT /jobs/{id}/workspace",
  },
  {
    command: "jobs unshare",
    usage: "JOB_ID",
    operation: "DELETE /jobs/{id}/share",
  },
  // SOKD-370: categories, history, transactions and notifications.
  { command: "categories list", usage: "", operation: "GET /categories" },
  {
    command: "history list",
    usage: "[--query KEY=VALUE]",
    operation: "GET /history",
  },
  {
    command: "transactions list",
    usage: "[--query KEY=VALUE]",
    operation: "GET /transactions",
  },
  {
    command: "transactions daily",
    usage: "[--query from=YYYY-MM-DD --query to=YYYY-MM-DD]",
    operation: "GET /transactions/daily",
  },
  {
    command: "transactions total",
    usage: "[--query KEY=VALUE]",
    operation: "GET /transactions/total",
  },
  {
    command: "notifications list",
    usage: "[--query KEY=VALUE]",
    operation: "GET /notifications",
  },
  {
    command: "notifications counts",
    usage: "",
    operation: "GET /notifications/counts",
  },
  {
    command: "notifications read",
    usage: "NOTIFICATION_ID",
    operation: "PATCH /notifications/{id}/read",
    noBody: true,
  },
  {
    command: "notifications unread",
    usage: "NOTIFICATION_ID",
    operation: "PATCH /notifications/{id}/unread",
    noBody: true,
  },
  {
    command: "notifications read-many",
    usage: "--input-json JSON",
    operation: "PATCH /notifications/read",
  },
  {
    command: "notifications read-all",
    usage: "",
    operation: "PATCH /notifications/read-all",
    noBody: true,
  },
  // SOKD-385: Image Studio generations spend credits; the body's
  // idempotencyKey makes a retry return the first job.
  {
    command: "projects image-studio-generate",
    usage: `PROJECT_ID --input-json '{"prompt":"...","idempotencyKey":"..."}'`,
    operation: "POST /projects/{id}/image-studio/jobs",
  },
  {
    command: "projects image-studio-video",
    usage: `PROJECT_ID --input-json '{"prompt":"...","idempotencyKey":"..."}'`,
    operation: "POST /projects/{id}/image-studio/video-jobs",
  },
  {
    command: "projects image-studio-short-video",
    usage: `PROJECT_ID --input-json '{"format":"voiceover","script":"...","idempotencyKey":"..."}'`,
    operation: "POST /projects/{id}/image-studio/short-video-jobs",
  },
  {
    command: "projects image-studio-talking-video",
    usage: `PROJECT_ID --input-json '{"script":"...","presenter":{...},"idempotencyKey":"..."}'`,
    operation: "POST /projects/{id}/image-studio/talking-video-jobs",
  },
  {
    command: "projects image-studio-cancel",
    usage: "PROJECT_ID JOB_ID",
    operation: "POST /projects/{id}/image-studio/jobs/{jobId}/cancel",
    noBody: true,
  },
  // SOKD-383: an agent drafts, plans and cancels Social posts and cancels newsletters (ADR 0077).
  {
    command: "projects social-post-create",
    usage: "PROJECT_ID --input-json BODY [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/social-posts",
  },
  {
    command: "projects social-post-update",
    usage:
      "PROJECT_ID POST_ID --input-json BODY [--organization-slug WORKSPACE_SLUG]",
    operation: "PATCH /projects/{id}/social-posts/{postId}",
  },
  {
    command: "projects social-post-schedule",
    usage:
      "PROJECT_ID POST_ID --input-json BODY [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/social-posts/{postId}/schedule",
  },
  {
    command: "projects social-post-queue",
    usage:
      "PROJECT_ID POST_ID --input-json BODY [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/social-posts/{postId}/queue",
  },
  {
    command: "projects social-post-cancel",
    usage:
      "PROJECT_ID POST_ID --input-json BODY [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/social-posts/{postId}/cancel",
  },
  {
    command: "projects social-post-duplicate",
    usage:
      "PROJECT_ID POST_ID --input-json {} [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/social-posts/{postId}/duplicate",
  },
  {
    command: "projects social-post-statistics-refresh",
    usage:
      "PROJECT_ID POST_ID --input-json {} [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/social-posts/{postId}/statistics/refresh",
  },
  {
    command: "projects social-account-post-recycle",
    usage:
      "PROJECT_ID ACCOUNT_POST_ID --input-json BODY [--organization-slug WORKSPACE_SLUG]",
    operation:
      "POST /projects/{id}/social-account-posts/{accountPostId}/recycle",
  },
  {
    command: "projects social-queue-slots-update",
    usage: "PROJECT_ID --input-json BODY [--organization-slug WORKSPACE_SLUG]",
    operation: "PUT /projects/{id}/social-queue-slots",
  },
  {
    command: "projects social-connection-statistics-refresh",
    usage:
      "PROJECT_ID CONNECTION_ID --input-json {} [--organization-slug WORKSPACE_SLUG]",
    operation:
      "POST /projects/{id}/social-connections/{connectionId}/statistics/refresh",
  },
  {
    command: "projects newsletter-issue-cancel",
    usage:
      "PROJECT_ID ISSUE_ID --input-json BODY [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/newsletter/issues/{issueId}/cancel",
  },
  // SOKD-373: projects and newsletter.
  {
    command: "projects list",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects",
  },
  {
    command: "projects create",
    usage: "--input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects",
  },
  {
    command: "projects stats",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/stats",
  },
  {
    command: "projects activity",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/activity",
  },
  {
    command: "projects starred",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/starred",
  },
  {
    command: "projects get",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}",
  },
  {
    command: "projects update",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "PATCH /projects/{id}",
  },
  {
    command: "projects star",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/star",
    noBody: true,
  },
  {
    command: "projects unstar",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "DELETE /projects/{id}/star",
  },
  {
    command: "projects hidden",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/hide",
  },
  {
    command: "projects hide",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/hide",
    noBody: true,
  },
  {
    command: "projects unhide",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "DELETE /projects/{id}/hide",
  },
  {
    command: "projects add-job",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/jobs",
  },
  {
    command: "projects remove-job",
    usage: "PROJECT_ID JOB_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "DELETE /projects/{id}/jobs/{jobId}",
  },
  {
    command: "projects add-task",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/tasks",
  },
  {
    command: "projects remove-task",
    usage: "PROJECT_ID TASK_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "DELETE /projects/{id}/tasks/{taskId}",
  },
  {
    command: "projects context",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/context-md",
  },
  {
    command: "projects posting-instructions",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/posting-instructions",
  },
  {
    command: "projects set-design",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "PUT /projects/{id}/design-md",
  },
  {
    command: "projects clear-design",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "DELETE /projects/{id}/design-md",
  },
  {
    command: "projects needs-attention",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/needs-attention",
  },
  {
    command: "projects close-status",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/close",
  },
  {
    command: "projects close",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/close",
  },
  {
    command: "projects retry-close",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/close/retry",
  },
  {
    command: "projects cancel-owed",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/close/cancel-owed",
  },
  {
    command: "projects brand-brain",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/brand-brain",
  },
  {
    command: "projects set-brand-brain",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "PUT /projects/{id}/brand-brain",
  },
  {
    command: "projects answer-brand-brain",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/brand-brain/answers",
  },
  {
    command: "projects competitors",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/competitors",
  },
  {
    command: "projects add-competitor",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/competitors",
  },
  {
    command: "projects update-competitor",
    usage:
      "PROJECT_ID COMPETITOR_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "PATCH /projects/{id}/competitors/{competitorId}",
  },
  {
    command: "projects remove-competitor",
    usage: "PROJECT_ID COMPETITOR_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "DELETE /projects/{id}/competitors/{competitorId}",
  },
  {
    command: "projects restore-competitor",
    usage:
      "PROJECT_ID COMPETITOR_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/competitors/{competitorId}/restore",
  },
  {
    command: "projects competitor-checks",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "PUT /projects/{id}/competitors/checks",
  },
  {
    command: "projects check-competitors",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/competitors/check",
    noBody: true,
  },
  {
    command: "projects suggest-competitors",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/competitors/suggestions",
    noBody: true,
  },
  {
    command: "projects strategies",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/marketing-strategies",
  },
  {
    command: "projects create-strategy",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/marketing-strategies",
  },
  {
    command: "projects strategy",
    usage: "PROJECT_ID STRATEGY_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/marketing-strategies/{strategyId}",
  },
  {
    command: "projects answer-strategy",
    usage:
      "PROJECT_ID STRATEGY_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/marketing-strategies/{strategyId}/answers",
  },
  {
    command: "newsletter availability",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /newsletter/availability",
  },
  {
    command: "newsletter get",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/newsletter",
  },
  {
    command: "newsletter set",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "PUT /projects/{id}/newsletter",
  },
  {
    command: "newsletter analytics",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/newsletter/analytics",
  },
  {
    command: "newsletter issue-analytics",
    usage: "PROJECT_ID ISSUE_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/newsletter/issues/{issueId}/analytics",
  },
  {
    command: "newsletter issues",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/newsletter/issues",
  },
  {
    command: "newsletter create-issue",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/newsletter/issues",
  },
  {
    command: "newsletter draft-issue",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/newsletter/issues/draft-with-ai",
  },
  {
    command: "newsletter submit-issue",
    usage:
      "PROJECT_ID ISSUE_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/newsletter/issues/{issueId}/submit",
  },
  {
    command: "newsletter preview",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/newsletter/issues/preview",
  },
  {
    command: "newsletter issue",
    usage: "PROJECT_ID ISSUE_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/newsletter/issues/{issueId}",
  },
  {
    command: "newsletter update-issue",
    usage:
      "PROJECT_ID ISSUE_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "PATCH /projects/{id}/newsletter/issues/{issueId}",
  },
  {
    command: "newsletter delete-issue",
    usage: "PROJECT_ID ISSUE_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "DELETE /projects/{id}/newsletter/issues/{issueId}",
  },
  {
    command: "newsletter sending-domain",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/newsletter/sending-domain",
  },
  {
    command: "newsletter set-sending-domain",
    usage: "PROJECT_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "PUT /projects/{id}/newsletter/sending-domain",
  },
  {
    command: "newsletter remove-sending-domain",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "DELETE /projects/{id}/newsletter/sending-domain",
  },
  {
    command: "newsletter check-sending-domain",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /projects/{id}/newsletter/sending-domain/check",
    noBody: true,
  },
  {
    command: "newsletter domain-connect",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/newsletter/sending-domain/domain-connect",
  },
  {
    command: "newsletter subscribers",
    usage: "PROJECT_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /projects/{id}/newsletter/subscribers",
  },
  {
    command: "newsletter update-subscriber",
    usage:
      "PROJECT_ID SUBSCRIBER_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "PATCH /projects/{id}/newsletter/subscribers/{subscriberId}",
  },
  {
    command: "newsletter remove-subscriber",
    usage: "PROJECT_ID SUBSCRIBER_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "DELETE /projects/{id}/newsletter/subscribers/{subscriberId}",
  },
  // Ad campaign writes (SOKD-384, ADR 0077): created paused; a person resumes.
  {
    command: "projects ads-campaign-create",
    usage: "PROJECT_ID ACCOUNT_ID --input-json JSON",
    operation: "POST /projects/{id}/ads/accounts/{accountId}/campaigns",
  },
  {
    command: "projects ads-campaign-update",
    usage: "PROJECT_ID ACCOUNT_ID CAMPAIGN_ID --input-json JSON",
    operation:
      "PATCH /projects/{id}/ads/accounts/{accountId}/campaigns/{campaignId}",
  },
  {
    command: "projects ads-campaign-edit",
    usage: "PROJECT_ID ACCOUNT_ID CAMPAIGN_ID --input-json JSON",
    operation:
      "PUT /projects/{id}/ads/accounts/{accountId}/campaigns/{campaignId}",
  },
  // SOKD-374: SEO audits and Project SEO, in the `seo` MCP toolset
  { command: "seo list-audits", usage: "", operation: "GET /seo/audits" },
  { command: "seo create-audit", usage: "", operation: "POST /seo/audits" },
  {
    command: "seo audit-workspace",
    usage: "AUDIT_ID",
    operation: "GET /seo/audits/{id}/workspace",
  },
  {
    command: "seo audit-archive",
    usage: "AUDIT_ID",
    operation: "PATCH /seo/audits/{id}",
  },
  {
    command: "seo audit-chat",
    usage: "AUDIT_ID",
    operation: "GET /seo/audits/{id}/chat",
  },
  {
    command: "seo audit-ask",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/chat",
  },
  {
    command: "seo audit-get",
    usage: "AUDIT_ID",
    operation: "GET /seo/audits/{id}",
  },
  {
    command: "seo audit-add-page",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/pages",
  },
  {
    command: "seo audit-create-scope",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/scopes",
  },
  {
    command: "seo audit-update-scope",
    usage: "AUDIT_ID SCOPE_ID",
    operation: "PUT /seo/audits/{id}/scopes/{scopeId}",
  },
  {
    command: "seo audit-import-report",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/imports",
  },
  {
    command: "seo audit-analyze",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/analyses",
  },
  {
    command: "seo audit-save-keyword",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/keywords",
  },
  {
    command: "seo audit-save-competitor",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/competitors",
  },
  {
    command: "seo audit-create-task",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/actions",
  },
  {
    command: "seo audit-create-monitor",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/monitors",
  },
  {
    command: "seo audit-review-action",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/actions/reviews",
  },
  {
    command: "seo audit-properties",
    usage: "AUDIT_ID",
    operation: "GET /seo/audits/{id}/statistics/properties",
  },
  {
    command: "seo audit-sync-statistics",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/statistics/sync",
  },
  {
    command: "seo audit-record-change",
    usage: "AUDIT_ID",
    operation: "POST /seo/audits/{id}/page-changes",
  },
  {
    command: "seo audit-set-brand-terms",
    usage: "AUDIT_ID",
    operation: "PUT /seo/audits/{id}/brand-terms",
  },
  {
    command: "seo audit-brief",
    usage: "AUDIT_ID",
    operation: "GET /seo/audits/{id}/brief",
  },
  {
    command: "seo audit-save-brief",
    usage: "AUDIT_ID",
    operation: "PUT /seo/audits/{id}/brief",
  },
  {
    command: "seo audit-suggest-brief",
    usage: "AUDIT_ID",
    operation: "GET /seo/audits/{id}/brief/suggestion",
  },
  {
    command: "seo audit-console-exports",
    usage: "AUDIT_ID TASK_ID",
    operation: "GET /seo/audits/{id}/console-exports/{taskId}",
  },
  {
    command: "seo audit-import-console-export",
    usage: "AUDIT_ID TASK_ID",
    operation: "POST /seo/audits/{id}/console-exports/{taskId}",
  },
  {
    command: "seo project-get",
    usage: "PROJECT_ID",
    operation: "GET /projects/{id}/seo",
  },
  {
    command: "seo project-add-page",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/pages",
  },
  {
    command: "seo project-create-scope",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/scopes",
  },
  {
    command: "seo project-update-scope",
    usage: "PROJECT_ID SCOPE_ID",
    operation: "PUT /projects/{id}/seo/scopes/{scopeId}",
  },
  {
    command: "seo project-import-report",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/imports",
  },
  {
    command: "seo project-analyze",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/analyses",
  },
  {
    command: "seo project-save-keyword",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/keywords",
  },
  {
    command: "seo project-save-competitor",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/competitors",
  },
  {
    command: "seo project-create-task",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/actions",
  },
  {
    command: "seo project-create-monitor",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/monitors",
  },
  {
    command: "seo project-review-action",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/actions/reviews",
  },
  {
    command: "seo project-properties",
    usage: "PROJECT_ID",
    operation: "GET /projects/{id}/seo/statistics/properties",
  },
  {
    command: "seo project-sync-statistics",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/statistics/sync",
  },
  {
    command: "seo project-record-change",
    usage: "PROJECT_ID",
    operation: "POST /projects/{id}/seo/page-changes",
  },
  {
    command: "seo project-set-brand-terms",
    usage: "PROJECT_ID",
    operation: "PUT /projects/{id}/seo/brand-terms",
  },
  {
    command: "seo project-brief",
    usage: "PROJECT_ID",
    operation: "GET /projects/{id}/seo/brief",
  },
  {
    command: "seo project-save-brief",
    usage: "PROJECT_ID",
    operation: "PUT /projects/{id}/seo/brief",
  },
  {
    command: "seo project-suggest-brief",
    usage: "PROJECT_ID",
    operation: "GET /projects/{id}/seo/brief/suggestion",
  },
  {
    command: "seo project-console-exports",
    usage: "PROJECT_ID TASK_ID",
    operation: "GET /projects/{id}/seo/console-exports/{taskId}",
  },
  {
    command: "seo project-import-console-export",
    usage: "PROJECT_ID TASK_ID",
    operation: "POST /projects/{id}/seo/console-exports/{taskId}",
  },
  // SOKD-375: Drive. Most commands pick the Drive with --query scope=me, or
  // scope=org plus organizationId; tables take --organization-slug.
  {
    command: "drive search",
    usage:
      "--query scope=me|org [--query organizationId=ORG_ID] [--query q=TEXT]",
    operation: "GET /drive/search",
  },
  {
    command: "drive files",
    usage:
      "--query scope=me|org [--query organizationId=ORG_ID] [--query folder=PATH]",
    operation: "GET /drive/files",
  },
  {
    command: "drive recents",
    usage: "--query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/recents",
  },
  {
    command: "drive get",
    usage: "RESOURCE_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/resources/{id}",
  },
  {
    command: "drive related",
    usage: "RESOURCE_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/resources/{id}/related",
  },
  {
    command: "drive folders",
    usage: "--query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/folders",
  },
  {
    command: "drive create-folder",
    usage: "--input-json JSON",
    operation: "POST /drive/folders",
  },
  {
    command: "drive rename-folder",
    usage: "--input-json JSON",
    operation: "PATCH /drive/folders/rename",
  },
  {
    command: "drive delete-folder",
    usage: "--input-json JSON",
    operation: "DELETE /drive/folders/delete",
    body: true,
  },
  {
    command: "drive move",
    usage: "--input-json JSON",
    operation: "PATCH /drive/files/move",
  },
  {
    command: "drive rename",
    usage: "--input-json JSON",
    operation: "PATCH /drive/files/rename",
  },
  {
    command: "drive delete",
    usage: "--input-json JSON",
    operation: "DELETE /drive/files/delete",
    body: true,
  },
  {
    command: "drive update-metadata",
    usage:
      "RESOURCE_ID --query scope=me|org [--query organizationId=ORG_ID] --input-json JSON",
    operation: "PATCH /drive/resources/{id}/metadata",
  },
  {
    command: "drive decide-suggestion",
    usage:
      "RESOURCE_ID SUGGESTION_ID --query scope=me|org [--query organizationId=ORG_ID] --input-json JSON",
    operation: "POST /drive/resources/{id}/suggestions/{suggestionId}/decision",
  },
  {
    command: "drive select",
    usage: "--input-json JSON",
    operation: "POST /drive/resources/selection-token",
  },
  {
    command: "drive update-metadata-batch",
    usage: "--input-json JSON",
    operation: "POST /drive/resources/metadata-batch",
  },
  {
    command: "drive reindex",
    usage: "RESOURCE_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "POST /drive/resources/{id}/reindex",
    noBody: true,
  },
  {
    command: "drive add-google-sheet",
    usage: "--input-json JSON",
    operation: "POST /drive/files/google-sheets",
  },
  {
    command: "drive google-sheet",
    usage: "RESOURCE_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/resources/{id}/google-sheet",
  },
  {
    command: "drive refresh-google-sheet",
    usage: "RESOURCE_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "POST /drive/resources/{id}/google-sheet/refresh",
    noBody: true,
  },
  {
    command: "drive tasks",
    usage: "--query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/tasks",
  },
  {
    command: "drive copy-task-file",
    usage: "--input-json JSON",
    operation: "POST /drive/tasks/copy",
  },
  {
    command: "drive labels",
    usage: "--query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/labels",
  },
  {
    command: "drive create-label",
    usage: "--input-json JSON",
    operation: "POST /drive/labels",
  },
  {
    command: "drive update-label",
    usage: "LABEL_ID --input-json JSON",
    operation: "PATCH /drive/labels/{id}",
  },
  {
    command: "drive collections",
    usage: "--query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/collections",
  },
  {
    command: "drive create-collection",
    usage: "--input-json JSON",
    operation: "POST /drive/collections",
  },
  {
    command: "drive update-collection",
    usage: "COLLECTION_ID --input-json JSON",
    operation: "PATCH /drive/collections/{id}",
  },
  {
    command: "drive delete-collection",
    usage: "COLLECTION_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "DELETE /drive/collections/{id}",
  },
  {
    command: "drive share",
    usage:
      "--query scope=me|org [--query organizationId=ORG_ID] [--query resourceId=ID | --query folderPath=PATH]",
    operation: "GET /drive/shares",
  },
  {
    command: "drive unshare",
    usage: "SHARE_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "DELETE /drive/shares/{id}",
  },
  {
    command: "drive tables",
    usage: "[--organization-slug WORKSPACE_SLUG]",
    operation: "GET /drive/tables",
  },
  {
    command: "drive create-table",
    usage: "--input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /drive/tables",
  },
  {
    command: "drive table",
    usage: "TABLE_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /drive/tables/{id}",
  },
  {
    command: "drive update-table",
    usage: "TABLE_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "PATCH /drive/tables/{id}",
  },
  {
    command: "drive query-table",
    usage: "TABLE_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /drive/tables/{id}/query",
  },
  {
    command: "drive edit-rows",
    usage: "TABLE_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /drive/tables/{id}/rows",
  },
  {
    command: "drive save-view",
    usage: "TABLE_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /drive/tables/{id}/views",
  },
  {
    command: "drive undo-table",
    usage: "TABLE_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /drive/tables/{id}/undo",
  },
  {
    command: "drive table-history",
    usage: "TABLE_ID [--organization-slug WORKSPACE_SLUG]",
    operation: "GET /drive/tables/{id}/history",
  },
  {
    command: "drive enrich-table",
    usage: "TABLE_ID --input-json JSON [--organization-slug WORKSPACE_SLUG]",
    operation: "POST /drive/tables/{id}/enrich",
  },
  {
    command: "drive data-rooms",
    usage: "--query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/data-rooms",
  },
  {
    command: "drive create-data-room",
    usage: "--input-json JSON",
    operation: "POST /drive/data-rooms",
  },
  {
    command: "drive open-questions",
    usage: "--query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/data-rooms/questions",
  },
  {
    command: "drive data-room",
    usage: "ROOM_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/data-rooms/{id}",
  },
  {
    command: "drive close-data-room",
    usage: "ROOM_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "DELETE /drive/data-rooms/{id}",
  },
  {
    command: "drive remove-data-room-member",
    usage:
      "ROOM_ID MEMBER_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "DELETE /drive/data-rooms/{id}/members/{memberId}",
  },
  {
    command: "drive data-room-events",
    usage: "ROOM_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/data-rooms/{id}/events",
  },
  {
    command: "drive data-room-questions",
    usage: "ROOM_ID --query scope=me|org [--query organizationId=ORG_ID]",
    operation: "GET /drive/data-rooms/{id}/questions",
  },
  {
    command: "drive order-data-room",
    usage: "ROOM_ID --input-json JSON",
    operation: "PUT /drive/data-rooms/{id}/order",
  },
  {
    command: "drive set-data-room-colleagues",
    usage: "ROOM_ID --input-json JSON",
    operation: "PUT /drive/data-rooms/{id}/colleagues",
  },
] as const satisfies readonly CliCommandCatalogEntry[];

type CliCommand = (typeof CLI_COMMAND_CATALOG)[number]["command"];

export const CLI_COMMANDS: readonly CliCommand[] = CLI_COMMAND_CATALOG.map(
  (entry) => entry.command,
);

export function formatCliCommandHelpLines(): string {
  return CLI_COMMAND_CATALOG.map((entry) =>
    entry.usage
      ? `  sokosumi ${entry.command} ${entry.usage}`
      : `  sokosumi ${entry.command}`,
  ).join("\n");
}

export function formatUnknownCommandUsage(): string {
  return `Usage: sokosumi ${CLI_COMMANDS.join(" | ")}`;
}
