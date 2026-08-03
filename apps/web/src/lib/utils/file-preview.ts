import { getExtensionFromUrl } from "@sokosumi/utils";

// Office files need the Microsoft viewer to embed; PDFs embed natively.
const OFFICE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
]);
const OFFICE_MEDIA_TYPE_EXTENSION: Record<string, string> = {
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const TEXT_PREVIEW_EXTENSIONS = new Set(["txt", "md", "markdown"]);
const TEXT_PREVIEW_MEDIA_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
]);

export function isOfficeFile(url: string): boolean {
  return OFFICE_EXTENSIONS.has(getExtensionFromUrl(url));
}

export function isOfficeMediaType(mediaType?: string | null): boolean {
  return mediaType
    ? mediaType.toLowerCase() in OFFICE_MEDIA_TYPE_EXTENSION
    : false;
}

/** The Office file extension implied by a MIME type, when known. */
export function officeExtensionFromMediaType(
  mediaType?: string | null,
): string | undefined {
  return mediaType
    ? OFFICE_MEDIA_TYPE_EXTENSION[mediaType.toLowerCase()]
    : undefined;
}

export function isPdfUrl(url: string): boolean {
  return getExtensionFromUrl(url) === "pdf";
}

export function isPdfMediaType(mediaType?: string | null): boolean {
  return mediaType?.toLowerCase() === "application/pdf";
}

export function isTextPreviewUrl(url: string): boolean {
  return TEXT_PREVIEW_EXTENSIONS.has(getExtensionFromUrl(url));
}

export function isTextPreviewMediaType(mediaType?: string | null): boolean {
  return mediaType
    ? TEXT_PREVIEW_MEDIA_TYPES.has(mediaType.toLowerCase())
    : false;
}

export type DocumentPreviewKind = "office" | "pdf" | "text";

/**
 * Positive allowlist only — unlike a curated offer's output (a closed,
 * known-safe type enum), a real attachment can be a zip/csv/video/unknown
 * binary that must keep falling through to a plain download link rather than
 * being force-embedded in an iframe.
 */
export function getDocumentPreviewKind(
  url: string,
  mediaType?: string | null,
): DocumentPreviewKind | null {
  if (isOfficeFile(url) || isOfficeMediaType(mediaType)) return "office";
  if (isPdfUrl(url) || isPdfMediaType(mediaType)) return "pdf";
  if (isTextPreviewUrl(url) || isTextPreviewMediaType(mediaType)) return "text";
  return null;
}

/**
 * Builds a Microsoft Office Online viewer URL for a docx/pptx/xlsx file.
 * Extensionless URLs (e.g. IPFS hashes) need a filename hint or the viewer
 * can't detect the format — pass `extensionHint` (e.g. "docx") in that case.
 */
export function officeViewerUrl(url: string, extensionHint?: string): string {
  let src = url;
  if (!isOfficeFile(url)) {
    const ext = extensionHint ?? "docx";
    src = `${url}${url.includes("?") ? "&" : "?"}filename=file.${ext}`;
  }
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(src)}`;
}

/** Native PDF embed with the browser's own chrome (toolbar/thumbnail rail) hidden. */
export function pdfEmbedUrl(url: string): string {
  return `${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
}
