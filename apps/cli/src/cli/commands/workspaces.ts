import type { OrganizationWorkspace } from "../../api/models/organization-workspace.js";
import { fetchOrganizationWorkspaces } from "../../api/services/organization-workspace-service.js";
import {
  type CommandContext,
  writeJson,
  writeText,
} from "./command-helpers.js";

export interface WorkspacesCommandContext extends CommandContext {
  subcommand?: string;
}

function printWorkspaces(
  stdout: CommandContext["stdout"],
  workspaces: readonly OrganizationWorkspace[],
): void {
  if (!workspaces.length) {
    writeText(stdout, ["No organization workspaces found."]);
    return;
  }
  const lines = ["Organization workspaces"];
  for (const workspace of workspaces) {
    lines.push(
      `${workspace.name || "Unnamed Organization Workspace"} [organization: ${workspace.organizationId}]`,
    );
    if (workspace.slug) lines.push(`  slug: ${workspace.slug}`);
    if (workspace.role) lines.push(`  role: ${workspace.role}`);
  }
  writeText(stdout, lines);
}

export async function runWorkspacesCommand({
  client,
  stdout,
  json = false,
  signal,
  subcommand,
}: WorkspacesCommandContext): Promise<void> {
  // Dispatch requires the explicit workspaces list form; bare workspaces is rejected.
  if (subcommand !== "list") throw new Error("Usage: sokosumi workspaces list");
  const { organizationWorkspaces } = await fetchOrganizationWorkspaces(
    client,
    signal,
  );
  if (json) writeJson(stdout, { workspaces: organizationWorkspaces });
  else printWorkspaces(stdout, organizationWorkspaces);
}
