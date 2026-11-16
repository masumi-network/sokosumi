import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  formatNumber,
  MAX_ROWS,
  readSpreadsheet,
  spreadsheetKind,
} from "./spreadsheet-file";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function workbook(sheets: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const names = Object.keys(sheets);
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${names
      .map(
        (name, index) =>
          `<sheet name="${name}" sheetId="${index + 1}" r:id="rId${index + 1}"${
            name === "Hidden" ? ' state="hidden"' : ""
          }/>`,
      )
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<sst xmlns="${MAIN}"><si><t>Metric</t></si><si><r><t>Reve</t></r><r><t>nue</t></r></si></sst>`,
  );
  zip.file(
    "xl/styles.xml",
    `<styleSheet xmlns="${MAIN}">
      <numFmts><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/></numFmts>
      <fonts><font/><font><b/></font></fonts>
      <cellXfs>
        <xf numFmtId="0" fontId="0"/>
        <xf numFmtId="0" fontId="1"/>
        <xf numFmtId="164" fontId="0"/>
        <xf numFmtId="10" fontId="0"/>
        <xf numFmtId="15" fontId="0"/>
      </cellXfs>
    </styleSheet>`,
  );
  names.forEach((name, index) => {
    zip.file(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<worksheet xmlns="${MAIN}"><sheetData>${sheets[name]}</sheetData></worksheet>`,
    );
  });
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("readSpreadsheet", () => {
  it("reads an Excel sheet the way Excel shows it", async () => {
    const bytes = await workbook({
      Model: `
        <row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Note</t></is></c></row>
        <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="2"><v>1234567</v></c><c r="C2" s="3"><v>0.125</v></c></row>
        <row r="3"><c r="A3" s="4"><v>45231</v></c><c r="B3" t="b"><v>1</v></c><c r="C3"><f>A1</f></c></row>`,
      Hidden: `<row r="1"><c r="A1"><v>1</v></c></row>`,
    });

    const sheets = await readSpreadsheet("xlsx", bytes);

    expect(sheets.map((sheet) => sheet.name)).toEqual(["Model"]);
    const text = sheets[0].rows.map((row) => row.map((cell) => cell.text));
    expect(text).toEqual([
      ["Metric", "", "Note"],
      ["Revenue", "$1,234,567", "12.50%"],
      ["1-Nov-23", "TRUE", ""],
    ]);
    expect(sheets[0].rows[0][0].bold).toBe(true);
    expect(sheets[0].rows[1][1].numeric).toBe(true);
    expect(sheets[0].truncated).toBe(false);
  });

  it("stops at the row cap and says so", async () => {
    const rows = Array.from(
      { length: MAX_ROWS + 5 },
      (_, index) =>
        `<row r="${index + 1}"><c r="A${index + 1}"><v>${index}</v></c></row>`,
    ).join("");
    const [sheet] = await readSpreadsheet(
      "xlsx",
      await workbook({ Big: rows }),
    );
    expect(sheet.rows).toHaveLength(MAX_ROWS);
    expect(sheet.truncated).toBe(true);
  });

  it("reads a CSV export, ragged rows and blank headers included", async () => {
    const csv = new TextEncoder().encode(
      ',Q1,Q2\nRevenue,"1,200",900\nNotes\n',
    );
    const [sheet] = await readSpreadsheet("csv", csv.buffer);
    expect(sheet.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ["", "Q1", "Q2"],
      ["Revenue", "1,200", "900"],
      ["Notes"],
    ]);
    expect(sheet.rows[1][1].numeric).toBe(true);
  });

  it("brings a chart Google Sheets exported as a picture", async () => {
    const zip = await JSZip.loadAsync(
      await workbook({
        Model: `<row r="1"><c r="A1"><v>1</v></c></row>`,
        Chart: "",
      }),
    );
    zip.file(
      "xl/worksheets/_rels/sheet2.xml.rels",
      `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/drawings/_rels/drawing1.xml.rels",
      `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/Chart1.png"/></Relationships>`,
    );
    zip.file("xl/media/Chart1.png", new Uint8Array([137, 80, 78, 71]));

    const [model, chart] = await readSpreadsheet(
      "xlsx",
      await zip.generateAsync({ type: "arraybuffer" }),
    );

    expect(model.images).toEqual([]);
    expect(chart.rows).toEqual([]);
    expect(chart.images).toEqual(["data:image/png;base64,iVBORw=="]);
  });

  it("refuses a file that is not a workbook", async () => {
    const zip = await new JSZip().generateAsync({ type: "arraybuffer" });
    await expect(readSpreadsheet("xlsx", zip)).rejects.toThrow();
  });
});

describe("formatNumber", () => {
  it.each([
    [1234.5, "General", "1234.5"],
    [0.1 + 0.2, "General", "0.3"],
    [1234.567, "#,##0.00", "1,234.57"],
    [-1234, "#,##0 ;(#,##0)", "(1,234)"],
    [0.0525, "0.0%", "5.3%"],
    [2500000, '#,##0.0,,"M"', "2.5M"],
    [1500, "[$€-407]#,##0", "€1,500"],
    [12, '0" months"', "12 months"],
    [45231, "yyyy-mm-dd", "2023-11-01"],
    [45231.5, "d mmm yyyy h:mm", "1 Nov 2023 12:00"],
    [0.75, "h:mm AM/PM", "6:00 PM"],
  ])("formats %s as %s → %s", (value, format, expected) => {
    expect(formatNumber(value, format)).toBe(expected);
  });
});

describe("spreadsheetKind", () => {
  it("knows Excel and CSV by type or name, and nothing else", () => {
    expect(spreadsheetKind("", "Model.XLSX")).toBe("xlsx");
    expect(spreadsheetKind("text/csv", "export")).toBe("csv");
    expect(spreadsheetKind("application/pdf", "Deck.pdf")).toBeNull();
    expect(spreadsheetKind("application/vnd.ms-excel", "Old.xls")).toBeNull();
  });
});
