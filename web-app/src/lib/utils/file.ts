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
