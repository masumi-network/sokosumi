import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  socialAccountStatisticsCsv,
  socialAccountStatisticsExportSheets,
  socialAccountStatisticsXlsx,
} from "./social-account-statistics-export";

const post = {
  id: "44444444-4444-4444-8444-444444444444",
  connectionId: "33333333-3333-4333-8333-333333333333",
  provider: "x" as const,
  externalId: "123",
  text: "Hello, world",
  publishedAt: "2026-10-01T12:00:00.000Z",
  url: "https://x.com/launch/status/123",
  metrics: {
    views: null,
    impressions: 100,
    likes: 4,
    comments: null,
    shares: 1,
    saves: null,
  },
  additionalMetrics: [
    { key: "quotes", value: 3, period: "lifetime", unit: "count" },
  ],
  fetchedAt: "2026-10-01T13:00:00.000Z",
  strong: false,
  canRecycle: false,
};

describe("social account statistics export", () => {
  it("writes one post table and keeps commas inside quoted text", () => {
    const [sheet] = socialAccountStatisticsExportSheets({
      posts: [post],
      accountName: () => "Launch",
      publishedFrom: new Date("2026-10-01T00:00:00.000Z"),
      publishedUntil: new Date("2026-10-01T23:59:59.999Z"),
    });
    const csv = socialAccountStatisticsCsv(sheet.rows);
    expect(csv).toContain(
      "platform,account,published_at,text,url,views,impressions,likes,comments,shares,saves,quotes,fetched_at,publication_from,publication_until",
    );
    expect(csv).toContain('"Hello, world"');
    expect(csv).toContain("Launch");
    expect(csv).toContain(",100,4,,1,,3,2026-10-01T13:00:00.000Z,");
  });

  it("prefixes spreadsheet-formula text and builds a zip workbook", async () => {
    const [sheet] = socialAccountStatisticsExportSheets({
      posts: [{ ...post, text: "=1+1" }],
      accountName: () => "Launch",
    });
    expect(socialAccountStatisticsCsv(sheet.rows)).toContain("'=1+1");
    const bytes = await socialAccountStatisticsXlsx([sheet]);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});

describe("statistics spreadsheet writers", () => {
  it("escapes user CSV text and preserves numeric zero, negatives, quotes and missing cells", () => {
    expect(
      socialAccountStatisticsCsv([
        ["=CMD()", 0, -2, null, 'Hello,"world"\nnext'],
      ]),
    ).toBe('\'=CMD(),0,-2,,"Hello,""world""\nnext"\r\n');
  });
  it("writes real numeric XLSX cells and inert text with valid workbook relationships", async () => {
    const bytes = await socialAccountStatisticsXlsx([
      { name: "Posts", rows: [["=CMD()", 0, null, "A&B<>\u0001"]] },
      { name: "Definitions", rows: [["semantics", "observed"]] },
    ]);
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file("xl/workbook.xml")?.async("string")).toContain(
      'name="Definitions"',
    );
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    expect(sheet).toContain(
      't="inlineStr"><is><t xml:space="preserve">=CMD()</t>',
    );
    expect(sheet).toContain('<c r="B1"><v>0</v></c>');
    expect(sheet).not.toContain('<c r="C1"');
    expect(sheet).toContain("A&amp;B&lt;&gt;");
    expect(sheet).not.toContain("\u0001");
    expect(
      await zip.file("xl/_rels/workbook.xml.rels")?.async("string"),
    ).toContain('Target="worksheets/sheet2.xml"');
  });
});
