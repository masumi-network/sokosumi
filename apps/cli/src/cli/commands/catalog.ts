export type CoreMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface CliCommandCatalogEntry {
  readonly command: string;
  readonly usage: string;
  /**
   * The Core operation (`METHOD /path`, as in apps/core/agent-surface) a row
   * without a bespoke handler runs: positionals fill the path parameters.
   */
  readonly operation?: `${CoreMethod} /${string}`;
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
