import { describe, expect, it } from "vitest";

import { gscPropertyCovers } from "./native-gsc-property";

describe("gscPropertyCovers", () => {
  it("covers the domain and its subdomains on a domain property", () => {
    expect(
      gscPropertyCovers("sc-domain:example.com", [
        "https://example.com/a",
        "https://blog.Example.com/b",
      ]),
    ).toBe(true);
  });

  it("covers no text that is no URL on a domain property", () => {
    expect(
      gscPropertyCovers("sc-domain:example.com", [
        "https://example.com/a",
        "example.com/b",
      ]),
    ).toBe(false);
  });
});
