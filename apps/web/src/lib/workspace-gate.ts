/** Authenticated chrome-free route for users who are not workspace-ready. */
export const WORKSPACE_GATE_PATH = "/setup";

/** The gate, carrying the page the user asked for so setup can end there. */
export function workspaceGatePath(requestedPath: string): string {
  if (!requestedPath || requestedPath === "/") {
    return WORKSPACE_GATE_PATH;
  }
  return `${WORKSPACE_GATE_PATH}?${new URLSearchParams({ next: requestedPath })}`;
}

export function isWorkspaceReady(
  gate: string | null | undefined,
): gate is "ready" {
  return gate === "ready";
}
