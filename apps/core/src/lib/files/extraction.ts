import { createHash } from "node:crypto";

import { FileExtractionState } from "@sokosumi/database";

/**
 * Turning bytes into searchable passages, inside explicit budgets.
 *
 * Every format either has a treatment here or is honestly marked
 * unsupported. A document we cannot read is still findable by name and still
 * downloadable — it is never quietly reported as indexed.
 */

/** Bytes we will pull into memory to extract. Larger files stay name-only. */
export const FILE_EXTRACTION_MAX_BYTES = 50 * 1024 * 1024;
/** Characters we keep from one document, roughly 250k tokens of budget. */
export const FILE_EXTRACTION_MAX_CHARS = 1_000_000;
/** Target chunk size in characters, about 400–600 tokens of English. */
export const FILE_CHUNK_TARGET_CHARS = 2_000;
export const FILE_CHUNK_OVERLAP_CHARS = 240;
export const FILE_CHUNK_MAX_PER_VERSION = 400;

export interface ExtractedChunk {
  chunkId: string;
  ordinal: number;
  text: string;
  anchor: { kind: "char"; start: number; end: number; line?: number };
  inputDigest: string;
}

export interface ExtractionResult {
  state: FileExtractionState;
  /** 0..1 of the source we actually read. Never rounded up to 1. */
  coverage: number;
  reason: string | null;
  chunks: ExtractedChunk[];
  extractorVersion: string;
}

export const FILE_EXTRACTOR_VERSION = "files-extractor-v1";

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/x-ndjson",
  "application/yaml",
  "application/x-yaml",
]);

const NAME_ONLY_MIME_PREFIXES = ["audio/", "video/", "image/"];

/**
 * What we can read today. PDF, OOXML and OCR need a sandboxed parser process
 * that this branch does not ship, so they resolve to `UNSUPPORTED` with a
 * reason rather than to a silent empty index.
 */
export type ExtractionTreatment =
  | "text"
  | "unsupported-binary-document"
  | "unsupported-media"
  | "unsupported-unknown";

export function classifyExtraction(input: {
  mimeType: string | null;
  displayName: string;
}): ExtractionTreatment {
  const mime = (input.mimeType ?? "").toLowerCase();
  const extension = input.displayName.split(".").pop()?.toLowerCase() ?? "";

  if (
    TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) ||
    TEXT_MIME_EXACT.has(mime) ||
    [
      "txt",
      "md",
      "markdown",
      "csv",
      "tsv",
      "json",
      "log",
      "yaml",
      "yml",
    ].includes(extension)
  ) {
    return "text";
  }

  if (
    mime === "application/pdf" ||
    extension === "pdf" ||
    mime.includes("officedocument") ||
    ["docx", "pptx", "xlsx", "doc", "ppt", "xls", "odt", "rtf"].includes(
      extension,
    )
  ) {
    return "unsupported-binary-document";
  }

  if (NAME_ONLY_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return "unsupported-media";
  }

  return "unsupported-unknown";
}

export function extractionStateForTreatment(
  treatment: ExtractionTreatment,
): FileExtractionState {
  return treatment === "text"
    ? FileExtractionState.INDEXED
    : FileExtractionState.UNSUPPORTED;
}

/** A short, honest reason shown next to a "Filename only" state. */
export function extractionReasonForTreatment(
  treatment: ExtractionTreatment,
): string | null {
  switch (treatment) {
    case "text":
      return null;
    case "unsupported-binary-document":
      return "This format needs a sandboxed parser that is not available yet.";
    case "unsupported-media":
      return "Audio, video and image contents are not read in this version.";
    default:
      return "This format is not recognised for text extraction.";
  }
}

/**
 * Normalize decoded text: strip a BOM, unify newlines, drop control
 * characters that would poison a tsvector, and collapse runs of blank lines.
 * Content is data — nothing here is interpreted, executed or followed.
 */
/**
 * C0 controls and DEL become spaces. Done by code point rather than by a
 * regular expression so the literal control bytes never enter this source.
 */
function stripControlCharacters(value: string): string {
  let out = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const isControl = (code < 0x20 && code !== 0x0a) || code === 0x7f;
    out += isControl ? " " : character;
  }
  return out;
}

