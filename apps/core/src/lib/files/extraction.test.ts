import { FileExtractionState } from "@sokosumi/database";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  chunkExtractedText,
  classifyExtraction,
  extractDocument,
  extractDocumentAsync,
  FILE_CHUNK_MAX_PER_VERSION,
  FILE_EXTRACTOR_VERSION,
  normalizeExtractedText,
} from "./extraction";

import { buildPdfFixture } from "./pdf-fixture";

const encoder = new TextEncoder();

describe("classifyExtraction", () => {
  it("reads plain text, markdown and csv", () => {
    expect(
      classifyExtraction({ mimeType: "text/plain", displayName: "notes.txt" }),
    ).toBe("text");
    expect(
      classifyExtraction({ mimeType: null, displayName: "readme.md" }),
    ).toBe("text");
    expect(
      classifyExtraction({ mimeType: "text/csv", displayName: "rows.csv" }),
    ).toBe("text");
  });

  it("reads OOXML and PDF, each by its own route", () => {
    // These three used to share one treatment, then two. Office is
    // unzippable in-process; PDF needs the sandboxed parser in
    // `lib/files/pdf.ts`, which is why it is its own arm rather than a
    // second branch bolted onto the OOXML one.
    expect(
      classifyExtraction({ mimeType: null, displayName: "deck.pptx" }),
    ).toBe("ooxml");
    expect(
      classifyExtraction({ mimeType: null, displayName: "report.docx" }),
    ).toBe("ooxml");
    expect(
      classifyExtraction({
        mimeType: "application/pdf",
        displayName: "brief.pdf",
      }),
    ).toBe("pdf");
    expect(classifyExtraction({ mimeType: null, displayName: "x.pdf" })).toBe(
      "pdf",
    );
  });

  it("keeps legacy binary Office out, which needs the same parser PDF does", () => {
    for (const name of ["old.doc", "old.ppt", "old.xls"]) {
      expect(classifyExtraction({ mimeType: null, displayName: name })).toBe(
        "unsupported-binary-document",
      );
    }
  });

  it("marks media as name-only", () => {
    expect(
      classifyExtraction({ mimeType: "image/png", displayName: "shot.png" }),
    ).toBe("unsupported-media");
  });
});

