import { parseTableCsv } from "@sokosumi/utils";

import { unprocessableEntity } from "@/helpers/error";
import { gscPropertyCovers } from "./native-gsc-property";

export const MAX_CONSOLE_EXPORT_BYTES = 256 * 1024;
export const MAX_CONSOLE_EXPORT_ROWS = 1000;
export const CONSOLE_LINK_EXPORTS = [
  "linked_pages",
  "internal_pages",
  "linking_sites",
  "anchor_text",
] as const;
export type ConsoleExportKind =
  | (typeof CONSOLE_LINK_EXPORTS)[number]
  | "indexing_examples";
export const exportCountHeaders = {
  incomingLinks: "incoming links",
  linkingSites: "linking sites",
  internalLinks: "internal links",
  linkingPages: "linking pages",
  targetPages: "target pages",
  anchorLinks: "links",
} as const;
export type ConsoleExportCounts = Partial<
  Record<keyof typeof exportCountHeaders, number>
>;
export type ConsoleExportRow = { key: string; counts: ConsoleExportCounts };

const expectedHeaders: Record<ConsoleExportKind, string[][]> = {
  linked_pages: [["target page", "incoming links", "linking sites"]],
  internal_pages: [
    ["target page", "internal links"],
    ["target page", "incoming links"],
  ],
  linking_sites: [["linking site", "linking pages", "target pages"]],
  anchor_text: [
    ["link text"],
    ["link text", "links"],
    ["linking text"],
    ["linking text", "links"],
  ],
  indexing_examples: [["url", "last crawled"]],
};

function parseCount(raw: string): number {
  const value = raw.trim();
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(value)) {
    throw unprocessableEntity("Invalid link count");
  }
  const count = Number(value.replaceAll(",", ""));
  if (!Number.isSafeInteger(count))
    throw unprocessableEntity("Invalid link count");
  return count;
}

function rowKey(
  raw: string,
  kind: ConsoleExportKind,
  propertyId: string,
): string {
  const value = raw.trim();
  if (kind === "anchor_text") {
    if (value.length > 1024 || /\p{Cc}/u.test(value))
      throw unprocessableEntity("Invalid link text");
    return value;
  }
  if (kind === "linking_sites") {
    if (
      value.length > 253 ||
      !/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(
        value,
      )
    ) {
      throw unprocessableEntity("Invalid linking site domain");
    }
    return value.toLowerCase();
  }
  if (value.length > 2048 || !URL.canParse(value))
    throw unprocessableEntity("Invalid page URL");
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !gscPropertyCovers(propertyId, [url.href])
  ) {
    throw unprocessableEntity("CSV page URL is outside the selected property");
  }
  url.hash = "";
  return url.href;
}

export function parseConsoleExport(
  csv: string,
  kind: ConsoleExportKind,
  propertyId: string,
): ConsoleExportRow[] {
  if (Buffer.byteLength(csv, "utf8") > MAX_CONSOLE_EXPORT_BYTES)
    throw unprocessableEntity("CSV exceeds 256 KiB");
  let table: string[][];
  try {
    table = parseTableCsv(csv, {
      maxRows: MAX_CONSOLE_EXPORT_ROWS,
      preserveEmptyRows: kind === "anchor_text",
    });
  } catch {
    throw unprocessableEntity("Invalid CSV or more than 1,000 data rows");
  }
  const headers = table[0].map((header) => header.trim().toLowerCase());
  const layout = expectedHeaders[kind].find(
    (expected) =>
      expected.length === headers.length &&
      expected.every((header) => headers.includes(header)),
  );
  if (!layout)
    throw unprocessableEntity("CSV headers do not match the selected report");
  const keyIndex = headers.indexOf(layout[0]);
  const rows = new Map<string, ConsoleExportRow>();
  for (const fields of table.slice(1)) {
    const key = rowKey(fields[keyIndex], kind, propertyId);
    const counts: ConsoleExportCounts = {};
    for (const metric of Object.keys(
      exportCountHeaders,
    ) as (keyof ConsoleExportCounts)[]) {
      const index = headers.indexOf(exportCountHeaders[metric]);
      if (index >= 0)
        counts[kind === "internal_pages" ? "internalLinks" : metric] =
          parseCount(fields[index]);
    }
    const previous = rows.get(key);
    if (previous && JSON.stringify(previous.counts) !== JSON.stringify(counts))
      throw unprocessableEntity("Duplicate entry has conflicting counts");
    rows.set(key, { key, counts });
  }
  return [...rows.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
}
