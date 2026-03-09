export const DEPLOYMENT_REFRESH_KEY = "deployment-refresh-retry";

const CHUNK_PATTERNS = [
  /loading chunk/i,
  /chunkloaderror/i,
  /loading css chunk/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
];

export function isChunkLoadError(message: string): boolean {
  return CHUNK_PATTERNS.some((p) => p.test(message));
}

export function performDeploymentRefresh(): void {
  try {
    sessionStorage.setItem(DEPLOYMENT_REFRESH_KEY, "true");
    window.location.reload();
  } catch {
    window.location.reload();
  }
}
