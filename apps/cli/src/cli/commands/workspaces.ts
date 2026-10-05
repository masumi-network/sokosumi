import type { OrganizationWorkspace } from "../../api/models/organization-workspace.js";
import {
  fetchOrganizationCallerSeat,
  fetchOrganizationWorkspaces,
} from "../../api/services/organization-workspace-service.js";
import { fetchPersonalWorkspaceAccess } from "../../api/services/personal-workspace-service.js";
import {
  type CommandContext,
  type CommandOptions,
  optionBoolean,
  writeJson,
  writeText,
} from "./command-helpers.js";

export interface WorkspacesCommandContext extends CommandContext {
  subcommand?: string;
  positionalId?: string;
  options?: CommandOptions;
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
  positionalId,
  options,
}: WorkspacesCommandContext): Promise<void> {
  if (optionBoolean(options, "personal")) {
    if (subcommand !== "list" || positionalId !== undefined)
      throw new Error("Use workspaces list --personal");
    const hasPersonalWorkspace = await fetchPersonalWorkspaceAccess(
      client,
      signal,
    );
    if (json) writeJson(stdout, { hasPersonalWorkspace });
    else
      writeText(stdout, [
        hasPersonalWorkspace
          ? "Your personal Workspace exists."
          : "No personal Workspace exists. Use coworkers register --personal or connect --personal to create it.",
      ]);
    return;
  }
  if (subcommand === "check") {
    const organizationId = positionalId?.trim();
    if (!organizationId)
      throw new Error("Usage: sokosumi workspaces check ORGANIZATION_ID");
    const taskSeatEligible = await fetchOrganizationCallerSeat(
      client,
      organizationId,
      signal,
    );
    if (json) writeJson(stdout, { organizationId, taskSeatEligible });
    else
      writeText(stdout, [
        `Workspace ${organizationId}`,
        taskSeatEligible
          ? "The organization Seat policy allows your account to use Tasks."
          : "Your account needs an assigned Seat to use organization Tasks.",
        taskSeatEligible
          ? undefined
          : "Ask an organization owner or admin to assign you a Seat in Sokosumi Web.",
        "This check does not confirm credits or runtime setup.",
      ]);
    return;
  }
  if (subcommand !== "list" || positionalId !== undefined)
    throw new Error(
      "Usage: sokosumi workspaces list | workspaces check ORGANIZATION_ID",
    );
  const { organizationWorkspaces } = await fetchOrganizationWorkspaces(
    client,
    signal,
  );
  if (json) writeJson(stdout, { workspaces: organizationWorkspaces });
  else printWorkspaces(stdout, organizationWorkspaces);
}
