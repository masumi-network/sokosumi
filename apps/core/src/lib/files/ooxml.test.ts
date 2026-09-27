import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { extractDocumentAsync, FILE_CHUNK_MAX_PER_VERSION } from "./extraction";
import {
  buildJevLabelRequest,
  isJevRequestRejection,
  LABEL_EVALUATION_CEILINGS,
} from "./jev-request";
import { extractOoxmlText, ooxmlKindFor, stripXmlTags } from "./ooxml";

/**
 * Reading text out of Office documents, and refusing to read what we should
 * not.
 *
 * The archives here are built in the test rather than committed as
 * fixtures: an OOXML file is a ZIP of XML parts, so the real structure is a
 * few lines of `jszip`, and a reader can see exactly what is being parsed.
 */

async function buildDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

async function buildPptx(slides: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  slides.forEach((text, index) => {
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      `<?xml version="1.0"?><p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`,
    );
  });
  return zip.generateAsync({ type: "uint8array" });
}

describe("ooxmlKindFor", () => {
  it.each([
    ["report.docx", null, "docx"],
    ["deck.pptx", null, "pptx"],
    ["budget.xlsx", null, "xlsx"],
    [
      "unnamed",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "docx",
    ],
  ])("recognises %s", (name, mime, expected) => {
    expect(ooxmlKindFor({ displayName: name, mimeType: mime })).toBe(expected);
  });

  it.each([["notes.md"], ["scan.pdf"], ["legacy.doc"], ["photo.png"]])(
    "does not claim %s",
    (name) => {
      expect(ooxmlKindFor({ displayName: name, mimeType: null })).toBeNull();
    },
  );
});

describe("stripXmlTags", () => {
  it("keeps the text and drops the markup", () => {
    expect(stripXmlTags("<w:t>Quarterly report</w:t>")).toBe(
      "Quarterly report",
    );
  });

  it("separates paragraphs so words do not fuse", () => {
    const text = stripXmlTags(
      "<w:p><w:t>first</w:t></w:p><w:p><w:t>second</w:t></w:p>",
    );
    expect(text).toContain("first");
    expect(text).toContain("second");
    expect(text).not.toContain("firstsecond");
  });

  it("decodes the five predefined entities", () => {
    expect(
      stripXmlTags("<t>a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;</t>"),
    ).toBe(`a & b <c> "d" 'e'`);
  });

  it("decodes a numeric reference inside the BMP and drops what is outside", () => {
    expect(stripXmlTags("<t>&#65;&#x42;</t>")).toBe("AB");
    // Above the BMP: dropped rather than guessed at.
    expect(stripXmlTags("<t>&#x1F600;</t>")).toBe("");
  });

  it("does not expand an unknown entity", () => {
    // The XXE shape: a real parser might resolve this, a character scan
    // cannot, and that is the point of not using one.
    expect(stripXmlTags("<t>&xxe;</t>")).toBe("");
    expect(stripXmlTags("<t>a&nbsp;b</t>")).toBe("ab");
  });

  it("leaves a bare ampersand alone rather than scanning forever", () => {
    expect(stripXmlTags("<t>Tom & Jerry</t>")).toBe("Tom & Jerry");
  });
});

describe("extractOoxmlText", () => {
  it("reads a Word document in order", async () => {
    const bytes = await buildDocx(["First paragraph.", "Second paragraph."]);
    const text = await extractOoxmlText(bytes, "docx");

    expect(text).toContain("First paragraph.");
    expect(text).toContain("Second paragraph.");
    expect(text?.indexOf("First")).toBeLessThan(text?.indexOf("Second") ?? 0);
  });

  it("reads slides in numeric order, not lexical", async () => {
    const slides = Array.from({ length: 11 }, (_, i) => `Slide ${i + 1} body`);
    const bytes = await buildPptx(slides);
    const text = await extractOoxmlText(bytes, "pptx");

    // "slide10.xml" sorts before "slide2.xml" as a string; it must not here.
    expect(text?.indexOf("Slide 2 body")).toBeLessThan(
      text?.indexOf("Slide 10 body") ?? 0,
    );
  });

  it("returns null for something that is not an archive", async () => {
    const text = await extractOoxmlText(
      new TextEncoder().encode("this is not a zip"),
      "docx",
    );
    expect(text).toBeNull();
  });

  it("returns null for an archive without the part it expects", async () => {
    const zip = new JSZip();
    zip.file("unrelated.xml", "<x>hello</x>");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    expect(await extractOoxmlText(bytes, "docx")).toBeNull();
  });

  it("refuses a part that inflates past the cap instead of holding it", async () => {
    // A zip bomb in miniature: highly compressible, far over the per-part
    // ceiling once inflated.
    const zip = new JSZip();
    zip.file("word/document.xml", "A".repeat(9 * 1024 * 1024));
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    // Compresses to a tiny archive, which is the whole danger.
    expect(bytes.byteLength).toBeLessThan(200_000);

    expect(await extractOoxmlText(bytes, "docx")).toBeNull();
  });
});

