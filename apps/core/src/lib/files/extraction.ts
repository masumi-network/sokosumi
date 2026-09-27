import { createHash } from "node:crypto";

import { FileExtractionState } from "@sokosumi/database";

import { extractOoxmlText, ooxmlKindFor } from "@/lib/files/ooxml";

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
 * What we can read today.
 *
 * Word, PowerPoint and Excel are read: an OOXML file is a ZIP of XML parts,
 * and `lib/files/ooxml.ts` takes the text out of the parts that carry prose
 * without an XML parser and inside explicit caps.
 *
 * **PDF is not**, and that is a decision rather than an oversight. Nothing
 * in this repository can parse one, and every credible option is a large
 * new dependency interpreting reader-supplied bytes in the same process as
 * the API. A half-working reader is worse than none here: a PDF silently
 * indexed as empty looks searched and is not, which is exactly the failure
 * an honest `UNSUPPORTED` avoids. Doing it properly means the sandboxed
 * parser the reason string has always promised — a separate process with
 * its own memory and time limits.
 *
 * Legacy binary Office (`.doc`, `.ppt`, `.xls`) and OCR are out for the
 * same reason.
 */
export type ExtractionTreatment =
  | "text"
  | "ooxml"
  | "unsupported-pdf"
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
    ooxmlKindFor({ mimeType: input.mimeType, displayName: input.displayName })
  ) {
    return "ooxml";
  }

  if (mime === "application/pdf" || extension === "pdf") {
    return "unsupported-pdf";
  }

  if (
    mime.includes("officedocument") ||
    ["doc", "ppt", "xls", "odt", "rtf"].includes(extension)
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
  return treatment === "text" || treatment === "ooxml"
    ? FileExtractionState.INDEXED
    : FileExtractionState.UNSUPPORTED;
}

/** A short, honest reason shown next to a "Filename only" state. */
export function extractionReasonForTreatment(
  treatment: ExtractionTreatment,
): string | null {
  switch (treatment) {
    case "text":
    case "ooxml":
      return null;
    case "unsupported-pdf":
      return "PDF text is not read in this version. The file is findable by name and can be downloaded.";
    case "unsupported-binary-document":
      return "This older Office format needs a sandboxed parser that is not available yet.";
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

  return resultFromText(decoded);
}

/**
 * The shared tail: normalize, budget, chunk, and report coverage honestly.
 * Text files and OOXML documents converge here so a Word file is bounded by
 * exactly the same caps as a Markdown one.
 */
function resultFromText(decoded: string): ExtractionResult {
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

/**
 * Extract one document, including formats that need to be unpacked first.
 *
 * `extractDocument` stays synchronous and pure for text, which keeps its
 * budget arithmetic trivially testable. OOXML has to unzip, so it needs a
 * promise, and this is the entry point the indexer uses.
 *
 * An OOXML file we cannot open resolves to `UNSUPPORTED` with a reason — not
 * to a throw, and not to an empty index that would look like a searched
 * document with nothing in it.
 */
export async function extractDocumentAsync(input: {
  bytes: Uint8Array;
  mimeType: string | null;
  displayName: string;
}): Promise<ExtractionResult> {
  const treatment = classifyExtraction({
    mimeType: input.mimeType,
    displayName: input.displayName,
  });

  if (treatment !== "ooxml") return extractDocument(input);

  if (input.bytes.byteLength > FILE_EXTRACTION_MAX_BYTES) {
    return {
      state: FileExtractionState.PARTIAL,
      coverage: 0,
      reason: "This file is larger than the extraction limit.",
      chunks: [],
      extractorVersion: FILE_EXTRACTOR_VERSION,
    };
  }

  const kind = ooxmlKindFor({
    mimeType: input.mimeType,
    displayName: input.displayName,
  });
  if (!kind) return extractDocument(input);

  const text = await extractOoxmlText(input.bytes, kind);
  if (text === null) {
    return {
      state: FileExtractionState.UNSUPPORTED,
      coverage: 0,
      reason:
        "This document could not be unpacked. It may be encrypted or damaged.",
      chunks: [],
      extractorVersion: FILE_EXTRACTOR_VERSION,
    };
  }

  return resultFromText(text);
}
