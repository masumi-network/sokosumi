import { describe, expect, it } from "vitest";

import { GOOGLE_CAMPAIGN_LIMITS } from "./google-campaign";
import {
  adDisplayUrl,
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchFormValues,
  googleSearchFormSchema,
  googleSearchSpecSchema,
  toGoogleSearchSpec,
} from "./google-search";

const form: GoogleSearchFormValues = {
  startDate: "",
  endDate: "",
  locations: [],
  languages: [],
  keywords: 'running shoes\n"trail shoes"',
  finalUrl: "https://example.com/shoes",
  path1: "",
  path2: "",
  headlines: ["One", "Two", "Three"],
  descriptions: ["First description", "Second description"],
  sitelinks: [],
  callouts: [],
};

const sitelink = {
  text: "Shoes",
  finalUrl: "https://example.com/shoes",
  description1: "Free returns",
  description2: "Shipped in a day",
};

const spec = {
  type: "SEARCH" as const,
  locationIds: [],
  languageIds: [],
  finalUrl: "https://example.com/shoes",
  keywords: [{ text: "running shoes", matchType: "BROAD" as const }],
  headlines: ["One", "Two", "Three"],
  descriptions: ["First description", "Second description"],
};

function firstIssue(
  result: {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  },
  path: string,
) {
  return result.error?.issues.find((issue) => issue.path.join(".") === path);
}

describe("Core's limits", () => {
  it("come from the API schema", () => {
    expect(GOOGLE_SEARCH_LIMITS).toMatchObject({
      headlines: { min: 3, max: 15, length: 30 },
      descriptions: { min: 2, max: 4, length: 90 },
      path: 15,
      sitelinks: { max: 8, text: 25, url: 2048, description: 35 },
      callouts: { max: 10, length: 25 },
    });
  });
});

