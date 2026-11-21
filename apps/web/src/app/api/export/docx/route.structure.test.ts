import JSZip from "jszip";
import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

// Only the session and the Core export lease are faked: the conversion itself is real.
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: async () => ok({ user: { id: "user-1" } }),
}));
vi.mock("@/lib/services/export.service", () => ({
  withExportOperation: (
    request: Request,
    operation: (signal: AbortSignal) => Promise<Response>,
  ) => operation(request.signal),
}));

import { POST } from "./route";

/** A typical Task result: headings, both list kinds and a table. */
const RESULT = [
  "# Launch plan",
  "",
  "## Channels",
  "",
  "- Newsletter",
  "- LinkedIn",
  "  - Company page",
  "",
  "1. Draft",
  "2. Review",
  "",
  "| Channel | Budget |",
  "| --- | --- |",
  "| Ads | 500 |",
].join("\n");

describe("POST /api/export/docx structure", () => {
  it("keeps a result's headings, lists and table in the Word file", async () => {
    const response = await POST(
      new Request("http://localhost/api/export/docx", {
        method: "POST",
        body: JSON.stringify({ markdown: RESULT, fileName: "Launch plan" }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      'filename="Launch_plan.docx"',
    );
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";

    // The first heading titles the document; the next level is Word's Heading 1.
    expect(xml).toMatch(/<w:pStyle w:val="Title"\/>/);
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/>/);
    // One list marker per item: a second `numPr` in a paragraph is invalid Word XML.
    expect(xml.match(/<w:numPr>.*?<\/w:numPr>/g)).toEqual([
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>',
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>',
      // A nested list keeps its level.
      '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr>',
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr>',
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr>',
    ]);
    expect(xml).toContain("<w:tbl>");
    // A `solid` header fill paints the pattern colour (black) over the text; `clear` shows the fill.
    expect(xml).not.toContain('w:val="solid"');
    expect(xml.match(/<w:shd [^>]*\/>/g)).toEqual(
      Array(2).fill('<w:shd w:fill="b79c2f" w:val="clear"/>'),
    );
    expect(xml).toMatch(/w:val="clear"\/>.*?<w:b\/>.*?Channel</);
    for (const text of ["Launch plan", "LinkedIn", "Review", "Budget", "500"])
      expect(xml).toContain(text);
  });
});
