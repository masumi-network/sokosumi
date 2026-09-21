import { ORGANIZATION_LOGO_ALLOWED_MIME_TYPES } from "@sokosumi/utils";

/**
 * Max time to wait for the logo upload before releasing the UI.
 * Prevents a stalled network or hung endpoint from trapping the dialog open.
 */
export const ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS = 120_000;

/** Comma-separated accept string for HTML file input / FileUpload. */
export const ORGANIZATION_LOGO_ACCEPT =
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES.join(",");
