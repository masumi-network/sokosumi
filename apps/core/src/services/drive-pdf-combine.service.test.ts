import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { combinePdfs, UnreadablePdfError } from "./drive-pdf-combine.service";

async function pdfWithPages(widths: number[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 800]);
  return pdf.save();
}

describe("combinePdfs", () => {
  it("joins every page in the order the files are given", async () => {
    const combined = await combinePdfs([
      { name: "b.pdf", bytes: await pdfWithPages([300]) },
      { name: "a.pdf", bytes: await pdfWithPages([100, 200]) },
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
});
