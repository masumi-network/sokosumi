import { describe, expect, it } from "vitest";
import { buildNoticeTemplate, parseNoticeTemplate } from "./notice-template.js";

describe("buildNoticeTemplate", () => {
  it("writes what parseNoticeTemplate reads back, one line per value", () => {
    const header = {
      title: "New this week",
      summary: "Three changes,\nin one line",
      cover: "https://blob.example/week.mp4",
      actionLabel: "Open Contacts",
      actionUrl: "/contacts",
    };
    const parsed = parseNoticeTemplate(
      buildNoticeTemplate(header, "- One\n- Two\n"),
    );
    expect(parsed.header).toEqual({
      ...header,
      summary: "Three changes, in one line",
    });
    expect(parsed.bodyMarkdown).toBe("- One\n- Two\n");
  });
});

describe("parseNoticeTemplate", () => {
  it("returns entire markdown as body when header is absent", () => {
    const content = "# Title\n\nBody text";
    const parsed = parseNoticeTemplate(content);

    expect(parsed.header).toEqual({});
    expect(parsed.bodyMarkdown).toBe(content);
  });

  it("parses supported header keys with ---- delimiter", () => {
    const parsed = parseNoticeTemplate(`----
title: New Terms
cover: https://example.com/cover.png
summary: Please review
action_label: Review now
action_url: https://example.com/legal
----

# Body
Please accept.`);

    expect(parsed.header).toEqual({
      actionLabel: "Review now",
      actionUrl: "https://example.com/legal",
      cover: "https://example.com/cover.png",
      summary: "Please review",
      title: "New Terms",
    });
    expect(parsed.bodyMarkdown).toBe("# Body\nPlease accept.");
  });

  it("supports --- as a fallback delimiter", () => {
    const parsed = parseNoticeTemplate(`---
title: Maintenance
---
Body`);

    expect(parsed.header).toEqual({
      title: "Maintenance",
    });
    expect(parsed.bodyMarkdown).toBe("Body");
  });

  it("ignores unknown keys and blank values", () => {
    const parsed = parseNoticeTemplate(`----
title:
unknown: value
summary: Important update
----
Notice body`);

    expect(parsed.header).toEqual({
      summary: "Important update",
    });
    expect(parsed.bodyMarkdown).toBe("Notice body");
  });

  it("treats malformed frontmatter as plain markdown", () => {
    const content = `----
title: no closing delimiter
# Heading`;
    const parsed = parseNoticeTemplate(content);

    expect(parsed.header).toEqual({});
    expect(parsed.bodyMarkdown).toBe(content);
  });
});
