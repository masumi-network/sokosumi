import { describe, expect, it } from "vitest";

import { linkifyBareDomainsInMarkdown } from "../linkify-bare-domains.js";

describe("linkifyBareDomainsInMarkdown", () => {
  it("turns a bare host into a markdown link with https", () => {
    expect(linkifyBareDomainsInMarkdown("see google.com please")).toBe(
      "see [google.com](https://google.com) please",
    );
  });

  it("linkifies hyphenated hosts and country TLDs", () => {
    expect(
      linkifyBareDomainsInMarkdown("visit naturstein-koester.de today"),
    ).toBe(
      "visit [naturstein-koester.de](https://naturstein-koester.de) today",
    );
  });

  it("includes path, query, and fragment", () => {
    expect(
      linkifyBareDomainsInMarkdown("open google.com/maps?q=berlin#top"),
    ).toBe(
      "open [google.com/maps?q=berlin#top](https://google.com/maps?q=berlin#top)",
    );
  });

  it("strips trailing prose punctuation from the match", () => {
    expect(linkifyBareDomainsInMarkdown("go to google.com.")).toBe(
      "go to [google.com](https://google.com).",
    );
    expect(linkifyBareDomainsInMarkdown("see (google.com)")).toBe(
      "see ([google.com](https://google.com))",
    );
  });

  it("does not rewrite existing markdown links", () => {
    const input = "already [docs](https://example.com/path) here";
    expect(linkifyBareDomainsInMarkdown(input)).toBe(input);
  });

  it("does not rewrite titled markdown links or bare domains in their labels", () => {
    const titled = 'see [google.com](https://example.com "Docs") end';
    expect(linkifyBareDomainsInMarkdown(titled)).toBe(titled);
  });

  it("does not linkify unknown multi-letter TLDs", () => {
    expect(linkifyBareDomainsInMarkdown("see foo.bar please")).toBe(
      "see foo.bar please",
    );
  });

  it("does not linkify pathless file names with query or fragment", () => {
    expect(
      linkifyBareDomainsInMarkdown("see report.pdf?x=1 and photo.png#a"),
    ).toBe("see report.pdf?x=1 and photo.png#a");
  });

  it("linkifies punycode ASCII hosts on allowlisted TLDs", () => {
    expect(linkifyBareDomainsInMarkdown("see xn--fsq.com please")).toBe(
      "see [xn--fsq.com](https://xn--fsq.com) please",
    );
  });

  it("does not rewrite scheme URLs (left for GFM)", () => {
    const input = "see https://google.com and http://example.com/a";
    expect(linkifyBareDomainsInMarkdown(input)).toBe(input);
  });

  it("does not rewrite www hosts (left for GFM)", () => {
    const input = "see www.google.com please";
    expect(linkifyBareDomainsInMarkdown(input)).toBe(input);
  });

  it("does not linkify email addresses", () => {
    const input = "mail user@google.com please";
    expect(linkifyBareDomainsInMarkdown(input)).toBe(input);
  });

  it("does not linkify inside inline code", () => {
    const input = "use `google.com` in code";
    expect(linkifyBareDomainsInMarkdown(input)).toBe(input);
  });

  it("does not linkify inside fenced code blocks", () => {
    const input = ["```", "google.com", "```"].join("\n");
    expect(linkifyBareDomainsInMarkdown(input)).toBe(input);
  });

  it("does not linkify IPv4 or localhost", () => {
    expect(linkifyBareDomainsInMarkdown("go 192.168.1.1")).toBe(
      "go 192.168.1.1",
    );
    expect(linkifyBareDomainsInMarkdown("go localhost:3000")).toBe(
      "go localhost:3000",
    );
  });

  it("does not linkify version-like or single-letter TLD tokens", () => {
    expect(linkifyBareDomainsInMarkdown("v1.2.3 and i.e. done")).toBe(
      "v1.2.3 and i.e. done",
    );
  });

  it("does not linkify common file-like names", () => {
    expect(linkifyBareDomainsInMarkdown("see report.pdf and photo.png")).toBe(
      "see report.pdf and photo.png",
    );
  });

  it("leaves non-matching text unchanged", () => {
    expect(linkifyBareDomainsInMarkdown("hello world")).toBe("hello world");
  });
});
