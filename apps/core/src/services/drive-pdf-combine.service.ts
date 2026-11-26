import { PDFDocument } from "pdf-lib";

/** A source that pdf-lib cannot open: broken, encrypted, or not a PDF. */
export class UnreadablePdfError extends Error {
  constructor(readonly fileName: string) {
    super(`"${fileName}" could not be read as a PDF`);
    this.name = "UnreadablePdfError";
  }
}

/**
 * Every page of every source, in the order given. All or nothing: one
 * unreadable source throws before anything is saved, so a pack is never
 * silently missing a document.
 */
export async function combinePdfs(
  sources: readonly { name: string; bytes: Uint8Array }[],
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const combined = await PDFDocument.create();
  for (const source of sources) {
    let pdf: PDFDocument;
    try {
      // No `ignoreEncryption`: an encrypted file would copy as blank pages.
      pdf = await PDFDocument.load(source.bytes);
    } catch {
      throw new UnreadablePdfError(source.name);
    }
    const pages = await combined.copyPages(pdf, pdf.getPageIndices());
    for (const page of pages) combined.addPage(page);
  }
  return { bytes: await combined.save(), pageCount: combined.getPageCount() };
}
