import assert from "node:assert/strict";

import { describe, it } from "vitest";
import {
  escapeMarkdownLinkUrl,
  findMarkdownLinks,
  replaceMarkdownLinks,
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

describe("findMarkdownLinks", () => {
  it("finds multiple links and reports their position", () => {
    const input = 'pre [a](https://x.dev/p) mid [b](https://y.dev/q "t")';
    const matches = findMarkdownLinks(input);
    assert.deepEqual(
      matches.map((m) => ({ text: m.text, rawUrl: m.rawUrl, index: m.index })),
      [
        { text: "a", rawUrl: "https://x.dev/p", index: 4 },
        { text: "b", rawUrl: "https://y.dev/q", index: 29 },
      ],
    );
  });

  it("rejects empty labels, empty urls and unterminated links", () => {
    assert.deepEqual(findMarkdownLinks("[]() [x]( ) [y](https://z [w]"), []);
  });

  it("keeps brackets inside the url (e.g. IPv6 literals)", () => {
    const matches = findMarkdownLinks(
      "[a](http://[::1]/x) and [b](http://[fe80::1]/y)",
    );
    assert.deepEqual(
      matches.map((m) => m.rawUrl),
      ["http://[::1]/x", "http://[fe80::1]/y"],
    );
  });

  it("recovers a valid link after a malformed one without backtracking", () => {
    const matches = findMarkdownLinks("[bad](https://z [c](https://w.dev/p)");
    assert.deepEqual(
      matches.map((m) => ({ text: m.text, rawUrl: m.rawUrl })),
      [{ text: "c", rawUrl: "https://w.dev/p" }],
    );
  });
});

describe("replaceMarkdownLinks", () => {
  it("replaces each link and preserves surrounding text", () => {
    const result = replaceMarkdownLinks(
      "see [a](http://x) and [b](http://y)",
      (m) => `<${m.text}>`,
    );
    assert.equal(result, "see <a> and <b>");
  });

  it("returns the input unchanged when there are no links", () => {
    assert.equal(
      replaceMarkdownLinks("no links here", () => "X"),
      "no links here",
    );
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
      `[x](${"a[".repeat(50000)}`, // unterminated url full of '[' (no close)
      `${"[a](b".repeat(50000)}`, // many unterminated link prefixes
    ];
    // Budget is intentionally loose for CI runner variance; ReDoS would be seconds+.
    const maxMs = 250;
    for (const evil of inputs) {
      const start = process.hrtime.bigint();
      extractLinks(evil);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      assert.ok(
        elapsedMs < maxMs,
        `extractLinks took ${elapsedMs}ms on pathological input`,
      );
    }
  });
});
