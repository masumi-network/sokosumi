/** Authenticated chrome-free route for users who are not workspace-ready. */
export const WORKSPACE_GATE_PATH = "/workspace-gate";

export function isWorkspaceReady(
  gate: string | null | undefined,
): gate is "ready" {
  return gate === "ready";
}