describe("googleSearchFormSchema", () => {
  const schema = googleSearchFormSchema();

  it("accepts a complete form", () => {
    expect(schema.safeParse(form).success).toBe(true);
  });

  it.each([
    ["finalUrl", { finalUrl: "example.com" }],
    ["finalUrl", { finalUrl: "ftp://example.com" }],
    ["finalUrl", { finalUrl: "" }],
    ["keywords", { keywords: "  \n" }],
    ["keywords", { keywords: '"broken' }],
    ["headlines.0", { headlines: ["", "Two", "Three"] }],
    ["headlines.1", { headlines: ["One", "x".repeat(31), "Three"] }],
    ["headlines.2", { headlines: ["One", "Two", "one"] }],
    ["descriptions.0", { descriptions: ["", "Second"] }],
    ["descriptions.1", { descriptions: ["First", "x".repeat(91)] }],
    ["path1", { path1: "x".repeat(16) }],
    ["path2", { path2: "offers" }],
    ["endDate", { startDate: "2026-11-02", endDate: "2026-11-01" }],
  ])("refuses a bad %s", (path, change) => {
    const result = schema.safeParse({ ...form, ...change });
    expect(result.success).toBe(false);
    expect(firstIssue(result, path)).toBeDefined();
  });

  const targets = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${i + 1}`,
      name: `T${i}`,
    }));

  it("takes up to 25 locations and 25 languages, and refuses a 26th", () => {
    const max = GOOGLE_CAMPAIGN_LIMITS.targetIds;

    expect(max).toBe(25);
    expect(
      schema.safeParse({
        ...form,
        locations: targets(max),
        languages: targets(max),
      }).success,
    ).toBe(true);
    expect(
      firstIssue(
        schema.safeParse({ ...form, locations: targets(max + 1) }),
        "locations",
      ),
    ).toBeDefined();
    expect(
      firstIssue(
        schema.safeParse({ ...form, languages: targets(max + 1) }),
        "languages",
      ),
    ).toBeDefined();
  });

  it("refuses more keywords than Core allows", () => {
    const keywords = Array.from({ length: 51 }, (_, i) => `kw ${i}`).join("\n");
    expect(
      firstIssue(schema.safeParse({ ...form, keywords }), "keywords"),
    ).toBeDefined();
  });

  it("names the first invalid keyword line with the given message", () => {
    const result = googleSearchFormSchema({
      keywordsInvalid: (line, issue) => `${issue}@${line}`,
    }).safeParse({ ...form, keywords: "ok\n\n[bad" });

    expect(firstIssue(result, "keywords")).toMatchObject({
      message: "syntax@3",
    });
  });

  describe("sitelinks and callouts", () => {
    const check = (change: object) => schema.safeParse({ ...form, ...change });

    it("accepts none, a full sitelink, one without descriptions and blank rows", () => {
      expect(check({}).success).toBe(true);
      expect(check({ sitelinks: [sitelink] }).success).toBe(true);
      expect(
        check({
          sitelinks: [
            { ...sitelink, description1: "", description2: "" },
            { text: "", finalUrl: " ", description1: "", description2: "" },
          ],
          callouts: ["Free shipping", "", "  "],
        }).success,
      ).toBe(true);
    });

    it.each([
      ["no text", { ...sitelink, text: " " }, "sitelinks.0.text"],
      [
        "text over 25",
        { ...sitelink, text: "x".repeat(26) },
        "sitelinks.0.text",
      ],
      ["no URL", { ...sitelink, finalUrl: "" }, "sitelinks.0.finalUrl"],
      [
        "a non-http URL",
        { ...sitelink, finalUrl: "ftp://a.com" },
        "sitelinks.0.finalUrl",
      ],
      [
        "a URL over 2048",
        { ...sitelink, finalUrl: `https://a.com/${"x".repeat(2048)}` },
        "sitelinks.0.finalUrl",
      ],
      [
        "a description over 35",
        { ...sitelink, description1: "x".repeat(36) },
        "sitelinks.0.description1",
      ],
      [
        "only description 1",
        { ...sitelink, description2: "" },
        "sitelinks.0.description2",
      ],
      [
        "only description 2",
        { ...sitelink, description1: " " },
        "sitelinks.0.description1",
      ],
    ])("refuses a sitelink with %s", (_name, row, path) => {
      expect(firstIssue(check({ sitelinks: [row] }), path)).toBeDefined();
    });

    it("refuses a duplicate sitelink text, ignoring case, on the later row", () => {
      const result = check({
        sitelinks: [sitelink, { ...sitelink, text: " SHOES " }],
      });
      expect(firstIssue(result, "sitelinks.0.text")).toBeUndefined();
      expect(firstIssue(result, "sitelinks.1.text")).toBeDefined();
    });

    it("takes 8 sitelinks and refuses a ninth", () => {
      const many = (count: number) =>
        Array.from({ length: count }, (_, i) => ({
          ...sitelink,
          text: `S${i}`,
        }));
      expect(check({ sitelinks: many(8) }).success).toBe(true);
      expect(
        firstIssue(check({ sitelinks: many(9) }), "sitelinks"),
      ).toBeDefined();
    });

    it("refuses a callout over 25, a duplicate and an eleventh", () => {
      expect(
        firstIssue(check({ callouts: ["x".repeat(26)] }), "callouts.0"),
      ).toBeDefined();
      expect(
        firstIssue(check({ callouts: ["Free", "free "] }), "callouts.1"),
      ).toBeDefined();
      const many = (count: number) =>
        Array.from({ length: count }, (_, i) => `C${i}`);
      expect(check({ callouts: many(10) }).success).toBe(true);
      expect(
        firstIssue(check({ callouts: many(11) }), "callouts"),
      ).toBeDefined();
    });

    it("says it in the given words", () => {
      const result = googleSearchFormSchema({
        sitelinkDescriptionsPair: "pair",
        calloutDuplicate: "dup",
      }).safeParse({
        ...form,
        sitelinks: [{ ...sitelink, description2: "" }],
        callouts: ["a", "A"],
      });
      expect(firstIssue(result, "sitelinks.0.description2")?.message).toBe(
        "pair",
      );
      expect(firstIssue(result, "callouts.1")?.message).toBe("dup");
    });

    it("says every too-long text with the one message and its own limit", () => {
      const over = (max: number) => "x".repeat(max + 1);
      const result = googleSearchFormSchema({
        tooLong: (max) => `max ${max}`,
      }).safeParse({
        ...form,
        path1: over(15),
        sitelinks: [{ ...sitelink, text: over(25), description1: over(35) }],
        callouts: [over(25)],
      });
      const message = (path: string) => firstIssue(result, path)?.message;
      expect(message("path1")).toBe("max 15");
      expect(message("sitelinks.0.text")).toBe("max 25");
      expect(message("sitelinks.0.description1")).toBe("max 35");
      expect(message("callouts.0")).toBe("max 25");
    });
  });

  it("accepts the same dates and a path pair", () => {
    expect(
      schema.safeParse({
        ...form,
        startDate: "2026-11-01",
        endDate: "2026-11-01",
        path1: "shoes",
        path2: "sale",
      }).success,
    ).toBe(true);
  });
});

