import { describe, expect, it } from "vitest";
import {
  citationsIn,
  dropUnverifiedLinks,
  normalizeCitation,
  urlsIn,
} from "./citations";

const evidence = new Set(
  citationsIn([
    "https://www.token2049.com/singapore",
    "http://example.org/report?page=2",
  ]),
);
const NOTE = "I left out a link I could not confirm from a page I opened.";

describe("normalizeCitation", () => {
  it("ignores scheme case, fragments and trailing slashes", () => {
    expect(
      normalizeCitation("HTTPS://WWW.Token2049.com/singapore/#dates"),
    ).toBe("www.token2049.com/singapore");
  });

  it("reads protocol-relative links and rejects what is not a web address", () => {
    expect(normalizeCitation("//evil.example/x")).toBe("evil.example/x");
    expect(normalizeCitation("/tasks/1")).toBeNull();
    expect(normalizeCitation("mailto:a@example.com")).toBeNull();
  });
});

describe("urlsIn", () => {
  it("reads each string of a value, so JSON escapes never join an address", () => {
    expect(
      urlsIn({ body: "Offer at https://x.example/offer\nThanks", n: 3 }),
    ).toEqual(["https://x.example/offer"]);
  });

  it("drops addresses too long to keep", () => {
    expect(urlsIn(`https://x.example/${"a".repeat(2_100)}`)).toEqual([]);
  });
});

describe("dropUnverifiedLinks", () => {
  it("keeps links the turn found or loaded", () => {
    const text =
      "It is 7–8 October ([official site](https://www.token2049.com/singapore/)). See http://example.org/report?page=2.";
    expect(dropUnverifiedLinks(text, evidence)).toEqual({ text, dropped: 0 });
  });

  it("keeps Sokosumi and relative links", () => {
    const text =
      "Open [the task](/tasks/1) or [the app](https://app.sokosumi.com/tasks/1).";
    expect(dropUnverifiedLinks(text, new Set()).dropped).toBe(0);
  });

  it("drops an invented link but keeps its text, and says so", () => {
    expect(
      dropUnverifiedLinks(
        "- High-risk rules move to 2027 ([Morgan Lewis](https://www.morganlewis.com/made-up)).",
        evidence,
      ).text,
    ).toBe(`- High-risk rules move to 2027 (Morgan Lewis).\n\n${NOTE}`);
  });

  it("drops a bare invented URL and keeps the sentence's full stop", () => {
    expect(
      dropUnverifiedLinks("Source: https://invented.example/page.", evidence)
        .text,
    ).toBe(`Source: .\n\n${NOTE}`);
  });

  it("catches links written in capitals or without a scheme", () => {
    const result = dropUnverifiedLinks(
      "[a](HTTPS://evil.example/1) and [b](//evil.example/2)",
      evidence,
    );
    expect(result.dropped).toBe(2);
    expect(result.text).toContain("a and b");
  });

  it("leaves code and the rest of the layout untouched", () => {
    const text = [
      "Steps:",
      "",
      "```bash",
      "curl https://api.example.com/v1   # three spaces",
      "```",
      "",
      "Run `http://localhost:3000` locally.",
      "  - nested  item",
      "See [docs](https://made-up.example/docs).",
    ].join("\n");
    const result = dropUnverifiedLinks(text, evidence);
    expect(result.dropped).toBe(1);
    expect(result.text).toContain(
      "curl https://api.example.com/v1   # three spaces",
    );
    expect(result.text).toContain("Run `http://localhost:3000` locally.");
    expect(result.text).toContain("  - nested  item");
    expect(result.text).toContain("See docs.");
  });

  it("checks autolinks and angle-bracket destinations too", () => {
    const result = dropUnverifiedLinks(
      "See <https://evil.example/a> and [b](<https://evil.example/b>).",
      evidence,
    );
    expect(result.dropped).toBe(2);
    expect(result.text).not.toContain("evil.example");
  });

  it("does not take escaped backticks for code", () => {
    const result = dropUnverifiedLinks(
      "\\`x [a](https://evil.example/c) \\`",
      evidence,
    );
    expect(result.dropped).toBe(1);
  });

  it("reads bare domains the way the web renders them", () => {
    const result = dropUnverifiedLinks(
      "Log in at evil-login.com/account today.",
      evidence,
    );
    expect(result.dropped).toBe(1);
    expect(result.text).not.toContain("evil-login.com");
    expect(result.text).toContain("Log in at  today.");
  });

  it("leaves tilde fences and an unclosed fence as code", () => {
    const text = [
      "~~~",
      "curl https://api.example.com/v1",
      "~~~",
      "```",
      "open https://still-code.example/x",
    ].join("\n");
    expect(dropUnverifiedLinks(text, evidence)).toEqual({ text, dropped: 0 });
  });
});
