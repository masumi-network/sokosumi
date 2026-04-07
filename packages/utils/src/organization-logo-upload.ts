/** Allowed MIME types for organization logo uploads (server-enforced). */
export const ORGANIZATION_LOGO_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

/** Max file size in bytes (2 MB) for organization logo uploads. */
export const ORGANIZATION_LOGO_MAX_SIZE_BYTES = 2 * 1024 * 1024;

export function isOrganizationLogoAllowedContentType(
  contentType: string,
): boolean {
  const normalized = contentType.trim().toLowerCase();
  return (ORGANIZATION_LOGO_ALLOWED_MIME_TYPES as readonly string[]).includes(
    normalized,
  );
}
