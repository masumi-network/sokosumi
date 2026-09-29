import { createHash } from "node:crypto";

import { FileExtractionState } from "@sokosumi/database";

import {
  extractOoxmlText,
  type OoxmlShortfall,
  ooxmlKindFor,
} from "@/lib/files/ooxml";
import {
  extractPdfText,
  type PdfExtractDependencies,
  type PdfFailure,
} from "@/lib/files/pdf";

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
 * **PDF is now read too**, by the sandboxed parser this comment used to
 * promise: `lib/files/pdf.ts` runs `pdfjs-dist` in a child process with its
 * own heap, killed from the outside on a wall clock, with page and output
 * caps enforced inside the page loop. The reasoning for the process
 * boundary and for each bound is there rather than repeated here.
 *
 * What has not changed is the standard the old comment set. A PDF we cannot
 * read is `UNSUPPORTED` **with a named reason** — a missing parser, a
 * password, a timeout, a scan with no text layer — and is still findable by
 * name and still downloadable. It is never silently indexed as empty, which
 * would look searched and not be.
 *
 * Legacy binary Office (`.doc`, `.ppt`, `.xls`) and OCR remain out. OCR in
 * particular is a deliberate refusal rather than a gap: a scanned page has
 * no text layer, and guessing at its contents produces exactly the
 * confidently-wrong index this module exists to avoid.
 */
export type ExtractionTreatment =
  | "text"
  | "ooxml"
  | "pdf"
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
    return "pdf";
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
  return treatment === "text" || treatment === "ooxml" || treatment === "pdf"
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
    case "pdf":
      return null;
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
 * Stored chunks back into running text. Neighbouring chunks overlap by up to
 * `FILE_CHUNK_OVERLAP_CHARS` so a search hit keeps its context, which means
 * joining them as they are repeats that span at every seam. Each chunk is
 * trimmed, so the overlap is found by content rather than by offset.
 */
