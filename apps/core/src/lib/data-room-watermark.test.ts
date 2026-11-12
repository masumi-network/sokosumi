import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  watermarkImage,
  watermarkKindFor,
  watermarkPdf,
  watermarkText,
} from "./data-room-watermark";

describe("watermarks", () => {
  it("names the viewer and the minute, in UTC", () => {
    expect(
      watermarkText("anna@fund.com", new Date("2026-11-09T14:05:59.000Z")),
    ).toBe("anna@fund.com · 2026-11-09 14:05 UTC");
  });

  it("stamps PDFs and photos, and nothing it cannot draw on", () => {
    expect(watermarkKindFor("application/pdf")).toBe("pdf");
    expect(watermarkKindFor("image/jpeg")).toBe("image");
    expect(watermarkKindFor("image/svg+xml")).toBeNull();
    expect(
      watermarkKindFor(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBeNull();
  });

  it("stamps every page of a PDF and keeps it a valid PDF", async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    source.addPage([792, 612]);
    const stamped = await watermarkPdf(
      await source.save(),
      "anna@fund.com · 2026-11-09 14:05 UTC",
    );
    const reread = await PDFDocument.load(stamped);
    expect(reread.getPageCount()).toBe(2);
    // The stamp adds a content stream to each page.
    expect(stamped.byteLength).toBeGreaterThan(
      (await source.save()).byteLength,
    );
  });

  it("stamps an image without changing its size or type", async () => {
    const png = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const stamped = await watermarkImage(
      png,
      "anna@fund.com · 2026-11-09 14:05 UTC",
    );
    expect(stamped.contentType).toBe("image/png");
    const meta = await sharp(stamped.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([400, 300]);
    // A white image is no longer all white once stamped.
    const { channels } = await sharp(stamped.bytes).stats();
    expect(channels[0]?.min).toBeLessThan(255);
  });
});
