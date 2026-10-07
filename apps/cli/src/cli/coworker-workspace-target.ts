import type { CoreHttpClient } from "../api/http-client.js";
import type { CoworkerWorkspaceAccessTarget } from "../api/services/coworker-service.js";
import { fetchOrganizationWorkspaces } from "../api/services/organization-workspace-service.js";
import { fetchUserIdentity } from "../api/services/user-identity-service.js";
import {
  type CommandOptions,
  optionBoolean,
  optionString,
} from "./commands/command-helpers.js";
import {
  requireOrganizationWorkspacesForRegistration,
  requireSelectedOrganizationWorkspace,
} from "./registration-authority.js";

export async function selectCoworkerWorkspaceTarget(
  client: CoreHttpClient,
  options: CommandOptions | undefined,
  signal?: AbortSignal,
) {
  if (optionBoolean(options, "personal")) {
    if (optionString(options, "workspace-id") !== undefined)
      throw new Error("--personal and --workspace-id cannot be used together");
    const user = await fetchUserIdentity(client, signal);
    return {
      name: "Personal Workspace",
      organizationId: null,
      target: { userId: user.id } satisfies CoworkerWorkspaceAccessTarget,
      connectionOptions: "--personal",
    };
  }
  const { organizationWorkspaces } = await fetchOrganizationWorkspaces(
    client,
    signal,
  );
  requireOrganizationWorkspacesForRegistration(organizationWorkspaces);
  const workspace = requireSelectedOrganizationWorkspace(
    organizationWorkspaces,
    optionString(options, "workspace-id"),
  );
  return {
    ...workspace,
    target: {
      organizationId: workspace.organizationId,
    } satisfies CoworkerWorkspaceAccessTarget,
    connectionOptions: `--workspace-id ${workspace.organizationId}`,
  };
}
