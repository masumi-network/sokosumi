export const DEPLOYMENT_REFRESH_KEY = "deployment-refresh-retry";

const STALE_DEPLOYMENT_PATTERNS = [
  /failed to find server action/i,
  /older or newer deployment/i,
  /loading chunk failed/i,
  /chunkloaderror/i,
  /dynamic import fail/i,
  /failed to fetch dynamically imported/i,
];

export function isStaleDeploymentError(message: string): boolean {
  return STALE_DEPLOYMENT_PATTERNS.some((p) => p.test(message));
}

export function performDeploymentRefresh(): void {
  try {
    sessionStorage.setItem(DEPLOYMENT_REFRESH_KEY, "true");
    window.location.reload();
  } catch {
    window.location.reload();
  }
}
