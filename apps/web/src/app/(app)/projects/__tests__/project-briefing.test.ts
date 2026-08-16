import { describe, expect, it } from "vitest";

import {
  countBriefingWords,
  insertBriefingHeading,
  previewProjectBriefing,
} from "@/app/projects/project-briefing";

describe("countBriefingWords", () => {
  it("returns 0 for blank input", () => {
    expect(countBriefingWords("")).toBe(0);
    expect(countBriefingWords("   \n\t")).toBe(0);
  });

  it("counts whitespace-separated words", () => {
    expect(countBriefingWords("  Launch the  spring campaign  ")).toBe(4);
  });
});

describe("previewProjectBriefing", () => {
  it("returns an em dash when the briefing is empty", () => {
    expect(previewProjectBriefing(null)).toBe("—");
    expect(previewProjectBriefing("   ")).toBe("—");
  });

  it("strips markdown headings for the list preview", () => {
    expect(previewProjectBriefing("## Goals\nWin the quarter")).toBe(
      "Goals Win the quarter",
    );
  });
});

describe("insertBriefingHeading", () => {
  it("inserts a heading into empty text", () => {
    expect(insertBriefingHeading("", "Goals")).toBe("## Goals\n");
  });

  it("appends a heading with a blank line", () => {
    expect(insertBriefingHeading("Intro", "Audience")).toBe(
      "Intro\n\n## Audience\n",
    );
  });

  it("does not insert a heading that is already present", () => {
    const value = "## Goals\nWin the quarter\n";
    expect(insertBriefingHeading(value, "Goals")).toBe(value);
  });
});
