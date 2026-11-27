import { AsyncLocalStorage } from "node:async_hooks";
import { constants, inflateSync } from "node:zlib";

import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFObjectStreamParser,
  PDFPageLeaf,
  PDFPageTree,
  type PDFRawStream,
  PDFXRefStreamParser,
} from "pdf-lib";

/** A source that pdf-lib cannot open: broken, encrypted, or not a PDF. */
export class UnreadablePdfError extends Error {
  constructor(readonly fileName: string) {
    super(`"${fileName}" could not be read as a PDF`);
    this.name = "UnreadablePdfError";
  }
}

/**
 * The combine would pass one of its limits. `fileName` is the source that
 * crossed it, or null when the joined output is too large.
 */
export class PdfLimitError extends Error {
  constructor(readonly fileName: string | null) {
    super(
      fileName
        ? `"${fileName}" passes a limit for combining PDFs`
        : "The combined PDF would be too large",
    );
    this.name = "PdfLimitError";
  }
}

export interface CombinePdfLimits {
  /** Pages across all sources. */
  maxPages: number;
  /** Bytes pdf-lib may decompress while loading, across all sources. */
  maxDecodedBytes: number;
  /** Size of the combined file. */
  maxOutputBytes: number;
}

const DEFAULT_LIMITS: CombinePdfLimits = {
  maxPages: 2_000,
  maxDecodedBytes: 64 * 1024 * 1024,
  maxOutputBytes: 100 * 1024 * 1024,
};

/** Deeper page trees than any real document, shallow enough for recursion. */
const MAX_PAGE_TREE_DEPTH = 64;

/**
 * Loading decompresses object and cross-reference streams, the only streams
 * pdf-lib decodes; copying and saving pass page content through as stored.
 * Each such stream is measured against the combine's budget before pdf-lib
 * decodes it, so a small file cannot expand without bound. Past the budget a
 * stream is skipped undecoded and the budget marked: pdf-lib's parser
 * swallows errors per object, so a throw would not stop the load. Outside a
 * combine there is no budget and pdf-lib behaves as before.
 */
interface DecodeBudget {
  left: number;
  exceeded: boolean;
  /** A stream that would not decompress; the source is refused as broken. */
  broken: boolean;
}
const decodeBudget = new AsyncLocalStorage<DecodeBudget>();

/**
 * Bytes the stream decodes to, null once that would pass `limit` or the
 * filter is one that is not measured, or "broken" when it will not inflate.
 */
function decodedSize(
  raw: PDFRawStream,
  limit: number,
): number | null | "broken" {
  const filter = raw.dict.lookup(PDFName.of("Filter"));
  const filters = (
    filter instanceof PDFArray ? filter.asArray() : filter ? [filter] : []
  ).map(String);
  if (filters.length === 0) return raw.contents.byteLength;
  // Anything else that can expand (LZW, run length, chains) is refused.
  if (
    filters.length > 1 ||
    (filters[0] !== "/FlateDecode" && filters[0] !== "/Fl")
  )
    return null;
  try {
    // Stops before allocating past the limit. A predictor only regroups
    // bytes, so it cannot grow pdf-lib's own decode beyond this.
    return inflateSync(raw.contents, {
      maxOutputLength: limit + 1,
      finishFlush: constants.Z_SYNC_FLUSH,
    }).byteLength;
  } catch (error) {
    return (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE"
      ? null
      : "broken";
  }
}

for (const Parser of [PDFObjectStreamParser, PDFXRefStreamParser]) {
  const forStream = Parser.forStream as (
    raw: PDFRawStream,
    ...rest: unknown[]
  ) => unknown;
  (Parser as { forStream: unknown }).forStream = (
    raw: PDFRawStream,
    ...rest: unknown[]
  ) => {
    const budget = decodeBudget.getStore();
    if (budget && !budget.exceeded && !budget.broken) {
      const size = decodedSize(raw, budget.left);
      if (size === "broken") budget.broken = true;
      else if (size === null || size > budget.left) budget.exceeded = true;
      else budget.left -= size;
    }
    if (budget && (budget.exceeded || budget.broken))
      return { parseIntoContext: async () => {} };
    return forStream(raw, ...rest);
  };
}

/**
 * The page count, walking the tree as pdf-lib's own traversal does, but
 * refusing a node met twice (a loop, or a shared branch that would multiply
 * pages) and stopping once `maxPages` is passed.
 */
function countPages(pdf: PDFDocument, maxPages: number): number {
  const seen = new Set<unknown>();
  let pages = 0;
  const walk = (node: PDFPageTree, depth: number) => {
    if (depth > MAX_PAGE_TREE_DEPTH || seen.has(node)) throw new Error("tree");
    seen.add(node);
    const kids = node.Kids();
    for (let index = 0; index < kids.size(); index++) {
      const kid = pdf.context.lookup(kids.get(index));
      if (kid instanceof PDFPageTree) walk(kid, depth + 1);
      else if (kid instanceof PDFPageLeaf) {
        if (seen.has(kid)) throw new Error("tree");
        seen.add(kid);
        if (++pages > maxPages) throw new PdfLimitError(null);
      }
    }
  };
  walk(pdf.catalog.Pages(), 0);
  return pages;
}

/**
 * Every page of every source, in the order given. All or nothing: one
 * unreadable source throws before anything is returned, so a pack is never
 * silently missing a document, and no source can pass the limits.
 */
export async function combinePdfs(
  sources: readonly { name: string; bytes: Uint8Array }[],
  limits: Partial<CombinePdfLimits> = {},
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const { maxPages, maxDecodedBytes, maxOutputBytes } = {
    ...DEFAULT_LIMITS,
    ...limits,
  };
  const budget: DecodeBudget = {
    left: maxDecodedBytes,
    exceeded: false,
    broken: false,
  };
  const combined = await PDFDocument.create();
  for (const source of sources) {
    const { name } = source;
    const fail = (error: unknown) =>
      error instanceof PdfLimitError
        ? new PdfLimitError(name)
        : new UnreadablePdfError(name);
    let pdf: PDFDocument;
    try {
      // No `ignoreEncryption`: an encrypted file would copy as blank pages.
      pdf = await decodeBudget.run(budget, () =>
        PDFDocument.load(source.bytes, { updateMetadata: false }),
      );
    } catch (error) {
      throw budget.exceeded ? new PdfLimitError(name) : fail(error);
    }
    if (budget.exceeded) throw new PdfLimitError(name);
    if (budget.broken) throw new UnreadablePdfError(name);
    try {
      // Counted by walking the tree, not read from its /Count, which the
      // file itself states.
      const pages = countPages(pdf, maxPages - combined.getPageCount());
      const copied = await combined.copyPages(
        pdf,
        Array.from({ length: pages }, (_, index) => index),
      );
      for (const page of copied) combined.addPage(page);
    } catch (error) {
      throw fail(error);
    }
  }
  const bytes = await combined.save();
  if (bytes.byteLength > maxOutputBytes) throw new PdfLimitError(null);
  return { bytes, pageCount: combined.getPageCount() };
}
