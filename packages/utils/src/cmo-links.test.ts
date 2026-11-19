import { describe, expect, it } from "vitest";
import { withoutSokosumiLinks } from "./cmo-links.js";

const web = "https://app.sokosumi.com";

describe("withoutSokosumiLinks", () => {
  it("reads a link Cuso wrote with spaces around its address", () => {
    expect(
      withoutSokosumiLinks(
        "[Open the content tracker]( /drive/tables/01a1f158 ) has three rows.",
        "https://app.sokosumi.com",
      ),
    ).toBe("Open the content tracker has three rows.");
  });

  it("drops a receipt's bracketed link into Sokosumi", () => {
    expect(
      withoutSokosumiLinks(
        "Started image ([Open in Content Studio](/studio?projectId=p1)).",
        web,
      ),
    ).toBe("Started image.");
  });

  it("keeps the name of what a Sokosumi link pointed at", () => {
    expect(
      withoutSokosumiLinks("Created task [Launch](/tasks/t1) → Bob.", web),
    ).toBe("Created task Launch → Bob.");
    expect(
      withoutSokosumiLinks(
        `See [the post](${web}/social?projectId=p1&postId=s1) (draft).`,
        web,
      ),
    ).toBe("See the post (draft).");
  });

  it("drops a bare address in Sokosumi", () => {
    expect(
      withoutSokosumiLinks(`It is ready: ${web}/studio?projectId=p1.`, web),
    ).toBe("It is ready:.");
  });

  it("drops a Sokosumi route Cuso put a Sokosumi address in front of", () => {
    expect(
      withoutSokosumiLinks(
        "Die Grafik liegt bereit: [Fee Clarity](https://sokosumi.com/drive/files/f1). Siehe https://www.sokosumi.com/social?projectId=p1",
        "http://localhost:3210",
      ),
    ).toBe("Die Grafik liegt bereit: Fee Clarity. Siehe");
  });

  it("keeps links that leave for somewhere else", () => {
    const text =
      "Live at [x.com](https://x.com/acme/status/1), read https://sokosumi.com/blog and [file.png](https://blob.example/file.png).";
    expect(withoutSokosumiLinks(text, web)).toBe(text);
  });

  it("leaves text that is not a link alone", () => {
    const text = "Use [brackets] and (parentheses) freely.";
    expect(withoutSokosumiLinks(text, web)).toBe(text);
  });

  it.each([
    ["spaces", `${"\t".repeat(50_000)}x`],
    ["open brackets", `[${"[[".repeat(25_000)}`],
    ["empty links", `[[](${"[!](!".repeat(12_500)}`],
    ["addresses", "https://a.".repeat(5_000)],
  ])("reads a long run of %s in linear time", (_, text) => {
    const started = performance.now();
    withoutSokosumiLinks(text, web);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
