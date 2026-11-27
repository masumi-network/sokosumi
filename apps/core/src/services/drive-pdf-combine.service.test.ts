import { PDFDocument, PDFName, type PDFPageTree } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  combinePdfs,
  PdfLimitError,
  UnreadablePdfError,
} from "./drive-pdf-combine.service";

async function pdfWithPages(
  widths: number[],
  useObjectStreams = false,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 800]);
  return pdf.save({ useObjectStreams });
}

/** A loadable PDF whose page tree is changed by `edit` before saving. */
async function withPageTree(
  edit: (root: PDFPageTree, pdf: PDFDocument) => void,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 800]);
  edit(pdf.catalog.Pages(), pdf);
  return pdf.save({ useObjectStreams: false });
}

/** A one-page PDF plus an object stream with `filter` over eight plain bytes. */
async function withObjectStream(filter: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 800]);
  pdf.context.register(
    pdf.context.stream(new TextEncoder().encode("not data"), {
      Type: "ObjStm",
      Filter: filter,
      N: 0,
      First: 0,
    }),
  );
  return pdf.save({ useObjectStreams: false });
}

describe("combinePdfs", () => {
  it("joins every page in the order the files are given", async () => {
    const combined = await combinePdfs([
      { name: "b.pdf", bytes: await pdfWithPages([300]) },
      { name: "a.pdf", bytes: await pdfWithPages([100, 200], true) },
    ]);

    expect(combined.pageCount).toBe(3);
    const read = await PDFDocument.load(combined.bytes);
    expect(read.getPages().map((page) => page.getWidth())).toEqual([
      300, 100, 200,
    ]);
  });

  it("refuses the whole combine and names the file that is not a PDF", async () => {
    await expect(
      combinePdfs([
        { name: "good.pdf", bytes: await pdfWithPages([100]) },
        { name: "notes.pdf", bytes: new TextEncoder().encode("plain text") },
      ]),
    ).rejects.toEqual(new UnreadablePdfError("notes.pdf"));
  });

  it("names a file that loads but whose pages cannot be read", async () => {
    const broken = await withPageTree((_root, pdf) => {
      // The page's parent is a number, not a page tree: the file loads, and
      // copying fails when it looks up inherited page settings.
      pdf.getPage(0).node.set(PDFName.of("Parent"), pdf.context.obj(42));
    });

    await expect(
      combinePdfs([
        { name: "good.pdf", bytes: await pdfWithPages([100]) },
        { name: "pages.pdf", bytes: broken },
      ]),
    ).rejects.toEqual(new UnreadablePdfError("pages.pdf"));
  });

  it("names a file whose page tree lists the same node twice", async () => {
    const looped = await withPageTree((root) => {
      root.Kids().push(root.Kids().get(0));
    });

    await expect(
      combinePdfs([
        { name: "good.pdf", bytes: await pdfWithPages([100]) },
        { name: "loop.pdf", bytes: looped },
      ]),
    ).rejects.toEqual(new UnreadablePdfError("loop.pdf"));
  });

  it("names a file whose page tree points back at itself", async () => {
    const cyclic = await withPageTree((root, pdf) => {
      root.Kids().push(pdf.catalog.get(PDFName.of("Pages")) as never);
    });

    await expect(
      combinePdfs([
        { name: "a.pdf", bytes: await pdfWithPages([100]) },
        { name: "cycle.pdf", bytes: cyclic },
      ]),
    ).rejects.toEqual(new UnreadablePdfError("cycle.pdf"));
  });

  it("stops at the page limit and names the file that crossed it", async () => {
    await expect(
      combinePdfs(
        [
          { name: "a.pdf", bytes: await pdfWithPages([100, 100]) },
          { name: "b.pdf", bytes: await pdfWithPages([100, 100]) },
        ],
        { maxPages: 3 },
      ),
    ).rejects.toEqual(new PdfLimitError("b.pdf"));
  });

  it("stops decoding compressed object data past the budget", async () => {
    // pdf-lib's own object streams: ordinary output, decoded while loading.
    const bytes = await pdfWithPages([100, 200, 300], true);

    await expect(
      combinePdfs([{ name: "dense.pdf", bytes }], { maxDecodedBytes: 16 }),
    ).rejects.toEqual(new PdfLimitError("dense.pdf"));
    await expect(
      combinePdfs([{ name: "dense.pdf", bytes }]),
    ).resolves.toMatchObject({ pageCount: 3 });
  });

  it("names a file with an object stream that will not decompress", async () => {
    const bytes = await withObjectStream("FlateDecode");

    await expect(combinePdfs([{ name: "garbled.pdf", bytes }])).rejects.toEqual(
      new UnreadablePdfError("garbled.pdf"),
    );
  });

  it("refuses an object stream compressed in a way it cannot measure", async () => {
    const bytes = await withObjectStream("LZWDecode");

    await expect(combinePdfs([{ name: "lzw.pdf", bytes }])).rejects.toEqual(
      new PdfLimitError("lzw.pdf"),
    );
  });

  it("shares the decode budget across files", async () => {
    const bytes = await pdfWithPages([100], true);
    // The first doubling one file fits in is under twice its decoded size,
    // so two copies cannot fit.
    let left = 0;
    for (let budget = 1; budget < 1_000_000 && !left; budget *= 2) {
      const fits = await combinePdfs([{ name: "a.pdf", bytes }], {
        maxDecodedBytes: budget,
      }).then(
        () => true,
        () => false,
      );
      if (fits) left = budget;
    }
    expect(left).toBeGreaterThan(0);
    await expect(
      combinePdfs(
        [
          { name: "a.pdf", bytes },
          { name: "b.pdf", bytes },
        ],
        { maxDecodedBytes: left },
      ),
    ).rejects.toEqual(new PdfLimitError("b.pdf"));
  });

  it("refuses an output larger than the cap", async () => {
    await expect(
      combinePdfs(
        [
          { name: "a.pdf", bytes: await pdfWithPages([100]) },
          { name: "b.pdf", bytes: await pdfWithPages([100]) },
        ],
        { maxOutputBytes: 64 },
      ),
    ).rejects.toEqual(new PdfLimitError(null));
  });

  it("leaves other pdf-lib users unbounded", async () => {
    const bytes = await pdfWithPages([100, 200], true);
    await expect(
      combinePdfs([{ name: "a.pdf", bytes }], { maxDecodedBytes: 1 }),
    ).rejects.toBeInstanceOf(PdfLimitError);
    const read = await PDFDocument.load(bytes);
    expect(read.getPageCount()).toBe(2);
  });
});
