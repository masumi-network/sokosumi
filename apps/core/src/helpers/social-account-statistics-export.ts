import JSZip from "jszip";
import { csvField, csvLabel } from "@/helpers/transaction-history-csv";
import type { SocialAccountPost } from "@/schemas/social-account-statistics.schema";

type Cell = string | number | null;
interface ExportSheet {
  name: string;
  rows: Cell[][];
}

const METRICS = [
  "views",
  "impressions",
  "likes",
  "comments",
  "shares",
  "saves",
] as const;

export function socialAccountStatisticsExportSheets({
  posts,
  accountName,
  publishedFrom,
  publishedUntil,
}: {
  posts: SocialAccountPost[];
  accountName: (connectionId: string) => string;
  publishedFrom?: Date;
  publishedUntil?: Date;
}): ExportSheet[] {
  const additionalKeys = [
    ...new Set(
      posts.flatMap((post) =>
        post.additionalMetrics.map((metric) => metric.key),
      ),
    ),
  ].sort();
  return [
    {
      name: "posts",
      rows: [
        [
          "platform",
          "account",
          "published_at",
          "text",
          "url",
          ...METRICS,
          ...additionalKeys,
          "publication_from",
          "publication_until",
        ],
        ...posts.map((post) => [
          post.provider,
          accountName(post.connectionId),
          post.publishedAt,
          post.text,
          post.url,
          ...METRICS.map((key) => post.metrics[key]),
          ...additionalKeys.map(
            (key) =>
              post.additionalMetrics.find((metric) => metric.key === key)
                ?.value ?? null,
          ),
          publishedFrom?.toISOString() ?? null,
          publishedUntil?.toISOString() ?? null,
        ]),
      ],
    },
  ];
}

export function socialAccountStatisticsCsv(rows: Cell[][]): string {
  return `${rows
    .map((row) =>
      row
        .map((value) =>
          csvField(
            typeof value === "string"
              ? csvLabel(value)
              : value === null
                ? ""
                : String(value),
          ),
        )
        .join(","),
    )
    .join("\r\n")}\r\n`;
}

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function column(index: number): string {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

/** Minimal OOXML. One sheet, numbers stay numbers, text is escaped. */
export async function socialAccountStatisticsXlsx(
  sheets: ExportSheet[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  zip.file(
    "[Content_Types].xml",
    `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `${declaration}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (sheet, i) =>
          `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  for (const [i, sheet] of sheets.entries()) {
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `${declaration}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.rows
        .map(
          (row, j) =>
            `<row r="${j + 1}">${row
              .map((value, k) =>
                value === null
                  ? ""
                  : typeof value === "number"
                    ? `<c r="${column(k)}${j + 1}"><v>${value}</v></c>`
                    : `<c r="${column(k)}${j + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`,
              )
              .join("")}</row>`,
        )
        .join("")}</sheetData></worksheet>`,
    );
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
