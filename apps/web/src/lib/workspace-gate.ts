import type { UserWorkspaces } from "@sokosumi/core-client";

/** What Web's gate and account pages need to know about a person's workspaces. */
export interface WorkspaceAccess {
  /**
   * `ready` with any workspace; `pending-invites` with none but pending
   * organization invitations; `identity-onboarding` otherwise.
   */
  gate: "ready" | "pending-invites" | "identity-onboarding";
  hasPersonalWorkspace: boolean;
  hasOrganizationMembership: boolean;
}

/** Derives the gate from Core's workspaces list (ADR 0051). */
export function workspaceAccessFrom({
  workspaces,
  pendingInvitationCount,
}: Pick<UserWorkspaces, "pendingInvitationCount"> & {
  workspaces: readonly Pick<UserWorkspaces["workspaces"][number], "kind">[];
}): WorkspaceAccess {
  return {
    gate:
      workspaces.length > 0
        ? "ready"
        : pendingInvitationCount > 0
          ? "pending-invites"
          : "identity-onboarding",
    hasPersonalWorkspace: workspaces.some(({ kind }) => kind === "personal"),
    hasOrganizationMembership: workspaces.some(
      ({ kind }) => kind === "organization",
    ),
  };
}

/** Authenticated chrome-free route for users who are not workspace-ready. */
export const WORKSPACE_GATE_PATH = "/setup";

/** The gate, carrying the page the user asked for so setup can end there. */
export function workspaceGatePath(requestedPath: string): string {
  if (!requestedPath || requestedPath === "/") {
    return WORKSPACE_GATE_PATH;
  }
  return `${WORKSPACE_GATE_PATH}?${new URLSearchParams({ next: requestedPath })}`;
}

/** First-run step after setup that offers the personal Soko Bot. */
export const SETUP_ASSISTANT_PATH = "/setup/assistant";

/** Its optional follow-up: connect mail and calendar, then the chat. */
export const SETUP_ASSISTANT_CONNECT_PATH = "/setup/assistant/connect";

function withNext(path: string, next: string): string {
  if (!next || next === "/") {
    return path;
  }
  return `${path}?${new URLSearchParams({ next })}`;
}

/** Where setup ends for someone who just got a workspace. */
export function setupAssistantPath(next: string): string {
  return withNext(SETUP_ASSISTANT_PATH, next);
}

export function setupAssistantConnectPath(next: string): string {
  return withNext(SETUP_ASSISTANT_CONNECT_PATH, next);
}

export function isWorkspaceReady(
  gate: string | null | undefined,
): gate is "ready" {
  return gate === "ready";
}
