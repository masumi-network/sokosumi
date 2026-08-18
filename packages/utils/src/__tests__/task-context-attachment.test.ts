import { describe, expect, it } from "vitest";

import {
  PROJECT_BRIEFING_ATTACHMENT_LABEL,
  PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
  removeTaskContextAttachmentLinks,
} from "../task-context-attachment.js";

describe("removeTaskContextAttachmentLinks", () => {
  it("exposes the project file labels", () => {
    expect(PROJECT_BRIEFING_ATTACHMENT_LABEL).toBe("BRIEFING.md");
    expect(PROJECT_CONTEXT_MD_ATTACHMENT_LABEL).toBe("CONTEXT.md");
  });

  it("removes DESIGN.md, BRIEFING.md and CONTEXT.md links", () => {
    const markdown = [
      "[DESIGN.md](https://blob.example/design.md)",
      "",
      "[BRIEFING.md](https://blob.example/projects/p1/BRIEFING.md)",
      "",
      "[CONTEXT.md](https://blob.example/projects/p1/CONTEXT.md)",
      "",
      "Draft the LinkedIn launch post",
    ].join("\n");

    expect(removeTaskContextAttachmentLinks(markdown)).toBe(
      "Draft the LinkedIn launch post",
    );
  });

  it("leaves other links untouched", () => {
    const markdown = "[notes.pdf](https://blob.example/notes.pdf)\n\nBody";
    expect(removeTaskContextAttachmentLinks(markdown)).toBe(markdown);
  });
});