describe("googleSearchSpecSchema", () => {
  const schema = googleSearchSpecSchema();

  it("accepts a minimal Search spec", () => {
    expect(schema.safeParse(spec).success).toBe(true);
  });

  it.each([
    ["no keywords", { keywords: [] }],
    ["two headlines", { headlines: ["One", "Two"] }],
    [
      "sixteen headlines",
      { headlines: Array.from({ length: 16 }, (_, i) => `h${i}`) },
    ],
    ["a duplicate headline", { headlines: ["One", "ONE", "Three"] }],
    ["one description", { descriptions: ["Only"] }],
    ["a description over 90", { descriptions: ["x".repeat(91), "ok"] }],
    ["path2 without path1", { path2: "sale" }],
    [
      "an end before the start",
      { startDate: "2026-11-02", endDate: "2026-11-01" },
    ],
    ["a non-numeric location", { locationIds: ["Germany"] }],
    [
      "26 locations",
      { locationIds: Array.from({ length: 26 }, (_, i) => `${i + 1}`) },
    ],
    [
      "26 languages",
      { languageIds: Array.from({ length: 26 }, (_, i) => `${i + 1}`) },
    ],
    ["a non-http URL", { finalUrl: "javascript:alert(1)" }],
    ["another type", { type: "DISPLAY" }],
    ["a sitelink without text", { sitelinks: [{ ...sitelink, text: "" }] }],
    [
      "a sitelink with a non-http URL",
      { sitelinks: [{ ...sitelink, finalUrl: "javascript:alert(1)" }] },
    ],
    [
      "a sitelink with one description",
      { sitelinks: [{ ...sitelink, description2: undefined }] },
    ],
    [
      "a sitelink description over 35",
      { sitelinks: [{ ...sitelink, description1: "x".repeat(36) }] },
    ],
    [
      "duplicate sitelinks",
      { sitelinks: [sitelink, { ...sitelink, text: "shoes" }] },
    ],
    [
      "nine sitelinks",
      {
        sitelinks: Array.from({ length: 9 }, (_, i) => ({
          ...sitelink,
          text: `S${i}`,
        })),
      },
    ],
    ["a blank callout", { callouts: [""] }],
    ["a callout over 25", { callouts: ["x".repeat(26)] }],
    ["duplicate callouts", { callouts: ["Free", "FREE"] }],
    [
      "eleven callouts",
      { callouts: Array.from({ length: 11 }, (_, i) => `C${i}`) },
    ],
  ])("refuses %s", (_name, change) => {
    expect(schema.safeParse({ ...spec, ...change }).success).toBe(false);
  });

  it("accepts sitelinks with or without descriptions, and callouts", () => {
    expect(
      schema.safeParse({
        ...spec,
        sitelinks: [
          sitelink,
          { text: "Sale", finalUrl: "https://example.com/sale" },
        ],
        callouts: ["Free shipping"],
      }).success,
    ).toBe(true);
  });
});

