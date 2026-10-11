import type { z } from "@hono/zod-openapi";
import JSZip from "jszip";
import { csvField, csvLabel } from "@/helpers/transaction-history-csv";
import type { socialPerformanceAudienceResponseSchema } from "@/schemas/social-statistics-research.schema";

type Cell = string | number | null;
interface ExportSheet {
  name: string;
  rows: Cell[][];
}
type AudiencePage = z.infer<typeof socialPerformanceAudienceResponseSchema>;
const METRICS = [
  "views",
  "impressions",
  "likes",
  "comments",
  "shares",
  "saves",
] as const;

/** Preserve loaded pages and their sample coverage; never imply a complete audience or deduplicate page evidence. */
export function socialStatisticsAudienceExportSheets(
  connectionId: string,
  pages: AudiencePage[],
): ExportSheet[] {
  const provenance = [
    "account_id",
    "page_index",
    "kind",
    "post_id",
    "observed_at",
    "sample_post_count",
    "page_contact_count",
    "oldest_post_at",
    "newest_post_at",
    "next_cursor",
    "coverage",
  ];
  const contacts: Cell[][] = [
    [
      "row_type",
      ...provenance,
      "contact_id",
      "name",
      "username",
      "description",
      "location",
      "avatar_url",
      "followers_count",
      "interactions",
      "replies",
      "quotes",
      "mentions",
      "likes",
      "reposts",
    ],
  ];
  const coverage: Cell[][] = [
    [...provenance, "page_incoming_post_count", "source"],
  ];
  const incoming: Cell[][] = [
    [
      ...provenance,
      "incoming_post_id",
      "interaction_type",
      "author_id",
      "author_name",
      "author_username",
      "published_at",
      "text",
      "url",
      "content_type",
      "post_kind",
      ...METRICS,
      "quote_count",
      "measured_at",
    ],
  ];
  pages.forEach((page, index) => {
    const metadata: Cell[] = [
      connectionId,
      index + 1,
      page.kind,
      page.postId,
      page.observedAt,
      page.samplePostCount,
      page.contacts.length,
      page.oldestPostAt,
      page.newestPostAt,
      page.nextCursor,
      page.coverage,
    ];
    coverage.push([...metadata, page.posts.length, "loaded_client_sample"]);
    const rows = page.contacts.length ? page.contacts : [null];
    for (const contact of rows) {
      contacts.push([
        contact ? "contact" : "page_coverage",
        ...metadata,
        contact?.id ?? null,
        contact?.name ?? null,
        contact?.username ?? null,
        contact?.description ?? null,
        contact?.location ?? null,
        contact?.avatarUrl ?? null,
        contact?.followersCount ?? null,
        contact?.interactions ?? null,
        contact?.replies ?? null,
        contact?.quotes ?? null,
        contact?.mentions ?? null,
        contact?.likes ?? null,
        contact?.reposts ?? null,
      ]);
    }
    for (const evidence of page.posts) {
      incoming.push([
        ...metadata,
        evidence.post.externalId,
        evidence.interactionType,
        evidence.author?.id ?? null,
        evidence.author?.name ?? null,
        evidence.author?.username ?? null,
        evidence.post.publishedAt,
        evidence.post.text,
        evidence.post.url,
        evidence.post.contentType,
        evidence.post.postKind,
        ...METRICS.map((key) => evidence.post.metrics[key]),
        evidence.post.additionalMetrics.find(
          (metric) => metric.key === "quote_count",
        )?.value ?? null,
        evidence.post.fetchedAt,
      ]);
    }
  });
  return [
    { name: "Contacts", rows: contacts },
    { name: "Coverage", rows: coverage },
    { name: "Incoming posts", rows: incoming },
  ];
}

export function socialStatisticsCsv(rows: Cell[][]): string {
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

/** Minimal native OOXML with numeric cells and explicit inline strings; uses installed JSZip. */
export async function socialStatisticsXlsx(
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
  sheets.forEach((sheet, i) =>
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
    ),
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
