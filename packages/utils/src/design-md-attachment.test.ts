import { describe, expect, it } from "vitest";

import { DESIGN_MD_ATTACHMENT_LABEL } from "./design-md-attachment.js";

describe("DESIGN_MD_ATTACHMENT_LABEL", () => {
  it("exposes the DESIGN.md label", () => {
    expect(DESIGN_MD_ATTACHMENT_LABEL).toBe("DESIGN.md");
  });
});
