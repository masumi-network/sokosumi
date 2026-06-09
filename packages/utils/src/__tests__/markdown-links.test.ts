import assert from "node:assert/strict";

import { describe, it } from "vitest";
import {
  escapeMarkdownLinkUrl,
  unescapeMarkdownLinkUrl,
} from "../markdown-links.js";
import { extractLinks } from "../markdown-links-extract.js";

describe("escapeMarkdownLinkUrl / unescapeMarkdownLinkUrl", () => {
  it("round-trips urls containing parens and backslashes", () => {
    const urls = [
      "https://example.com/p",
      "https://example.com/a)b",
      "https://example.com/a\\b",
      "https://example.com/a\\)b",
      "https://example.com/(a)(b)",
    ];
    for (const url of urls) {
      assert.equal(
        unescapeMarkdownLinkUrl(escapeMarkdownLinkUrl(url)),
        url,
        `failed round-trip for ${url}`,
      );
    }
  });

  it("escapes backslashes before parens", () => {
    assert.equal(escapeMarkdownLinkUrl("a\\)"), "a\\\\\\)");
  });
});

describe("extractLinks", () => {
  it("extracts a link and unescapes its url", () => {
    const markdown = `see [docs](${escapeMarkdownLinkUrl(
      "https://example.com/a)b",
    )})`;
    const links = extractLinks(markdown);
    assert.deepEqual(links, [{ url: "https://example.com/a)b", text: "docs" }]);
  });

  it("ignores an optional title and stops the url at a bare paren", () => {
    const links = extractLinks('[t](https://example.com/p "title")');
    assert.deepEqual(links, [{ url: "https://example.com/p", text: "t" }]);
  });

  it("does not backtrack pathologically on malformed input", () => {
    const inputs = [
      `[t](${"\\".repeat(50000)}`, // unterminated escaped url
      `[${"[\\".repeat(50000)}`, // many nested '[' in link text
      `[\\](${"[!](!".repeat(40000)}`, // many nested link-like sequences
    ];
    for (const evil of inputs) {
      const start = process.hrtime.bigint();
      extractLinks(evil);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      assert.ok(
        elapsedMs < 100,
        `extractLinks took ${elapsedMs}ms on pathological input`,
      );
    }
  });
});