export function normalizeExtractedText(raw: string): string {
  const withoutBom = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  return stripControlCharacters(withoutBom.replace(/\r\n?/gu, "\n"))
    .replace(/\n{3,}/gu, "\n\n")
    .normalize("NFC");
}

function chunkBoundary(text: string, from: number, limit: number): number {
  const hardEnd = Math.min(from + limit, text.length);
  if (hardEnd >= text.length) return text.length;

  // Prefer a paragraph break, then a sentence end, then a space, so a chunk
  // stops somewhere a reader would.
  for (const pattern of ["\n\n", ". ", "\n", " "]) {
    const found = text.lastIndexOf(pattern, hardEnd);
    if (found > from + limit / 2) return found + pattern.length;
  }
  return hardEnd;
}

export function chunkExtractedText(text: string): ExtractedChunk[] {
  const chunks: ExtractedChunk[] = [];
  let cursor = 0;
  let ordinal = 0;

  while (cursor < text.length && chunks.length < FILE_CHUNK_MAX_PER_VERSION) {
    const end = chunkBoundary(text, cursor, FILE_CHUNK_TARGET_CHARS);
    const slice = text.slice(cursor, end).trim();

    if (slice.length > 0) {
      const line = text.slice(0, cursor).split("\n").length;
      chunks.push({
        chunkId: `c${ordinal}`,
        ordinal,
        text: slice,
        anchor: { kind: "char", start: cursor, end, line },
        inputDigest: createHash("sha256").update(slice).digest("base64url"),
      });
      ordinal += 1;
    }

    if (end <= cursor) break;
    cursor = Math.max(
      end - FILE_CHUNK_OVERLAP_CHARS,
      end === text.length ? end : cursor + 1,
    );
    if (cursor >= text.length) break;
  }

  return chunks;
}

/**
 * Extract one document from bytes already fetched by the caller. Pure, so
 * the budgets and the coverage arithmetic are testable without a network or
 * an object store.
 */
export function extractDocument(input: {
  bytes: Uint8Array;
  mimeType: string | null;
  displayName: string;
}): ExtractionResult {
  const treatment = classifyExtraction({
    mimeType: input.mimeType,
    displayName: input.displayName,
  });

  if (treatment !== "text") {
    return {
      state: FileExtractionState.UNSUPPORTED,
      coverage: 0,
      reason: extractionReasonForTreatment(treatment),
      chunks: [],
      extractorVersion: FILE_EXTRACTOR_VERSION,
    };
  }

  if (input.bytes.byteLength > FILE_EXTRACTION_MAX_BYTES) {
    return {
      state: FileExtractionState.PARTIAL,
      coverage: 0,
      reason: "This file is larger than the extraction limit.",
      chunks: [],
      extractorVersion: FILE_EXTRACTOR_VERSION,
    };
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
  } catch {
    return {
      state: FileExtractionState.FAILED,
      coverage: 0,
      reason: "The text could not be decoded.",
      chunks: [],
      extractorVersion: FILE_EXTRACTOR_VERSION,
    };
  }

  const normalized = normalizeExtractedText(decoded);
  const truncated = normalized.length > FILE_EXTRACTION_MAX_CHARS;
  const usable = truncated
    ? normalized.slice(0, FILE_EXTRACTION_MAX_CHARS)
    : normalized;

  const chunks = chunkExtractedText(usable);
  const chunkCapped = chunks.length >= FILE_CHUNK_MAX_PER_VERSION;
  const coveredChars =
    chunks.length > 0 ? chunks[chunks.length - 1].anchor.end : 0;
  const coverage =
    normalized.length === 0 ? 1 : Math.min(1, coveredChars / normalized.length);

  if (usable.trim().length === 0) {
    return {
      state: FileExtractionState.PARTIAL,
      coverage: 0,
      reason: "No readable text was found in this file.",
      chunks: [],
      extractorVersion: FILE_EXTRACTOR_VERSION,
    };
  }

  const partial = truncated || chunkCapped || coverage < 0.999;

  return {
    state: partial ? FileExtractionState.PARTIAL : FileExtractionState.INDEXED,
    coverage,
    reason: partial
      ? "Only the beginning of this file is indexed; it is longer than the extraction budget."
      : null,
    chunks,
    extractorVersion: FILE_EXTRACTOR_VERSION,
  };
}
