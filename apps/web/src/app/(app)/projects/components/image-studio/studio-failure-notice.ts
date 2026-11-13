function normalizeFailureText(text: string): string {
  return text
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/[\p{P}\s]+$/u, "")
    .toLowerCase();
}

export function getDistinctProviderError(
  reason: string,
  error: string | null,
): string | null {
  const normalizedError = normalizeFailureText(error ?? "");
  return normalizedError && normalizedError !== normalizeFailureText(reason)
    ? error
    : null;
}
