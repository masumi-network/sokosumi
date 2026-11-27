import { describe, expect, it } from "vitest";
import { seoAuditTextUnchanged } from "./seo-task-execution";

const link = "[BRIEFING.md](https://blob.example/projects/p1/BRIEFING.md)";
const stored = `${link}\n\nFull SEO audit of 2 selected pages:\n\nseo_audit: {"version":1}`;

describe("seoAuditTextUnchanged", () => {
  it("reads the text people saw, with or without its Context links, as unchanged", () => {
    expect(
      seoAuditTextUnchanged(
        stored,
        `${link}\r\n\r\nFull SEO audit of 2 selected pages:`,
      ),
    ).toBe(true);
    expect(
      seoAuditTextUnchanged(stored, "Full SEO audit of 2 selected pages:"),
    ).toBe(true);
  });

  it("reads an added Context link as a change", () => {
    const plain =
      'Full SEO audit of 2 selected pages:\n\nseo_audit: {"version":1}';
    expect(
      seoAuditTextUnchanged(
        plain,
        `${link}\n\nFull SEO audit of 2 selected pages:`,
      ),
    ).toBe(false);
  });
});
