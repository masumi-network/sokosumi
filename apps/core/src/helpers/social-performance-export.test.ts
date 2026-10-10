import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { socialPerformanceAudienceResponseSchema } from "@/schemas/social-performance-research.schema";
import {
  socialPerformanceAudienceExportSheets,
  socialPerformanceCsv,
  socialPerformanceXlsx,
} from "./social-performance-export";

describe("performance spreadsheet exports", () => {
  it("escapes user CSV text and preserves numeric zero, negatives, quotes and missing cells", () => {
    expect(
      socialPerformanceCsv([["=CMD()", 0, -2, null, 'Hello,"world"\nnext']]),
    ).toBe('\'=CMD(),0,-2,,"Hello,""world""\nnext"\r\n');
  });
  it("writes real numeric XLSX cells and inert text with valid workbook relationships", async () => {
    const bytes = await socialPerformanceXlsx([
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

describe("loaded audience sample exports", () => {
  const connectionId = "33333333-3333-4333-8333-333333333333";
  const contact = {
    id: "123",
    name: "=2+2",
    username: "reader",
    description: null,
    location: "A&B",
    avatarUrl: null,
    followersCount: 0,
    interactions: 0,
    replies: 0,
    quotes: null,
    mentions: 0,
    likes: null,
    reposts: null,
  };
  const page = socialPerformanceAudienceResponseSchema.parse({
    kind: "mentions",
    contacts: [contact],
    nextCursor: "next_page",
    observedAt: "2026-10-08T12:00:00Z",
    samplePostCount: 1,
    oldestPostAt: "2026-10-08T11:00:00Z",
    newestPostAt: "2026-10-08T11:00:00Z",
    coverage: "One loaded page; incomplete audience.",
    posts: [
      {
        author: contact,
        interactionType: "mention",
        post: {
          id: "44444444-4444-4444-8444-444444444444",
          connectionId,
          provider: "x",
          externalId: "789",
          text: "@launch received mention",
          publishedAt: "2026-10-08T11:00:00Z",
          url: "https://x.com/reader/status/789",
          metrics: {
            views: null,
            impressions: 0,
            likes: 0,
            comments: null,
            shares: null,
            saves: null,
          },
          additionalMetrics: [
            { key: "quote_count", value: 0, period: "lifetime", unit: "count" },
          ],
          fetchedAt: "2026-10-08T12:00:00Z",
        },
      },
    ],
  });
  it("retains raw per-page contacts, repeated evidence and page coverage with measured zero distinct from null", () => {
    const sheets = socialPerformanceAudienceExportSheets(connectionId, [
      page,
      page,
    ]);
    const headers = sheets[0].rows[0];
    const first = sheets[0].rows[1];
    expect(sheets[0].rows).toHaveLength(3);
    expect(first[headers.indexOf("followers_count")]).toBe(0);
    expect(first[headers.indexOf("likes")]).toBeNull();
    expect(first[headers.indexOf("next_cursor")]).toBe("next_page");
    expect(sheets[0].rows[2][headers.indexOf("page_index")]).toBe(2);
    expect(socialPerformanceCsv(sheets[0].rows)).toContain("'=2+2");
    expect(sheets[1].rows[1]).toContain("loaded_client_sample");
    const incomingHeaders = sheets[2].rows[0];
    expect(sheets[2].rows[1][incomingHeaders.indexOf("incoming_post_id")]).toBe(
      "789",
    );
    expect(sheets[2].rows[1][incomingHeaders.indexOf("quote_count")]).toBe(0);
  });
  it("retains empty-page coverage without manufacturing a contact", () => {
    const empty = {
      ...page,
      contacts: [],
      posts: [],
      samplePostCount: 0,
      oldestPostAt: null,
      newestPostAt: null,
      nextCursor: null,
    };
    const sheets = socialPerformanceAudienceExportSheets(connectionId, [empty]);
    expect(sheets[0].rows[1][0]).toBe("page_coverage");
    expect(
      sheets[0].rows[1][sheets[0].rows[0].indexOf("contact_id")],
    ).toBeNull();
    expect(
      sheets[1].rows[1][sheets[1].rows[0].indexOf("page_contact_count")],
    ).toBe(0);
    expect(sheets[2].rows).toHaveLength(1);
  });
  it("includes Contacts, Coverage and Incoming posts sheets with inert user text and genuine numeric counters", async () => {
    const bytes = await socialPerformanceXlsx(
      socialPerformanceAudienceExportSheets(connectionId, [page]),
    );
    const zip = await JSZip.loadAsync(bytes);
    const workbook = await zip.file("xl/workbook.xml")?.async("string");
    expect(workbook).toContain('name="Contacts"');
    expect(workbook).toContain('name="Coverage"');
    expect(workbook).toContain('name="Incoming posts"');
    const contacts = await zip
      .file("xl/worksheets/sheet1.xml")
      ?.async("string");
    expect(contacts).toContain(
      't="inlineStr"><is><t xml:space="preserve">=2+2</t>',
    );
    expect(contacts).toContain("<v>0</v>");
    expect(contacts).not.toContain("<f>");
    const coverage = await zip
      .file("xl/worksheets/sheet2.xml")
      ?.async("string");
    expect(coverage).toContain("One loaded page; incomplete audience.");
    expect(coverage).toContain("2026-10-08T12:00:00Z");
    const incoming = await zip
      .file("xl/worksheets/sheet3.xml")
      ?.async("string");
    expect(incoming).toContain("@launch received mention");
    expect(incoming).toContain("https://x.com/reader/status/789");
  });
});
