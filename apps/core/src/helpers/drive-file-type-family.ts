/**
 * Stable mime/extension families for Drive type sort.
 * Documented in OpenAPI via drive-list-sort.schema descriptions.
 */
export const DRIVE_FILE_TYPE_FAMILIES = [
  "image",
  "video",
  "audio",
  "pdf",
  "document",
  "spreadsheet",
  "presentation",
  "archive",
  "code",
  "text",
  "other",
] as const;

export type DriveFileTypeFamily = (typeof DRIVE_FILE_TYPE_FAMILIES)[number];

const EXTENSION_FAMILY: Record<string, DriveFileTypeFamily> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  ico: "image",
  heic: "image",
  avif: "image",
  bmp: "image",
  tiff: "image",
  tif: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  avi: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  aac: "audio",
  flac: "audio",
  ogg: "audio",
  m4a: "audio",
  pdf: "pdf",
  doc: "document",
  docx: "document",
  odt: "document",
  rtf: "document",
  pages: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  numbers: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  odp: "presentation",
  key: "presentation",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  js: "code",
  ts: "code",
  tsx: "code",
  jsx: "code",
  py: "code",
  go: "code",
  rs: "code",
  java: "code",
  kt: "code",
  c: "code",
  cpp: "code",
  h: "code",
  cs: "code",
  rb: "code",
  php: "code",
  sh: "code",
  sql: "code",
  json: "code",
  yaml: "code",
  yml: "code",
  toml: "code",
  xml: "code",
  html: "code",
  css: "code",
  scss: "code",
  md: "text",
  txt: "text",
  log: "text",
};

function extensionOf(name: string): string {
  const base = name.includes("/") ? (name.split("/").pop() ?? name) : name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

function familyFromMime(mimeType: string): DriveFileTypeFamily | null {
  const mime = mimeType.toLowerCase().trim();
  if (!mime) {
    return null;
  }
  if (mime === "application/pdf") {
    return "pdf";
  }
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (mime.startsWith("video/")) {
    return "video";
  }
  if (mime.startsWith("audio/")) {
    return "audio";
  }
  if (
    mime === "text/plain" ||
    mime === "text/markdown" ||
    mime === "text/csv"
  ) {
    return mime === "text/csv" ? "spreadsheet" : "text";
  }
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "application/vnd.ms-excel"
  ) {
    return "spreadsheet";
  }
  if (
    mime.includes("presentation") ||
    mime.includes("powerpoint") ||
    mime === "application/vnd.ms-powerpoint"
  ) {
    return "presentation";
  }
  if (
    mime.includes("word") ||
    mime.includes("document") ||
    mime === "application/msword" ||
    mime === "application/rtf"
  ) {
    return "document";
  }
  if (
    mime.includes("zip") ||
    mime.includes("compressed") ||
    mime.includes("tar") ||
    mime.includes("gzip")
  ) {
    return "archive";
  }
  if (
    mime.startsWith("text/") ||
    mime.includes("javascript") ||
    mime.includes("json") ||
    mime.includes("xml")
  ) {
    return mime.startsWith("text/") && !mime.includes("javascript")
      ? "text"
      : "code";
  }
  return null;
}

/**
 * Map a file name (and optional mime) to a stable type-family bucket.
 * Mime wins when it maps; otherwise extension; else `other`.
 */
export function driveFileTypeFamily(
  name: string,
  mimeType?: string | null,
): DriveFileTypeFamily {
  if (mimeType) {
    const fromMime = familyFromMime(mimeType);
    if (fromMime) {
      return fromMime;
    }
  }
  const ext = extensionOf(name);
  if (ext && EXTENSION_FAMILY[ext]) {
    return EXTENSION_FAMILY[ext];
  }
  return "other";
}

export function driveFileTypeFamilyRank(family: DriveFileTypeFamily): number {
  return DRIVE_FILE_TYPE_FAMILIES.indexOf(family);
}

export function compareDriveFileTypeFamily(
  leftName: string,
  rightName: string,
  leftMime?: string | null,
  rightMime?: string | null,
): number {
  const left = driveFileTypeFamily(leftName, leftMime);
  const right = driveFileTypeFamily(rightName, rightMime);
  if (left !== right) {
    return driveFileTypeFamilyRank(left) - driveFileTypeFamilyRank(right);
  }
  return 0;
}
