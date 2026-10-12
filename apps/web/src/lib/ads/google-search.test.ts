import { describe, expect, it } from "vitest";

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
  keywords: 'running shoes\n"trail shoes"',
  finalUrl: "https://example.com/shoes",
  path1: "",
  path2: "",
  headlines: ["One", "Two", "Three"],
  descriptions: ["First description", "Second description"],
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
  result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } },
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
    ["a non-http URL", { finalUrl: "javascript:alert(1)" }],
    ["another type", { type: "DISPLAY" }],
  ])("refuses %s", (_name, change) => {
    expect(schema.safeParse({ ...spec, ...change }).success).toBe(false);
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
