/**
 * Chooses the thin Ink screen. Auth is unresolved until refresh finishes,
 * so we do not flash sign-in while a refresh token can still mint access.
 */
export function selectBootRoute({ authResolved, hasAuth } = {}) {
  if (!authResolved) return "boot";
  return hasAuth ? "signed-in" : "auth";
}

export async function resolveInitialAuth({ authManager } = {}) {
  try {
    const token = await authManager.getAuthTokenAsync();
    return Boolean(token);
  } catch {
    return false;
  }
}
