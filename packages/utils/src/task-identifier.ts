/**
 * Builds a Linear-style short id (`SOK-12`) from a project prefix and task
 * number. Null when either half is missing (no project, or unnumbered).
 */
export function formatTaskIdentifier(
  projectIdentifier: string | null | undefined,
  number: number | null | undefined,
): string | null {
  if (!projectIdentifier || number == null) {
    return null;
  }
  return `${projectIdentifier}-${number}`;
}