export function joinExtractedChunks(
  chunks: readonly { text: string }[],
): string {
  let joined = "";
  for (const { text } of chunks) {
    if (!joined) {
      joined = text;
      continue;
    }
    const window = FILE_CHUNK_OVERLAP_CHARS + 40;
    const tail = joined.slice(-Math.min(window, joined.length));
    let overlap = 0;
    for (
      let length = Math.min(tail.length, text.length);
      length >= 20;
      length--
    ) {
      if (tail.endsWith(text.slice(0, length))) {
        overlap = length;
        break;
      }
    }
    joined += overlap > 0 ? text.slice(overlap) : `\n\n${text}`;
  }
  return joined;
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
function resultFromText(
  decoded: string,
  /**
   * What the extractor already discarded before handing the text over.
   *
   * Text and OOXML give us the whole document, so the budgets below are the
   * only thing that can make a result partial and coverage can be measured
   * against the text itself. A PDF is different: the parser stops at its
   * own page and character caps, so the text arriving here may already be
   * a prefix. Without this, a 900-page document read to page 200 would
   * compute coverage 1.0 over the 200 pages it received and be recorded as
   * fully INDEXED, which is the quiet lie this module exists to avoid.
   */
  source: { truncated: boolean; coverage: number } = {
    truncated: false,
    coverage: 1,
  },
): ExtractionResult {
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

  // Coverage of the whole document, not of the slice we were handed: the
  // two differ exactly when the extractor stopped early.
  const wholeDocumentCoverage = coverage * source.coverage;
  const partial =
    truncated ||
    chunkCapped ||
    source.truncated ||
    wholeDocumentCoverage < 0.999;

  return {
    state: partial ? FileExtractionState.PARTIAL : FileExtractionState.INDEXED,
    coverage: wholeDocumentCoverage,
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
  /**
   * Passed through to the sandboxed PDF parser. Tests lower its caps to
   * reach the truncated case without a 200-page fixture; production passes
   * nothing and gets the exported constants.
   */
  pdfOptions?: PdfExtractDependencies;
}): Promise<ExtractionResult> {
  const treatment = classifyExtraction({
    mimeType: input.mimeType,
    displayName: input.displayName,
  });

  if (treatment === "pdf") {
    return extractPdfDocument(input.bytes, input.pdfOptions);
  }
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

  const ooxml = await extractOoxmlText(input.bytes, kind);
  if (ooxml === null) {
    return {
      state: FileExtractionState.UNSUPPORTED,
      coverage: 0,
      reason:
        "This document could not be unpacked. It may be encrypted or damaged.",
      chunks: [],
      extractorVersion: FILE_EXTRACTOR_VERSION,
    };
  }

  /**
   * Unpacked fine, and still produced nothing. Say which of those it was.
   *
   * Four parts each over the per-part cap exhaust the whole document
   * budget, every later part is refused, and the result is empty text —
   * which used to arrive here as `null` and be reported as "could not be
   * unpacked. It may be encrypted or damaged." The document is neither. It
   * is text-dense, and telling somebody their file is damaged when it is
   * not is worse than telling them nothing.
   */
  if (ooxml.text.trim().length === 0 && ooxml.shortfall !== null) {
    return {
      state: FileExtractionState.UNSUPPORTED,
      coverage: 0,
      reason: ooxmlShortfallReason(ooxml.shortfall),
      chunks: [],
      extractorVersion: FILE_EXTRACTOR_VERSION,
    };
  }

  // The `source` the PDF arm has passed all along. Without it every cap in
  // `ooxml.ts` was invisible: a 400-slide deck read to slide 200 was
  // recorded INDEXED at coverage 1.0 with no reason, and search silently
  // could not find the back half.
  return resultFromText(ooxml.text, {
    truncated: ooxml.truncated,
    coverage: ooxml.coverage,
  });
}

/**
 * Why an OOXML document gave up nothing, in words that are true.
 *
 * Each of these is a bound this deployment chose, not a property of the
 * file, and the wording says so — a reader who is told their deck is
 * "damaged" will go and try to repair a file that is perfectly fine.
 */
function ooxmlShortfallReason(shortfall: OoxmlShortfall): string {
  switch (shortfall) {
    case "part-bytes":
      return "This document's sections are individually larger than the reader will unpack. It is findable by name and can be downloaded.";
    case "document-bytes":
      return "This document unpacks to more than the reader will hold. It is findable by name and can be downloaded.";
    case "parts":
      return "This document has more sections than the reader will open.";
    case "chars":
      return "This document is longer than the extraction budget.";
    default:
      return "This document could not be read in full.";
  }
}

/**
 * A reason for each way a PDF can fail to be read.
 *
 * Every one of them is `UNSUPPORTED` with something a person can act on,
 * because the alternative — one reason for seven causes — is what makes a
 * broken deployment indistinguishable from a scanned document.
 */
function pdfFailureReason(failure: PdfFailure): string {
  switch (failure) {
    case "parser-unavailable":
      return "PDF text is not read in this deployment. The file is findable by name and can be downloaded.";
    case "encrypted":
      return "This PDF is password-protected, so its text cannot be read.";
    case "no-text-layer":
      return "This PDF has no text layer, so it is probably a scan. Text is not read from images.";
    case "timeout":
      return "This PDF took too long to read and was stopped. It is findable by name and can be downloaded.";
    case "out-of-memory":
      return "This PDF needed more memory to read than the reader allows.";
    case "unreadable":
      return "This PDF could not be parsed. It may be damaged or not really a PDF.";
    default:
      return "The PDF reader stopped unexpectedly on this file.";
  }
}

/**
 * The PDF arm, deliberately the same shape as the OOXML one above.
 *
 * Read the text out of the format, then converge on `resultFromText`. A PDF
 * is chunked, indexed and ranked by exactly the caps a Markdown file is.
 * The only addition is the coverage the parser reports, because it is the
 * one extractor that can stop before the end of its input.
 */
async function extractPdfDocument(
  bytes: Uint8Array,
  options: PdfExtractDependencies = {},
): Promise<ExtractionResult> {
  if (bytes.byteLength > FILE_EXTRACTION_MAX_BYTES) {
    return {
      state: FileExtractionState.PARTIAL,
      coverage: 0,
      reason: "This file is larger than the extraction limit.",
      chunks: [],
      extractorVersion: FILE_EXTRACTOR_VERSION,
    };
  }

  const outcome = await extractPdfText(bytes, options);

  if (!outcome.ok) {
    return {
      state: FileExtractionState.UNSUPPORTED,
      coverage: 0,
      reason: pdfFailureReason(outcome.failure),
      chunks: [],
      extractorVersion: FILE_EXTRACTOR_VERSION,
    };
  }

  // Pages are the denominator a reader would use, and the only one we
  // actually know when the parser stopped early.
  const pageCoverage =
    outcome.totalPages > 0
      ? Math.min(1, outcome.pages / outcome.totalPages)
      : 1;

  return resultFromText(outcome.text, {
    truncated: outcome.truncated,
    coverage: pageCoverage,
  });
}
