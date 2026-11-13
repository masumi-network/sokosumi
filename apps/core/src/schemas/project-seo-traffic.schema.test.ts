import { describe, expect, it } from "vitest";
import { saveSeoBrandTermsSchema } from "./project-seo-traffic.schema";

describe("brand term save", () => {
  it("refuses a term with no letter or digit", () => {
    expect(saveSeoBrandTermsSchema.safeParse({ terms: ["++"] }).success).toBe(
      false,
    );
    expect(
      saveSeoBrandTermsSchema.safeParse({ terms: ["C++", "ソニー", "3M"] })
        .success,
    ).toBe(true);
  });
});
