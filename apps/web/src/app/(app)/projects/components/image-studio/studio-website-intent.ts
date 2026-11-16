// The Studio page remounts when the project selector switches scope.
let projectAwaitingWebsiteDraft: string | null = null;

export function requestStudioWebsiteDraftOnOpen(projectId: string) {
  projectAwaitingWebsiteDraft = projectId;
}

export function consumeStudioWebsiteDraftRequest(projectId: string): boolean {
  if (projectAwaitingWebsiteDraft !== projectId) return false;
  projectAwaitingWebsiteDraft = null;
  return true;
}
