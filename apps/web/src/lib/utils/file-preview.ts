import { getExtensionFromUrl, isImageUrl } from "@sokosumi/utils";

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
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov", "m4v"]);
const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "m4a",
  "aac",
  "flac",
  "opus",
  "oga",
]);

/** Strip parameters (`text/plain; charset=utf-8` → `text/plain`) for allowlist checks. */
export function normalizeMediaType(mediaType?: string | null): string | null {
  if (!mediaType) return null;
  const base = mediaType.split(";", 1)[0]?.trim().toLowerCase();
  return base || null;
}

export function isOfficeFile(url: string): boolean {
  return OFFICE_EXTENSIONS.has(getExtensionFromUrl(url));
}

export function isOfficeMediaType(mediaType?: string | null): boolean {
  const normalized = normalizeMediaType(mediaType);
  return normalized ? normalized in OFFICE_MEDIA_TYPE_EXTENSION : false;
}

/** The Office file extension implied by a MIME type, when known. */
export function officeExtensionFromMediaType(
  mediaType?: string | null,
): string | undefined {
  const normalized = normalizeMediaType(mediaType);
  return normalized ? OFFICE_MEDIA_TYPE_EXTENSION[normalized] : undefined;
}

export function isPdfUrl(url: string): boolean {
  return getExtensionFromUrl(url) === "pdf";
}

export function isPdfMediaType(mediaType?: string | null): boolean {
  return normalizeMediaType(mediaType) === "application/pdf";
}

export function isTextPreviewUrl(url: string): boolean {
  return TEXT_PREVIEW_EXTENSIONS.has(getExtensionFromUrl(url));
}

export function isTextPreviewMediaType(mediaType?: string | null): boolean {
  const normalized = normalizeMediaType(mediaType);
  return normalized ? TEXT_PREVIEW_MEDIA_TYPES.has(normalized) : false;
}

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtensionFromUrl(url));
}

export function isVideoMediaType(mediaType?: string | null): boolean {
  return normalizeMediaType(mediaType)?.startsWith("video/") ?? false;
}

export function isAudioUrl(url: string): boolean {
  return AUDIO_EXTENSIONS.has(getExtensionFromUrl(url));
}

export function isAudioMediaType(mediaType?: string | null): boolean {
  return normalizeMediaType(mediaType)?.startsWith("audio/") ?? false;
}

export type DocumentPreviewKind = "office" | "pdf" | "text";

/**
 * Positive allowlist only — unlike a curated offer's output (a closed,
 * known-safe type enum), a real attachment can be a zip/csv/unknown binary
 * that must keep falling through to a plain download link rather than being
 * force-embedded in an iframe. Video/audio are classified by
 * `classifyFilePreview` and do not use this document helper.
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

export interface FilePreviewClassification {
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  documentKind: DocumentPreviewKind | null;
}

/**
 * Classifies a file for chip/markdown preview: image, video, audio,
 * previewable document, or none (download link). Falls back to `fileName`
 * when `url` has no useful extension.
 */
export function classifyFilePreview(
  url: string,
  fileName?: string | null,
  mediaType?: string | null,
): FilePreviewClassification {
  const isImage =
    (normalizeMediaType(mediaType)?.startsWith("image/") ?? false) ||
    isImageUrl(url) ||
    (fileName ? isImageUrl(fileName) : false);

  if (isImage) {
    return {
      isImage: true,
      isVideo: false,
      isAudio: false,
      documentKind: null,
    };
  }

  // Prefer MIME when present: audio/* beats a video-extension allowlist hit
  // (e.g. .ogg + audio/ogg → audio). video/* MIME still classifies as video.
  const isVideo =
    isVideoMediaType(mediaType) ||
    (!isAudioMediaType(mediaType) &&
      (isVideoUrl(url) || (fileName ? isVideoUrl(fileName) : false)));

  if (isVideo) {
    return {
      isImage: false,
      isVideo: true,
      isAudio: false,
      documentKind: null,
    };
  }

  const isAudio =
    isAudioMediaType(mediaType) ||
    isAudioUrl(url) ||
    (fileName ? isAudioUrl(fileName) : false);

  if (isAudio) {
    return {
      isImage: false,
      isVideo: false,
      isAudio: true,
      documentKind: null,
    };
  }

  const documentKind =
    getDocumentPreviewKind(url, mediaType) ??
    (fileName ? getDocumentPreviewKind(fileName, mediaType) : null);

  return {
    isImage: false,
    isVideo: false,
    isAudio: false,
    documentKind,
  };
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

/**
 * Vercel Blob (and some CDNs) treat `?download=1` as "force Content-Disposition:
 * attachment". That makes an iframe/`window.open` download the file instead of
 * rendering it. Strip it before any inline preview path.
 */
export function stripForcedDownloadParam(url: string): string {
  try {
    const parsed = new URL(url);
    if (
      parsed.searchParams.get("download") === "1" ||
      parsed.searchParams.get("download") === "true"
    ) {
      parsed.searchParams.delete("download");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Native PDF embed with the browser's own chrome (toolbar/thumbnail rail) hidden. */
export function pdfEmbedUrl(url: string): string {
  return `${stripForcedDownloadParam(url)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
}
