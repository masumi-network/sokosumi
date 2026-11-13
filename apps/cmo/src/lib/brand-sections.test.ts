import { describe, expect, it } from "vitest";

import { sameCompany } from "./brand-sections";

describe("sameCompany", () => {
  it("matches a name as written, in any case", () => {
    expect(sameCompany("matomo", "Matomo")).toBe(true);
  });

  it("matches a shorter or longer form of the name", () => {
    expect(sameCompany("Fathom", "Fathom Analytics")).toBe(true);
    expect(sameCompany("Google Analytics 4", "Google Analytics")).toBe(true);
  });

  it("keeps other names apart", () => {
    expect(sameCompany("Fath", "Fathom")).toBe(false);
    expect(sameCompany("Plausible", "Fathom Analytics")).toBe(false);
  });
});
