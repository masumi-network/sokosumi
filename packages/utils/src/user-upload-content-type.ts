/** Canonical allowlist for user file uploads (kept in sync with Core POST /files). */
export const USER_UPLOAD_ALLOWED_CONTENT_TYPES = [
  "application/gzip",
  "application/json",
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/x-tar",
  "application/zip",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

/** Set of {@link USER_UPLOAD_ALLOWED_CONTENT_TYPES} for fast membership checks. */
export const USER_UPLOAD_ALLOWED_CONTENT_TYPE_SET = new Set<string>(
  USER_UPLOAD_ALLOWED_CONTENT_TYPES,
);

/** Extension → MIME, only for entries in {@link USER_UPLOAD_ALLOWED_CONTENT_TYPES}. */
const EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  gz: "application/gzip",
  heic: "image/heic",
  heif: "image/heic",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  m4a: "audio/m4a",
  markdown: "text/markdown",
  md: "text/markdown",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpga: "audio/mpeg",
  mpeg: "audio/mpeg",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  qt: "video/quicktime",
  svg: "image/svg+xml",
  tar: "application/x-tar",
  txt: "text/plain",
  wav: "audio/wav",
  weba: "audio/webm",
  webm: "video/webm",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

/**
 * Lowercases, strips parameters, and maps legacy `image/jpg` to `image/jpeg`
 * so checks align with {@link USER_UPLOAD_ALLOWED_CONTENT_TYPES}.
 */
export function normalizeUserUploadContentType(contentType: string): string {
  const base = contentType.trim().split(";")[0]!.trim().toLowerCase();
  return base === "image/jpg" ? "image/jpeg" : base;
}

/** True when `contentType` is a non-empty, specific entry in the upload allowlist. */
export function isUserUploadAllowedContentType(contentType: string): boolean {
  const normalized = normalizeUserUploadContentType(contentType);
  if (normalized === "" || normalized === "application/octet-stream") {
    return false;
  }
  return USER_UPLOAD_ALLOWED_CONTENT_TYPE_SET.has(normalized);
}

function inferContentTypeFromFilename(filename: string): string | undefined {
  const base = filename.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) {
    return undefined;
  }
  const ext = base.slice(dot + 1).toLowerCase();
  const mime = EXTENSION_TO_CONTENT_TYPE[ext];
  if (!mime || !USER_UPLOAD_ALLOWED_CONTENT_TYPE_SET.has(mime)) {
    return undefined;
  }
  return mime;
}

/**
 * Resolves the effective upload content type: trusts an allowed browser-reported
 * type, or when it is empty / generic (`application/octet-stream`), infers from
 * the file name extension so direct uploads match server + Vercel Blob constraints.
 */
export function resolveUserUploadContentType(
  filename: string,
  declaredContentType: string,
): string | null {
  const normalized = normalizeUserUploadContentType(declaredContentType);
  if (USER_UPLOAD_ALLOWED_CONTENT_TYPE_SET.has(normalized)) {
    return normalized;
  }
  if (normalized === "" || normalized === "application/octet-stream") {
    return inferContentTypeFromFilename(filename) ?? null;
  }
  return null;
}
