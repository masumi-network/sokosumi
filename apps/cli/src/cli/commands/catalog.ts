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
    command: "users approve-coworker-access",
    usage: "me ACCESS_ID --input-json '{}'",
    operation: "POST /users/{id}/coworker-access/{accessId}/approve",
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
    command: "users grant-vendor",
    usage: "me --input-json JSON",
    operation: "POST /users/{id}/vendor-grants",
  },
  {
    command: "users approve-vendor-grant",
    usage: "me GRANT_ID --input-json '{}'",
    operation: "POST /users/{id}/vendor-grants/{grantId}/approve",
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
    command: "organizations approve-coworker-access",
    usage: "ORGANIZATION_ID ACCESS_ID --input-json '{}'",
    operation: "POST /organizations/{id}/coworker-access/{accessId}/approve",
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
    command: "organizations grant-vendor",
    usage: "ORGANIZATION_ID --input-json JSON",
    operation: "POST /organizations/{id}/vendor-grants",
  },
  {
    command: "organizations approve-vendor-grant",
    usage: "ORGANIZATION_ID GRANT_ID --input-json '{}'",
    operation: "POST /organizations/{id}/vendor-grants/{grantId}/approve",
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
