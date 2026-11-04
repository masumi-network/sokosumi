import { describe, expect, it } from "vitest";

import { companyUrl } from "./brand-sections";

const companies = [
  { name: "Fathom Analytics", url: "https://usefathom.com" },
  { name: "Matomo", url: "https://matomo.org" },
  { name: "Google Analytics", url: "https://analytics.google.com" },
  { name: "Plausible Clone" },
];

describe("companyUrl", () => {
  it("links a name as written", () => {
    expect(companyUrl("matomo", companies)).toBe("https://matomo.org");
  });

  it("links a shorter or longer form of the name", () => {
    expect(companyUrl("Fathom", companies)).toBe("https://usefathom.com");
    expect(companyUrl("Google Analytics 4", companies)).toBe(
      "https://analytics.google.com",
    );
  });

  it("leaves unknown names and names without a link unlinked", () => {
    expect(companyUrl("Fath", companies)).toBeUndefined();
    expect(companyUrl("Plausible Clone", companies)).toBeUndefined();
  });
});
