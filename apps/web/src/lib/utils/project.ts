export function normalizeOptionalProjectId(
  projectId?: string | null,
): string | null | undefined {
  if (typeof projectId === "undefined") {
    return undefined;
  }

  const trimmedProjectId = projectId?.trim();
  return trimmedProjectId ? trimmedProjectId : null;
}