describe("toGoogleSearchSpec", () => {
  it("builds the spec Core takes, with no targeting and no empty extras", () => {
    expect(
      toGoogleSearchSpec({
        ...form,
        finalUrl: " https://example.com/shoes ",
        headlines: [" One ", "Two", "Three"],
      }),
    ).toEqual({
      type: "SEARCH",
      locationIds: [],
      languageIds: [],
      finalUrl: "https://example.com/shoes",
      keywords: [
        { text: "running shoes", matchType: "BROAD" },
        { text: "trail shoes", matchType: "PHRASE" },
      ],
      headlines: ["One", "Two", "Three"],
      descriptions: ["First description", "Second description"],
    });
  });

  it("sends the ids of the chosen locations and languages", () => {
    expect(
      toGoogleSearchSpec({
        ...form,
        locations: [
          { id: "2276", name: "Germany" },
          { id: "1003854", name: "Munich", detail: "Munich,Bavaria,Germany" },
        ],
        languages: [{ id: "1001", name: "German" }],
      }),
    ).toMatchObject({
      locationIds: ["2276", "1003854"],
      languageIds: ["1001"],
    });
  });

  it("sends sitelinks and callouts trimmed, and leaves out blank rows", () => {
    expect(
      toGoogleSearchSpec({
        ...form,
        sitelinks: [
          {
            text: " Shoes ",
            finalUrl: " https://example.com/shoes ",
            description1: " Free returns ",
            description2: "Shipped in a day",
          },
          {
            text: "Sale",
            finalUrl: "https://example.com/sale",
            description1: "",
            description2: " ",
          },
          { text: " ", finalUrl: "", description1: "", description2: "" },
        ],
        callouts: [" Free shipping ", "", "  "],
      }),
    ).toMatchObject({
      sitelinks: [
        {
          text: "Shoes",
          finalUrl: "https://example.com/shoes",
          description1: "Free returns",
          description2: "Shipped in a day",
        },
        { text: "Sale", finalUrl: "https://example.com/sale" },
      ],
      callouts: ["Free shipping"],
    });
  });

  it("omits sitelinks and callouts when all rows are blank", () => {
    const sent = toGoogleSearchSpec({
      ...form,
      sitelinks: [
        { text: "", finalUrl: "", description1: "", description2: "" },
      ],
      callouts: [" "],
    });
    expect(sent).not.toHaveProperty("sitelinks");
    expect(sent).not.toHaveProperty("callouts");
  });

  it("keeps dates and paths when given, and drops path2 without path1", () => {
    expect(
      toGoogleSearchSpec({
        ...form,
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        path1: "shoes",
        path2: "sale",
      }),
    ).toMatchObject({
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      path1: "shoes",
      path2: "sale",
    });
    expect(toGoogleSearchSpec({ ...form, path2: "sale" })).not.toHaveProperty(
      "path2",
    );
  });
});

describe("adDisplayUrl", () => {
  it.each([
    ["https://www.example.com/shoes?x=1", "", "", "example.com"],
    [
      "https://shop.example.com",
      "shoes",
      "sale",
      "shop.example.com/shoes/sale",
    ],
    ["https://example.com", " shoes ", "", "example.com/shoes"],
    ["https://example.com", "", "sale", "example.com"],
    ["not a url", "shoes", "", "example.com/shoes"],
    ["", "", "", "example.com"],
  ])("shows %s with paths %j and %j as %s", (url, path1, path2, shown) => {
    expect(adDisplayUrl(url, path1, path2)).toBe(shown);
  });
});
