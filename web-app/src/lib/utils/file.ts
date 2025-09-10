export function isUrlString(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

export function isUrlArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

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

export function isImageUrl(url: string): boolean {
  const ext = getExtensionFromUrl(url);
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext);
}

export const FILE_EXTENSION_ALLOWLIST = new Set([
  // images
  "png",
  "jpg",
  "jpeg",
  "webp",
  "svg",
  "gif",
  // docs
  "pdf",
  "txt",
  "md",
  "rtf",
  "csv",
  "json",
  "xml",
  // office
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  // archives
  "zip",
  "tar",
  "gz",
  // media
  "mp3",
  "mp4",
  "wav",
  "mov",
]);

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function isFileLikeUrl(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.hash) return false;
    const ext = getExtensionFromUrl(url);
    if (!ext) return false;
    return FILE_EXTENSION_ALLOWLIST.has(ext);
  } catch {
    return false;
  }
}
