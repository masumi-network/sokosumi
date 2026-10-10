/** Handle as the row shows it: one leading @, or nothing. */
export function formatSocialHandle(handle: string | null): string | null {
  if (!handle) return null;
  return handle.startsWith("@") ? handle : `@${handle}`;
}

/**
 * Name first when we have one; otherwise the handle. Matches the native
 * preview's preference without stripping @ from a handle-only row.
 */
export function socialPostAccountLabel(
  connection:
    | {
        displayName: string | null;
        externalHandle: string | null;
      }
    | null
    | undefined,
  fallback: string,
): string {
  const handle = formatSocialHandle(connection?.externalHandle ?? null);
  return connection?.displayName?.trim() || handle || fallback;
}
