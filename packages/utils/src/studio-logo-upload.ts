export const STUDIO_LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export function isStudioLogoMime(contentType: string): boolean {
  return STUDIO_LOGO_MIME_TYPES.some((type) => type === contentType);
}