describe("extractDocumentAsync", () => {
  it("indexes a Word document", async () => {
    const bytes = await buildDocx([
      "Findings about bicycle commuters and their travel patterns.",
    ]);

    const result = await extractDocumentAsync({
      bytes,
      mimeType: null,
      displayName: "commuters.docx",
    });

    expect(result.state).toBe("INDEXED");
    expect(result.reason).toBeNull();
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0].text).toContain("bicycle commuters");
  });

  it("marks a PDF unsupported, with a reason, rather than indexing it empty", async () => {
    const result = await extractDocumentAsync({
      bytes: new TextEncoder().encode("%PDF-1.4 ..."),
      mimeType: "application/pdf",
      displayName: "scan.pdf",
    });

    expect(result.state).toBe("UNSUPPORTED");
    expect(result.chunks).toHaveLength(0);
    expect(result.reason).toContain("PDF text is not read");
    // The promise the reader is given: still findable, still downloadable.
    expect(result.reason).toContain("findable by name");
  });

  it("marks an unopenable Office file unsupported rather than throwing", async () => {
    const result = await extractDocumentAsync({
      bytes: new TextEncoder().encode("not really a docx"),
      mimeType: null,
      displayName: "broken.docx",
    });

    expect(result.state).toBe("UNSUPPORTED");
    expect(result.reason).toContain("could not be unpacked");
  });

  it("still handles plain text through the same budgets", async () => {
    const result = await extractDocumentAsync({
      bytes: new TextEncoder().encode("# Notes\n\nOrdinary Markdown."),
      mimeType: "text/markdown",
      displayName: "notes.md",
    });

    expect(result.state).toBe("INDEXED");
    expect(result.chunks[0].text).toContain("Ordinary Markdown.");
  });
});

describe("a large document against the budgets that already exist", () => {
  /**
   * A Word file can carry far more text than a Markdown one, so the caps
   * sized for text files are worth re-checking rather than assuming.
   */
  it("bounds a huge document by the same extraction caps as text", async () => {
    const paragraph =
      "Commuter research paragraph with enough words to matter.";
    const bytes = await buildDocx(
      Array.from({ length: 40_000 }, () => paragraph),
    );

    const result = await extractDocumentAsync({
      bytes,
      mimeType: null,
      displayName: "huge.docx",
    });

    // Partial, not silently truncated to look complete.
    expect(result.state).toBe("PARTIAL");
    expect(result.reason).toContain("Only the beginning");
    expect(result.chunks.length).toBeLessThanOrEqual(
      FILE_CHUNK_MAX_PER_VERSION,
    );
    expect(result.coverage).toBeLessThan(1);
  });

  it("keeps a Jev label request inside its ceiling whatever the document size", async () => {
    const paragraph =
      "Commuter research paragraph with enough words to matter.";
    const bytes = await buildDocx(
      Array.from({ length: 40_000 }, () => paragraph),
    );
    const extracted = await extractDocumentAsync({
      bytes,
      mimeType: null,
      displayName: "huge.docx",
    });

    // The suggestion path sends the first few chunks as the excerpt.
    const excerpt = extracted.chunks
      .slice(0, 3)
      .map((chunk) => chunk.text)
      .join("\n\n");

    const request = buildJevLabelRequest({
      documentExcerpt: excerpt,
      vocabulary: [{ id: "label-1", name: "Commuting", description: null }],
      projects: [],
    });

    expect(isJevRequestRejection(request)).toBe(false);
    if (isJevRequestRejection(request)) return;
    // The ceiling now counts the envelope too, so this is the whole request.
    expect(request.tokens).toBeLessThanOrEqual(LABEL_EVALUATION_CEILINGS.total);
  });
});
