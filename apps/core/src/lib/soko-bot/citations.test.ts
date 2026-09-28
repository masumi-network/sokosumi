import { describe, expect, it } from "vitest";
import {
  citationsIn,
  dropUnverifiedLinks,
  normalizeCitation,
} from "./citations";

const evidence = new Set([
  normalizeCitation("https://www.token2049.com/singapore"),
  normalizeCitation("http://example.org/report?page=2"),
]);

describe("normalizeCitation", () => {
  it("ignores fragments, trailing slashes and sentence punctuation", () => {
    expect(
      normalizeCitation("https://WWW.Token2049.com/singapore/#dates."),
    ).toBe("www.token2049.com/singapore");
  });
});

describe("citationsIn", () => {
  it("finds URLs inside serialized tool results", () => {
    expect(
      citationsIn({ results: [{ url: "https://a.example/one" }] }),
    ).toEqual(["a.example/one"]);
  });
});

describe("dropUnverifiedLinks", () => {
  it("keeps links the turn found or loaded", () => {
    const text =
      "It is 7–8 October ([official site](https://www.token2049.com/singapore/)). See http://example.org/report?page=2.";
    expect(dropUnverifiedLinks(text, evidence)).toEqual({ text, dropped: 0 });
  });

  it("keeps Sokosumi links", () => {
    const text = "Open [the task](https://app.sokosumi.com/tasks/1).";
    expect(dropUnverifiedLinks(text, new Set()).dropped).toBe(0);
  });

  it("drops an invented link but keeps its text, and says so", () => {
    const result = dropUnverifiedLinks(
      "- High-risk rules move to 2027 ([Morgan Lewis](https://www.morganlewis.com/made-up)).",
      evidence,
    );
    expect(result.dropped).toBe(1);
    expect(result.text).toBe(
      "- High-risk rules move to 2027 (Morgan Lewis).\n\nI left out a link I could not confirm from a page I opened.",
    );
  });

  it("drops a bare invented URL and keeps the sentence's full stop", () => {
    const result = dropUnverifiedLinks(
      "Source: https://invented.example/page. Also https://www.token2049.com/singapore",
      evidence,
    );
    expect(result.dropped).toBe(1);
    expect(result.text).toBe(
      "Source: . Also https://www.token2049.com/singapore\n\nI left out a link I could not confirm from a page I opened.",
    );
  });

  it("counts several dropped links", () => {
    const result = dropUnverifiedLinks(
      "[a](https://x.example/1) and [b](https://y.example/2)",
      evidence,
    );
    expect(result.dropped).toBe(2);
    expect(result.text).toContain("I left out 2 links");
  });
});
