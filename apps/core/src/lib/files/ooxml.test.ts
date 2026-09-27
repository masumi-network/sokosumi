import { deflateRawSync } from "node:zlib";

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

/**
 * A ZIP whose central directory **lies** about how large a part inflates to.
 *
 * `jszip` reads sizes straight out of these headers, so this is the shape
 * that defeated the old pre-inflate check: it declares `declaredSize` while
 * the deflate stream really expands to `realBytes`.
 */
function archiveDeclaringSize(input: {
  path: string;
  realBytes: number;
  declaredSize: number;
}): Uint8Array {
  const compressed = deflateRawSync(Buffer.alloc(input.realBytes, 0x41), {
    level: 9,
  });
  const name = Buffer.from(input.path, "utf8");

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(input.declaredSize, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(input.declaredSize, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(local.length + name.length + compressed.length, 16);

  return new Uint8Array(
    Buffer.concat([local, name, compressed, central, name, eocd]),
  );
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
    const text = (await extractOoxmlText(bytes, "docx"))?.text;

    expect(text).toContain("First paragraph.");
    expect(text).toContain("Second paragraph.");
    expect(text?.indexOf("First")).toBeLessThan(text?.indexOf("Second") ?? 0);
  });

  it("reads slides in numeric order, not lexical", async () => {
    const slides = Array.from({ length: 11 }, (_, i) => `Slide ${i + 1} body`);
    const bytes = await buildPptx(slides);
    const text = (await extractOoxmlText(bytes, "pptx"))?.text;

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

    /**
     * It yields no text, and it now says why rather than returning a bare
     * `null`. The distinction matters at the caller: `null` is reported as
     * "could not be unpacked. It may be encrypted or damaged", and this
     * archive is neither — it is one oversized part. Telling somebody
     * their file is damaged sends them to repair a file that is fine.
     */
    const outcome = await extractOoxmlText(bytes, "docx");

    expect(outcome).not.toBeNull();
    expect(outcome?.text).toBe("");
    expect(outcome?.shortfall).toBe("part-bytes");
    expect(outcome?.truncated).toBe(true);
    expect(outcome?.coverage).toBe(0);
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

  it("marks a damaged PDF unsupported, with a reason, rather than indexing it empty", async () => {
    /**
     * These bytes are a PDF header and nothing else. They used to be
     * refused before any parser saw them; now they reach the sandboxed
     * reader and come back as unparseable. The reason string therefore
     * changed, and the assertion it was making did not: an unreadable
     * document says why, and indexes nothing, rather than being recorded
     * as searched and empty.
     */
    const result = await extractDocumentAsync({
      bytes: new TextEncoder().encode("%PDF-1.4 ..."),
      mimeType: "application/pdf",
      displayName: "damaged.pdf",
    });

    expect(result.state).toBe("UNSUPPORTED");
    expect(result.chunks).toHaveLength(0);
    expect(result.reason).toContain("could not be parsed");
  }, 30_000);

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

describe("bounds that cannot be computed from what the archive claims", () => {
  it("refuses a part that lies about its size, without inflating it", async () => {
    // 128 MiB of real content behind a declared size of 100 bytes. The old
    // guard read the declared number, believed it, and then inflated the
    // whole part anyway; at 700 MiB that was a V8 fatal OOM, which is not a
    // throw and so took the process rather than returning null.
    //
    // Asserting `null` alone would not show the bound holds — the old code
    // eventually returned null too, after spending the memory. So this
    // measures what was actually spent.
    const archive = archiveDeclaringSize({
      path: "word/document.xml",
      realBytes: 128 * 1024 * 1024,
      declaredSize: 100,
    });
    expect(archive.byteLength).toBeLessThan(1024 * 1024);

    const before = process.memoryUsage().heapUsed;
    const outcome = await extractOoxmlText(archive, "docx");
    const spent = process.memoryUsage().heapUsed - before;

    // No text, and the cap that stopped it is named rather than the
    // document being reported as damaged.
    expect(outcome?.text).toBe("");
    expect(outcome?.shortfall).toBe("part-bytes");
    // The part cap is 8 MiB; inflating the real 128 MiB would cost at least
    // an order of magnitude more than this ceiling.
    expect(spent).toBeLessThan(48 * 1024 * 1024);
  }, 60_000);

  it("reads an honest archive of the same shape", async () => {
    // The guard must refuse the lie, not the format: a part that really is
    // small still extracts.
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      "<w:document><w:p><w:t>Honest content</w:t></w:p></w:document>",
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const outcome = await extractOoxmlText(bytes, "docx");

    expect(outcome?.text).toContain("Honest content");
    // And it is reported as complete, which is the other half: a coverage
    // signal that fires on healthy documents is as useless as one that
    // never fires.
    expect(outcome?.truncated).toBe(false);
    expect(outcome?.coverage).toBe(1);
    expect(outcome?.shortfall).toBeNull();
  });

  it("strips a part full of bare ampersands in linear time", async () => {
    // Each `&` used to trigger an `indexOf(";")` that scanned to the end of
    // the document, so this was quadratic: 2 MB measured at 22 s and an 8 MB
    // part projected past the 300 s function timeout, synchronously, with
    // the event loop blocked throughout. No malformed archive is needed —
    // 8 MB of ampersands is an honest file inside every size cap.
    const started = Date.now();
    const out = stripXmlTags(`<w:t>${"&".repeat(4_000_000)}</w:t>`);
    const elapsed = Date.now() - started;

    expect(out).toHaveLength(4_000_000);
    // Linear takes well under a second here; the quadratic form took ~90 s
    // for this input, so this threshold separates them by two orders of
    // magnitude rather than measuring the machine.
    expect(elapsed).toBeLessThan(10_000);
  }, 120_000);
});

describe("what the caps discarded reaches the caller", () => {
  /**
   * The arm reported a quiet lie for as long as it existed.
   *
   * `extractOoxmlText` returned a bare string, and the caller passed it to
   * `resultFromText` with no `source`, which defaults to
   * `{ truncated: false, coverage: 1 }`. So any of the four caps here could
   * discard content and the document was still recorded INDEXED at coverage
   * 1.0 with no reason. Measured on a 400-slide deck at the tip: last slide
   * read was 200, state INDEXED, coverage 1, reason null. Half the deck
   * unsearchable while the interface said it was complete.
   *
   * That is the same failure `resultFromText`'s own docstring describes for
   * the PDF arm, which is why the PDF arm passes a `source` and this one
   * now does too.
   */

  it("reports half a deck as half, not as complete", async () => {
    // Twice the enumerated-part cap. Every slide is real and numbered from
    // one, so this is an ordinary large deck rather than a malformed file.
    const slides = Array.from(
      { length: 400 },
      (_, index) => `Slide ${index + 1} body`,
    );

    const outcome = await extractOoxmlText(await buildPptx(slides), "pptx");

    expect(outcome?.text).toContain("Slide 200 body");
    expect(outcome?.text).not.toContain("Slide 201 body");
    expect(outcome?.truncated).toBe(true);
    expect(outcome?.shortfall).toBe("parts");
    // 200 of 400 parts. Not 1.
    expect(outcome?.coverage).toBeCloseTo(0.5, 5);
  }, 60_000);

  it("measures coverage against the document, not against what survived", async () => {
    /**
     * The subtle half, and the one worth stating precisely.
     *
     * A part longer than `MAX_TOTAL_CHARS` is sliced. If the denominator
     * were the text that came out, the ratio would be 1,000,000/1,000,000
     * and the truncation would round away to "complete". The denominator
     * has to be what the part actually held.
     *
     * This is not hypothetical arithmetic: a 1.4M-character .docx was
     * reported at coverage 0.6843, which was the *chunk* cap firing by
     * accident, measured over the million characters that survived. True
     * coverage is about 0.49. Computing this factor correctly is what
     * turns the accident into the answer.
     */
    const held = 1_400_000;
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:t>${"q".repeat(held)}</w:t>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const outcome = await extractOoxmlText(bytes, "docx");

    expect(outcome?.text).toHaveLength(1_000_000);
    expect(outcome?.shortfall).toBe("chars");
    // 1,000,000 of 1,400,000 — the ratio the document implies, not the
    // ratio the output implies.
    expect(outcome?.coverage).toBeCloseTo(1_000_000 / held, 4);
    expect(outcome?.coverage).toBeLessThan(0.72);
  }, 120_000);

  it("says nothing was lost when nothing was", async () => {
    // A signal that fires on healthy documents is as useless as one that
    // never fires, so both directions are pinned.
    const outcome = await extractOoxmlText(
      await buildPptx(["One", "Two", "Three"]),
      "pptx",
    );

    expect(outcome?.truncated).toBe(false);
    expect(outcome?.shortfall).toBeNull();
    expect(outcome?.coverage).toBe(1);
  });
});

describe("parts are found by name, not by enumerating the archive", () => {
  /**
   * `MAX_ENUMERATED_PARTS` was applied as `.slice(0, 200)` *after*
   * `Object.keys(zip.files).filter(...).sort(...)` over every entry in the
   * archive. It bounded how many parts were read and not the cost of
   * deciding which — the thing this module's header calls "a check that
   * runs once the memory is already spent", two paragraphs above the code
   * doing it. The header also claims only named parts are read, which was
   * not true.
   *
   * Measured on an archive of 300,000 matching entries: selecting cost
   * 180 ms of synchronous work in the API process, and 29 ms at 60,000.
   * Probing by name is 0 ms at both.
   *
   * Worth recording honestly: that is not where most of the time goes.
   * `JSZip.loadAsync` on the same archives costs 334 ms and 1,603 ms, and
   * this change does not touch it. The selection was the part that was
   * ours to bound.
   */

  it("reads the contiguous run and ignores a crowd of decoys", async () => {
    const zip = new JSZip();
    for (let index = 1; index <= 5; index += 1) {
      zip.file(`ppt/slides/slide${index}.xml`, `<a:t>Real ${index}</a:t>`);
    }
    // Entries the old prefix filter matched and read: numbered far away,
    // so a numeric sort placed them after the real slides and they
    // consumed 195 of the 200 read slots.
    for (let index = 0; index < 2_000; index += 1) {
      zip.file(`ppt/slides/slide${900_000 + index}.xml`, "<a:t>Decoy</a:t>");
    }
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const outcome = await extractOoxmlText(bytes, "pptx");

    expect(outcome?.text).toContain("Real 5");
    expect(outcome?.text).not.toContain("Decoy");
    // And the decoys do not drag coverage down either: they are not parts
    // of this document, so they are in neither the numerator nor the
    // denominator.
    expect(outcome?.coverage).toBe(1);
    expect(outcome?.shortfall).toBeNull();
  }, 120_000);

  it("steps over a gap rather than stopping at it", async () => {
    // Every producer numbers from 1 with no gaps, but an edited archive
    // need not, and stopping at the first miss would read less than the
    // enumeration did. The lookahead is why this is a replacement rather
    // than a narrowing.
    const zip = new JSZip();
    for (const index of [1, 2, 5, 6]) {
      zip.file(`ppt/slides/slide${index}.xml`, `<a:t>Slide ${index}</a:t>`);
    }
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const outcome = await extractOoxmlText(bytes, "pptx");

    expect(outcome?.text).toContain("Slide 1");
    expect(outcome?.text).toContain("Slide 6");
  });
});
