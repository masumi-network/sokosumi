export function getExtensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").pop() ?? "";
    const parts = last.split(".");
    return parts.length > 1 ? (parts.pop() as string).toLowerCase() : "";
  } catch {
    const last = url.split("/").pop() ?? "";
    const parts = last.split(".");
    return parts.length > 1 ? (parts.pop() as string).toLowerCase() : "";
  }
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export const FILE_EXTENSION_ALLOWLIST = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "svg",
  "gif",
  "pdf",
  "txt",
  "md",
  "rtf",
  "csv",
  "json",
  "xml",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
  "tar",
  "gz",
  "mp3",
  "mp4",
  "wav",
  "mov",
]);

export function isFileLikeUrl(url: string): boolean {
  if (!isHttpUrl(url)) {
    return false;
  }
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return false;
    }
    if (u.hash) {
      return false;
    }

    // Special case: /deliverables/ paths are file-like even without an extension
    if (u.pathname.includes("/deliverables/")) {
      return true;
    }

    const ext = getExtensionFromUrl(url);
    if (!ext) {
      return false;
    }
    return FILE_EXTENSION_ALLOWLIST.has(ext);
  } catch {
    return false;
  }
}

/** Returns the last path segment of the URL pathname, or null if none. */
export function getUrlBasename(url: string): string | null {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() ?? "";
    return last || null;
  } catch {
    return null;
  }
}

export function isUrlString(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

export function isUrlArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
]);

export function isImageUrl(url: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtensionFromUrl(url));
}

export function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, "_");
}
