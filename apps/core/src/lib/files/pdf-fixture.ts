/**
 * Minimal, structurally valid PDFs, built in memory for tests.
 *
 * A checked-in binary fixture would be opaque: a reader could not tell what
 * the parser is being asked to do, and could not vary it. These are a few
 * hundred bytes of PDF syntax with a correct cross-reference table, so a
 * test can say "three pages, this text on each" and the reader can see
 * exactly that.
 *
 * Only ever used by tests. It lives beside the module it exercises rather
 * than in a test file because more than one test file needs it.
 */

import { deflateSync } from "node:zlib";

export interface PdfFixtureOptions {
  /** One string per page. An empty string gives a page with no text. */
  pages: string[];
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
/**
 * Characters per line.
 *
 * Sized for the *widest* glyph rather than an average one. Helvetica's `W`
 * is 0.944 em, so at 12pt each one takes 11.33pt and 45 of them need 510pt
 * of the 532pt between the margins. Eighty characters looked fine for prose
 * and clipped a page of capitals; sixty still clipped a page of `W`. A
 * fixture that drops the tail of its own text makes a cap test pass because
 * the text never arrived, so this is sized for the worst case and checked
 * by `pdf-fixture.test.ts` rather than by eye.
 */
const LINE_CHARS = 45;
const LINE_LEADING = 14;
const TOP_MARGIN = 40;
const MAX_LINES = Math.floor((PAGE_HEIGHT - TOP_MARGIN * 2) / LINE_LEADING);

/**
 * Lay the page's text out as lines, not as one long run.
 *
 * Found the hard way. A single `Td` followed by the whole string puts most
 * of the text past the right edge of the page, and a PDF reader does not
 * return glyphs that fall outside the media box — a 400-character page came
 * back as 35 characters. A fixture that silently drops 90% of its content
 * makes a cap test pass for the wrong reason: the cap never fires because
 * the text never arrives.
 */
/**
 * Compress the content stream, and do it by default.
 *
 * Not for size — these files are under 2 KB either way. An uncompressed
 * content stream leaves the page's text in the file as plain ASCII, so
 * `grep` finds it in the raw bytes. That is fatal to any *end-to-end* proof
 * built on one of these fixtures: if a marker string can reach a stored
 * excerpt without the parser having run, then finding the marker in the
 * excerpt proves nothing about the parser. FlateDecode makes the text
 * unrecoverable by a byte-level read, so the marker's presence downstream
 * can only mean a PDF reader produced it.
 *
 * It also means every test here exercises pdfjs's Flate path, which is what
 * a real PDF uses, rather than an uncompressed stream that almost none do.
 */
/** Characters one physical page can hold at this layout. */
const PAGE_CAPACITY = LINE_CHARS * MAX_LINES;

/**
 * Spread one requested page's text over as many physical pages as it needs.
 *
 * The layout previously stopped at `MAX_LINES` and threw the rest away, so
 * asking for a 10,000 character page produced 2,250 characters and no
 * error. That is the defect this file's own comment says it exists to
 * prevent — "a fixture that drops the tail of its own text makes a cap test
 * pass because the text never arrived" — reintroduced at a different
 * threshold, and it is the direct reason a truncation bug at ~143 KB of
 * extracted output survived: reaching it needs 64 pages and nothing in the
 * suite used more than 12.
 *
 * Paginating rather than throwing, because the callers that matter want to
 * say "give me this much text" without doing the arithmetic themselves.
 * An empty page stays one empty page: that is how a scan is asked for.
 */
function paginate(text: string): string[] {
  if (text.length === 0) return [""];

  const out: string[] = [];
  for (let at = 0; at < text.length; at += PAGE_CAPACITY) {
    out.push(text.slice(at, at + PAGE_CAPACITY));
  }
  return out;
}

function contentStream(text: string): string {
  if (text.length === 0) {
    // An empty stream has nothing to hide and nothing to compress.
    return "<< /Length 0 >>\nstream\n\nendstream";
  }

  // No clamp here. `paginate` has already guaranteed this text fits one
  // page, so a limit at this level could only silently discard text —
  // which is the bug being fixed.
  const lines: string[] = [];
  for (let at = 0; at < text.length; at += LINE_CHARS) {
    lines.push(text.slice(at, at + LINE_CHARS));
  }

  const body = lines
    .map((line, index) => {
      // Backslash and both parentheses are the three characters a PDF
      // string literal cannot carry raw.
      const escaped = line.replace(/([\\()])/gu, "\\$1");
      const y = PAGE_HEIGHT - TOP_MARGIN - index * LINE_LEADING;
      return `BT /F1 12 Tf 40 ${y} Td (${escaped}) Tj ET`;
    })
    .join("\n");

  // latin1 round-trips arbitrary bytes one-for-one, so the deflated stream
  // can travel as a string and be recovered exactly when the file is
  // encoded back to bytes.
  const deflated = deflateSync(Buffer.from(body, "latin1")).toString("latin1");
  return (
    `<< /Length ${deflated.length} /Filter /FlateDecode >>\n` +
    `stream\n${deflated}\nendstream`
  );
}

/**
 * Build a PDF with a real text layer.
 *
 * The object numbering is fixed and simple: 1 catalog, 2 page tree, 3 font,
 * then a page and a content stream per page. The xref offsets are computed
 * from the bytes actually written, so the file is well-formed rather than
 * merely accepted by a lenient parser — a fixture that only works because
 * the reader recovers from a broken xref would not be testing what it looks
 * like it is testing.
 */
export function buildPdfFixture({ pages }: PdfFixtureOptions): Uint8Array {
  const laidOut = pages.flatMap(paginate);
  const objects: string[] = [];
  const kids = laidOut.map((_, index) => `${4 + index * 2} 0 R`).join(" ");

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${laidOut.length} >>`;
  /**
   * `WinAnsiEncoding`, explicitly.
   *
   * Without it the font uses StandardEncoding, which maps 0x27 to
   * `quoteright` and 0x60 to `quoteleft` — so an apostrophe goes in and a
   * typographic quote comes out. Every printable ASCII character round
   * trips except those two, which is exactly the kind of exception that
   * turns a future marker string like "doesn't reconcile" into a failing
   * assertion about something the test was not testing.
   */
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica " +
    "/Encoding /WinAnsiEncoding >>";

  laidOut.forEach((text, index) => {
    const pageNumber = 4 + index * 2;
    const contentNumber = pageNumber + 1;
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Contents ${contentNumber} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[contentNumber] = contentStream(text);
  });

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 1; index < objects.length; index++) {
    if (!objects[index]) continue;
    offsets[index] = body.length;
    body += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = body.length;
  const size = objects.length;
  body += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let index = 1; index < size; index++) {
    body +=
      offsets[index] === undefined
        ? "0000000000 65535 f \n"
        : `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(body, "latin1"));
}
