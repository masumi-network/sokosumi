export function formatComposerHandle(handle: string | null): string {
  if (!handle) return "";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

export function accountChipLabel(
  connection: {
    displayName: string | null;
    externalHandle: string | null;
  },
  fallback: string,
): string {
  return (
    connection.displayName?.trim() ||
    formatComposerHandle(connection.externalHandle) ||
    fallback
  );
}
