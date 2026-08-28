export type FilesViewMode = "list" | "grid";

export const FILES_VIEW_MODE_COOKIE_NAME = "files_view_mode";
export const FILES_VIEW_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** List is the default when the user has never chosen a preference. */
export const DEFAULT_FILES_VIEW_MODE: FilesViewMode = "list";

export function parseFilesViewMode(
  value: string | null | undefined,
): FilesViewMode | null {
  if (value === "list" || value === "grid") {
    return value;
  }

  return null;
}

/** Read `files_view_mode` from a raw Cookie header / `document.cookie` string. */
export function parseFilesViewModeCookieHeader(
  documentCookie: string,
): FilesViewMode | null {
  const match = documentCookie.match(
    new RegExp(`(?:^|;\\s*)${FILES_VIEW_MODE_COOKIE_NAME}=([^;]*)`),
  );

  return parseFilesViewMode(match?.[1]);
}

/**
 * Client resolve for Files Recents/Browse: cookie wins; otherwise list.
 */
export function resolveFilesViewModeFromClientCookie(
  documentCookie: string,
): FilesViewMode {
  return (
    parseFilesViewModeCookieHeader(documentCookie) ?? DEFAULT_FILES_VIEW_MODE
  );
}

/** Mobile viewports always render list; saved preference stays for desktop. */
export function effectiveFilesViewMode(
  preferred: FilesViewMode,
  isMobile: boolean,
): FilesViewMode {
  return isMobile ? "list" : preferred;
}

export function serializeFilesViewModeCookie(mode: FilesViewMode): string {
  return `${FILES_VIEW_MODE_COOKIE_NAME}=${mode}; path=/; max-age=${FILES_VIEW_MODE_COOKIE_MAX_AGE}`;
}
