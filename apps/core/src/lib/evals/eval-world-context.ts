import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Marks the work an eval lane's turn does, so the clients underneath it
 * (Exa, Composio) answer from the eval world instead of reaching outside.
 * A client deep in the call stack has no workspace to check; this tells it.
 */
const evalWorld = new AsyncLocalStorage<{ workspaceId: string }>();

export function runInEvalWorld<T>(
  workspaceId: string,
  run: () => Promise<T>,
): Promise<T> {
  return evalWorld.run({ workspaceId }, run);
}

/** The eval workspace whose turn this is, or null outside one. */
export function evalWorldWorkspace(): string | null {
  return evalWorld.getStore()?.workspaceId ?? null;
}
