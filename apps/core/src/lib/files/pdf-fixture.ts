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
function contentStream(text: string): string {
  if (text.length === 0) return "<< /Length 0 >>\nstream\n\nendstream";

  const lines: string[] = [];
  for (
    let at = 0;
    at < text.length && lines.length < MAX_LINES;
    at += LINE_CHARS
  ) {
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

  return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
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
  const objects: string[] = [];
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((text, index) => {
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
