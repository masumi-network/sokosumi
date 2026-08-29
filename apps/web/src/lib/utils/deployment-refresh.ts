export const DEPLOYMENT_REFRESH_KEY = "deployment-refresh-retry";

const DEPLOYMENT_REFRESH_PARAM = "deployment-refresh";

const STALE_DEPLOYMENT_PATTERNS = [
  /failed to find server action/i,
  /server action .+ was not found on the server/i,
  /older or newer deployment/i,
  /loading chunk failed/i,
  /chunkloaderror/i,
  /dynamic import fail/i,
  /failed to fetch dynamically imported/i,
];

export function isStaleDeploymentError(message: string): boolean {
  return STALE_DEPLOYMENT_PATTERNS.some((p) => p.test(message));
}

export function hasDeploymentRefreshGuard(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(DEPLOYMENT_REFRESH_KEY) === "true") return true;
  } catch {
    // sessionStorage can throw in private mode / some WebViews
  }
  try {
    return new URL(window.location.href).searchParams.has(
      DEPLOYMENT_REFRESH_PARAM,
    );
  } catch {
    return false;
  }
}

export function performDeploymentRefresh(): void {
  try {
    sessionStorage.setItem(DEPLOYMENT_REFRESH_KEY, "true");
    window.location.reload();
    return;
  } catch {}
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(DEPLOYMENT_REFRESH_PARAM, "1");
    window.location.href = url.toString();
  } catch {
    // Avoid reload when we can't set any guard to prevent infinite reload loop.
  }
}
