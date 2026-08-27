import { describe, expect, it } from "vitest";

import {
  DESIGN_MD_ATTACHMENT_LABEL,
  removeDesignMdAttachmentLinks,
} from "./design-md-attachment.js";

describe("removeDesignMdAttachmentLinks", () => {
  it("exposes the DESIGN.md label", () => {
    expect(DESIGN_MD_ATTACHMENT_LABEL).toBe("DESIGN.md");
  });

  it("removes DESIGN.md attachment links from task descriptions", () => {
    const markdown = [
      "[DESIGN.md](https://blob.example/design.md)",
      "",
      "Build landing page",
    ].join("\n");

    expect(removeDesignMdAttachmentLinks(markdown)).toBe("Build landing page");
  });

  it("removes DESIGN.md links when the url contains parens", () => {
    const markdown = [
      "[DESIGN.md](https://blob.example/design%29.md)",
      "",
      "Build landing page",
    ].join("\n");

    expect(removeDesignMdAttachmentLinks(markdown)).toBe("Build landing page");
  });

  it("leaves non-DESIGN.md links untouched", () => {
    const markdown = "[notes.pdf](https://blob.example/notes.pdf)\n\nBody";
    expect(removeDesignMdAttachmentLinks(markdown)).toBe(markdown);
  });
});
