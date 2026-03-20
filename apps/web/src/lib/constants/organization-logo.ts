/** Allowed MIME types for organization logo uploads. */
export const ORGANIZATION_LOGO_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

/** Max file size in bytes (2 MB). */
export const ORGANIZATION_LOGO_MAX_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Max time to wait for the logo server action before releasing the UI.
 * Prevents a stalled network or hung endpoint from trapping the dialog open.
 */
export const ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS = 120_000;

/** Comma-separated accept string for HTML file input / FileUpload. */
export const ORGANIZATION_LOGO_ACCEPT =
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES.join(",");
