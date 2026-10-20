import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { socialPerformanceAudienceResponseSchema } from "@/schemas/social-statistics-research.schema";
import {
  socialAccountStatisticsCsv,
  socialAccountStatisticsXlsx,
} from "./social-account-statistics-export";
import { socialStatisticsAudienceExportSheets } from "./social-statistics-audience-export";

describe("loaded audience sample exports", () => {
  const connectionId = "33333333-3333-4333-8333-333333333333";
  const contact = {
    id: "123",
    name: "=2+2",
    username: "reader",
    description: "Public sample biography",
    location: "Self-reported location",
    avatarUrl: "https://example.com/avatar.png",
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
        author: {
          ...contact,
          description: "Incoming author biography",
          location: "Incoming author location",
        },
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
  it("leaves bios and locations out of CSV and every XLSX sheet by default", async () => {
    const sheets = socialStatisticsAudienceExportSheets({
      connectionId,
      accountName: "Launch",
      pages: [page],
    });
    const csv = socialAccountStatisticsCsv(sheets[0].rows);
    const zip = await JSZip.loadAsync(
      await socialAccountStatisticsXlsx(sheets),
    );
    const xml = await Promise.all(
      Object.values(zip.files)
        .filter((file) => file.name.endsWith(".xml"))
        .map((file) => file.async("string")),
    );
    for (const output of [csv, ...xml]) {
      expect(output).not.toContain(contact.description);
      expect(output).not.toContain(contact.location);
      expect(output).not.toContain(contact.avatarUrl);
      expect(output).not.toContain("Incoming author biography");
      expect(output).not.toContain("Incoming author location");
    }
    expect(sheets[0].rows[0]).not.toContain("description");
    expect(sheets[0].rows[0]).not.toContain("location");
    expect(sheets[0].rows[0]).not.toContain("contact_id");
    expect(sheets[0].rows[0]).not.toContain("avatar_url");
  });
  it("includes contact bios and locations only with opt-in, while post rows still omit author details", async () => {
    const sheets = socialStatisticsAudienceExportSheets({
      connectionId,
      accountName: "Launch",
      pages: [page],
      includeProfileDetails: true,
    });
    const headers = sheets[0].rows[0];
    expect(sheets[0].rows[1][headers.indexOf("description")]).toBe(
      contact.description,
    );
    expect(sheets[0].rows[1][headers.indexOf("location")]).toBe(
      contact.location,
    );
    const csv = socialAccountStatisticsCsv(sheets[0].rows);
    const zip = await JSZip.loadAsync(
      await socialAccountStatisticsXlsx(sheets),
    );
    const contacts = await zip
      .file("xl/worksheets/sheet1.xml")
      ?.async("string");
    for (const output of [csv, contacts]) {
      expect(output).toContain(contact.description);
      expect(output).toContain(contact.location);
      expect(output).not.toContain(contact.avatarUrl);
    }
    const incoming = await zip
      .file("xl/worksheets/sheet3.xml")
      ?.async("string");
    expect(incoming).not.toContain("Incoming author biography");
    expect(incoming).not.toContain("Incoming author location");
    expect(sheets[2].rows[0]).not.toContain("description");
    expect(sheets[2].rows[0]).not.toContain("location");
    const definitions = await zip
      .file("xl/worksheets/sheet4.xml")
      ?.async("string");
    expect(definitions).toContain("Bios and locations are left out by default");
    expect(definitions).toContain(
      "Included in Contacts by explicit includeProfileDetails opt-in",
    );
  });
  it("retains raw per-page contacts, repeated evidence and page coverage with measured zero distinct from null", () => {
    const sheets = socialStatisticsAudienceExportSheets({
      connectionId,
      accountName: "Launch",
      pages: [page, page],
    });
    const headers = sheets[0].rows[0];
    const first = sheets[0].rows[1];
    expect(sheets[0].rows).toHaveLength(3);
    expect(first[headers.indexOf("followers_count")]).toBe(0);
    expect(first[headers.indexOf("likes")]).toBeNull();
    expect(first[headers.indexOf("next_cursor")]).toBe("next_page");
    expect(first[headers.indexOf("kind")]).toBe("mentions");
    expect(first[headers.indexOf("platform")]).toBe("x");
    expect(first[headers.indexOf("account")]).toBe("Launch");
    expect(first[headers.indexOf("timezone")]).toBe("UTC");
    expect(first[headers.indexOf("profile_details")]).toContain(
      "Bios and locations are left out by default",
    );
    expect(sheets[0].rows[2][headers.indexOf("page_index")]).toBe(2);
    expect(socialAccountStatisticsCsv(sheets[0].rows)).toContain("'=2+2");
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
    const sheets = socialStatisticsAudienceExportSheets({
      connectionId,
      accountName: "Launch",
      pages: [empty],
    });
    expect(sheets[0].rows[1][0]).toBe("page_coverage");
    expect(sheets[0].rows[1][sheets[0].rows[0].indexOf("username")]).toBeNull();
    expect(
      sheets[1].rows[1][sheets[1].rows[0].indexOf("page_contact_count")],
    ).toBe(0);
    expect(sheets[2].rows).toHaveLength(1);
  });
  it("includes Contacts, Coverage, Incoming posts and Definitions sheets with inert user text and genuine numeric counters", async () => {
    const sheets = socialStatisticsAudienceExportSheets({
      connectionId,
      accountName: "Launch",
      pages: [page],
    });
    const bytes = await socialAccountStatisticsXlsx(sheets);
    const zip = await JSZip.loadAsync(bytes);
    const workbook = await zip.file("xl/workbook.xml")?.async("string");
    expect(workbook).toContain('name="Contacts"');
    expect(workbook).toContain('name="Coverage"');
    expect(workbook).toContain('name="Incoming posts"');
    expect(workbook).toContain('name="Definitions"');
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
    expect(sheets[3].rows).toEqual(
      expect.arrayContaining([
        ["platform", "x"],
        ["account", "Launch"],
        ["period", expect.stringContaining("sampled posts")],
        ["timezone", expect.stringContaining("UTC")],
        ["freshness", expect.stringContaining("observed_at")],
        ["coverage", expect.stringContaining("Loaded client samples only")],
        ["counts", expect.stringContaining("Null or blank means unavailable")],
        [
          "profile_details",
          expect.stringContaining("Bios and locations are left out by default"),
        ],
      ]),
    );
  });
});