describe("normalizeExtractedText", () => {
  it("strips a BOM, unifies newlines and removes control characters", () => {
    const normalized = normalizeExtractedText("﻿a\r\nbc");
    expect(normalized).toBe("a\nb c");
  });

  it("collapses long runs of blank lines", () => {
    expect(normalizeExtractedText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("chunkExtractedText", () => {
  it("prefers a paragraph boundary over a hard cut", () => {
    const first = "x".repeat(1_900);
    const second = "y".repeat(500);
    const chunks = chunkExtractedText(`${first}\n\n${second}`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text.endsWith("x")).toBe(true);
  });

  it("records anchors that point back into the source", () => {
    const chunks = chunkExtractedText("alpha\n\nbeta");
    expect(chunks[0].anchor.start).toBe(0);
    expect(chunks[0].anchor.kind).toBe("char");
  });

  it("stops at the per-version chunk cap", () => {
    const chunks = chunkExtractedText("word ".repeat(400_000));
    expect(chunks.length).toBeLessThanOrEqual(FILE_CHUNK_MAX_PER_VERSION);
  });

  it("gives each chunk a distinct digest so a score cannot be reused", () => {
    const chunks = chunkExtractedText("alpha\n\nbeta\n\ngamma");
    const digests = new Set(chunks.map((chunk) => chunk.inputDigest));
    expect(digests.size).toBe(chunks.length);
  });
});

describe("extractDocument", () => {
  it("indexes a short text file completely", () => {
    const result = extractDocument({
      bytes: encoder.encode("Aurora research findings about commuters."),
      mimeType: "text/plain",
      displayName: "aurora.txt",
    });
    expect(result.state).toBe(FileExtractionState.INDEXED);
    expect(result.coverage).toBe(1);
    expect(result.chunks).toHaveLength(1);
    expect(result.reason).toBeNull();
  });

  it("reports an unsupported format with a reason and no chunks", () => {
    // An image: still one of the formats nothing reads. PDF moved out of
    // this test when it gained a parser, and the assertion it was making —
    // that an unreadable document says so rather than indexing as empty —
    // is the one that had to survive the move. It is made for PDF in
    // `pdf.test.ts`, per failure mode.
    const result = extractDocument({
      bytes: encoder.encode("\x89PNG"),
      mimeType: "image/png",
      displayName: "diagram.png",
    });
    expect(result.state).toBe(FileExtractionState.UNSUPPORTED);
    expect(result.chunks).toHaveLength(0);
    expect(result.reason).toContain("not read in this version");
  });

  it("reports partial rather than silently claiming full coverage", () => {
    const result = extractDocument({
      bytes: encoder.encode("word ".repeat(400_000)),
      mimeType: "text/plain",
      displayName: "huge.txt",
    });
    expect(result.state).toBe(FileExtractionState.PARTIAL);
    expect(result.coverage).toBeLessThan(1);
    expect(result.reason).toContain("beginning");
  });

  it("does not claim text for an empty file", () => {
    const result = extractDocument({
      bytes: encoder.encode("   \n  "),
      mimeType: "text/plain",
      displayName: "blank.txt",
    });
    expect(result.state).toBe(FileExtractionState.PARTIAL);
    expect(result.chunks).toHaveLength(0);
  });
});

describe("a PDF goes through the same tail as every other document", () => {
  /**
   * The requirement this pins is "nothing downstream changes": a PDF is
   * chunked, budgeted and reported by exactly the code a Markdown file is,
   * because it converges on `resultFromText` like every other format. If a
   * second path ever appears for PDFs, this is where it shows up.
   */
  const TIMEOUT = 30_000;

  it(
    "indexes a readable PDF into chunks, like a text file",
    async () => {
      const body = "Quarterly revenue analysis and commentary. ".repeat(40);
      const result = await extractDocumentAsync({
        bytes: buildPdfFixture({ pages: [body, body] }),
        mimeType: "application/pdf",
        displayName: "brief.pdf",
      });

      expect(result.state).toBe(FileExtractionState.INDEXED);
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.chunks[0].text).toContain("Quarterly revenue");
      expect(result.reason).toBeNull();
      expect(result.coverage).toBeGreaterThan(0.99);
      // The same chunk shape the text path produces, not a PDF-specific one.
      expect(result.chunks[0].anchor.kind).toBe("char");
      expect(result.chunks[0].inputDigest).toMatch(/^[A-Za-z0-9_-]+$/u);
      expect(result.extractorVersion).toBe(FILE_EXTRACTOR_VERSION);
    },
    TIMEOUT,
  );

  it(
    "records a scan as unsupported with a reason, and indexes nothing",
    async () => {
      const result = await extractDocumentAsync({
        bytes: buildPdfFixture({ pages: ["", ""] }),
        mimeType: "application/pdf",
        displayName: "scan.pdf",
      });

      expect(result.state).toBe(FileExtractionState.UNSUPPORTED);
      expect(result.chunks).toHaveLength(0);
      expect(result.reason).toContain("no text layer");
      // The refusal is explicit about why, so a scan is distinguishable from
      // a deployment with no parser.
      expect(result.reason).not.toContain("not read in this deployment");
    },
    TIMEOUT,
  );

  it(
    "marks a one-page PDF cut by the character cap as partial",
    async () => {
      /**
       * The case page-coverage cannot see, and the reason the parser's own
       * `truncated` flag is carried separately from it.
       *
       * One page, read in full as far as pages go, but stopped mid-page by
       * the output character cap. Pages read over pages total is 1/1, and
       * the chunk arithmetic covers all of the text it was handed, so every
       * coverage number says 1.0. Only the flag knows the document
       * continued past where we stopped. Dropping it from the decision was
       * a mutation this suite did not catch until this test existed.
       */
      const page = "Indemnification and limitation of liability. ".repeat(30);
      const result = await extractDocumentAsync({
        bytes: buildPdfFixture({ pages: [page] }),
        mimeType: "application/pdf",
        displayName: "one-page.pdf",
        pdfOptions: { maxOutputChars: 200 },
      });

      expect(result.state).toBe(FileExtractionState.PARTIAL);
      expect(result.reason).toContain("Only the beginning");
    },
    TIMEOUT,
  );

  it(
    "does not claim full coverage for a PDF the parser cut short",
    async () => {
      /**
       * The failure this exists to prevent: the parser stops at its page cap
       * and hands over a prefix, and the tail — measuring coverage against
       * the text it received — reports 1.0 and INDEXED. A 900-page document
       * read to page 200 would be recorded as fully searched.
       */
      const page = "Material contract terms and obligations. ".repeat(5);
      const result = await extractDocumentAsync({
        bytes: buildPdfFixture({
          pages: Array.from({ length: 12 }, () => page),
        }),
        mimeType: "application/pdf",
        displayName: "long.pdf",
        // Parser caps lowered to make the prefix case reachable in a test.
        pdfOptions: { maxPages: 3 },
      });

      expect(result.state).toBe(FileExtractionState.PARTIAL);
      expect(result.coverage).toBeLessThan(0.5);
      expect(result.coverage).toBeGreaterThan(0);
      expect(result.chunks.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

const PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("an OOXML document says what it did not read", () => {
  it("records half a deck as PARTIAL, not as fully indexed", async () => {
    /**
     * The end-to-end shape of the lie, at the boundary a person sees.
     *
     * The arm called `resultFromText(text)` with no `source`, which
     * defaults to `{ truncated: false, coverage: 1 }`, so every cap in
     * `ooxml.ts` was invisible here. A 400-slide deck — training
     * material, a generated report pack, an ordinary conference deck —
     * was recorded INDEXED at coverage 1.0 with no reason while slides
     * 201 to 400 were never opened and could not be found by search.
     */
    const zip = new JSZip();
    for (let index = 1; index <= 400; index += 1) {
      zip.file(
        `ppt/slides/slide${index}.xml`,
        `<p:sld><a:t>Pellucid slide ${index}</a:t></p:sld>`,
      );
    }
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const result = await extractDocumentAsync({
      bytes,
      mimeType: PPTX,
      displayName: "deck.pptx",
    });

    expect(result.state).toBe(FileExtractionState.PARTIAL);
    expect(result.coverage).toBeCloseTo(0.5, 5);
    expect(result.reason).not.toBeNull();

    const text = result.chunks.map((chunk) => chunk.text).join("");
    expect(text).toContain("Pellucid slide 200");
    expect(text).not.toContain("Pellucid slide 201");
  }, 120_000);

  it("does not call a text-dense document damaged", async () => {
    /**
     * Four parts each over the per-part cap exhaust the whole document
     * budget, everything after them is refused, and the extractor yields
     * no text. That used to arrive as `null` and be reported as "could
     * not be unpacked. It may be encrypted or damaged."
     *
     * The document is neither encrypted nor damaged. Telling somebody
     * their file is corrupt sends them to repair a file that is fine,
     * which is worse than telling them nothing.
     */
    const zip = new JSZip();
    for (let index = 1; index <= 8; index += 1) {
      zip.file(
        `ppt/slides/slide${index}.xml`,
        `<a:t>${"A".repeat(9 * 1024 * 1024)}</a:t>`,
      );
    }
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });

    const result = await extractDocumentAsync({
      bytes,
      mimeType: PPTX,
      displayName: "dense.pptx",
    });

    expect(result.state).toBe(FileExtractionState.UNSUPPORTED);
    expect(result.reason).not.toMatch(/encrypted|damaged/iu);
    expect(result.reason).toMatch(/larger than the reader will unpack/iu);
  }, 180_000);

  it("still calls a genuinely wrong archive what it is", async () => {
    // The other direction: `null` is still the answer when the archive is
    // not the document it claims to be, and the old wording is right for
    // that case.
    const zip = new JSZip();
    zip.file("unrelated.xml", "<x>hello</x>");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const result = await extractDocumentAsync({
      bytes,
      mimeType: DOCX,
      displayName: "wrong.docx",
    });

    expect(result.state).toBe(FileExtractionState.UNSUPPORTED);
    expect(result.reason).toMatch(/encrypted or damaged/iu);
  });

  it("leaves an ordinary deck fully indexed", async () => {
    const zip = new JSZip();
    for (let index = 1; index <= 12; index += 1) {
      zip.file(
        `ppt/slides/slide${index}.xml`,
        `<p:sld><a:t>Ordinary slide ${index}</a:t></p:sld>`,
      );
    }
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const result = await extractDocumentAsync({
      bytes,
      mimeType: PPTX,
      displayName: "small.pptx",
    });

    expect(result.state).toBe(FileExtractionState.INDEXED);
    expect(result.coverage).toBe(1);
    expect(result.reason).toBeNull();
  });
});
