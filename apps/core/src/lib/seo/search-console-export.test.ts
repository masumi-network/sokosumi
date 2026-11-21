import { describe, expect, it } from "vitest";
import { parseConsoleExport } from "./search-console-export";

const property = "sc-domain:example.test";
const header = "Target page,Incoming links,Linking sites\n";
describe("Search Console export intake", () => {
  it("deduplicates identical rows and reads quoted count separators", () => {
    const row = 'https://example.test/a,"1,234",4';
    expect(
      parseConsoleExport(header + row + "\n" + row, "linked_pages", property),
    ).toEqual([
      {
        key: "https://example.test/a",
        counts: { incomingLinks: 1234, linkingSites: 4 },
      },
    ]);
  });
  it("rejects conflicting counts for one page and rows outside the approved property", () => {
    expect(() =>
      parseConsoleExport(
        header + "https://example.test/a,1,1\nhttps://example.test/a,2,1",
        "linked_pages",
        property,
      ),
    ).toThrow(/conflicting/);
    expect(() =>
      parseConsoleExport(
        header + "https://example.test.attacker.test/a,2,1",
        "linked_pages",
        property,
      ),
    ).toThrow(/outside/);
  });
  it("keeps an empty example report distinct from a totals file", () => {
    expect(
      parseConsoleExport("URL,Last crawled\n", "indexing_examples", property),
    ).toEqual([]);
    expect(() =>
      parseConsoleExport(
        "Date,Not indexed,Indexed\n2026-01-01,1,2",
        "indexing_examples",
        property,
      ),
    ).toThrow(/headers/);
  });
  it("enforces the original URL prefix and rejects unsafe counts", () => {
    expect(() =>
      parseConsoleExport(
        header + "https://example.test/b,2,1",
        "linked_pages",
        "https://example.test/a/",
      ),
    ).toThrow(/outside/);
    expect(() =>
      parseConsoleExport(
        header + "https://example.test/a,9007199254740993,1",
        "linked_pages",
        property,
      ),
    ).toThrow(/count/);
  });
});

it("keeps source domains separate from target URLs and counts pages as pages", () => {
  expect(
    parseConsoleExport(
      "Linking site,Linking pages,Target pages\nEXTERNAL.test,7,2",
      "linking_sites",
      property,
    ),
  ).toEqual([
    { key: "external.test", counts: { linkingPages: 7, targetPages: 2 } },
  ]);
  expect(() =>
    parseConsoleExport(
      "Linking site,Linking pages,Target pages\nhttps://external.test/path,7,2",
      "linking_sites",
      property,
    ),
  ).toThrow(/domain/);
});

it("preserves blank anchor text without treating a final line ending as an extra anchor", () => {
  expect(
    parseConsoleExport(
      "Link text\r\nHome\r\n\r\nHome\r\n",
      "anchor_text",
      property,
    ),
  ).toEqual([
    { key: "", counts: {} },
    { key: "Home", counts: {} },
  ]);
  expect(
    parseConsoleExport('Link text,Links\n"",3\n', "anchor_text", property),
  ).toEqual([{ key: "", counts: { anchorLinks: 3 } }]);
});

it("interprets the internal report's count as internal links", () => {
  expect(
    parseConsoleExport(
      "Target page,Incoming links\nhttps://example.test/,7",
      "internal_pages",
      property,
    ),
  ).toEqual([{ key: "https://example.test/", counts: { internalLinks: 7 } }]);
  expect(() =>
    parseConsoleExport(
      header + "https://example.test/,7,2",
      "internal_pages",
      property,
    ),
  ).toThrow(/headers/);
});
