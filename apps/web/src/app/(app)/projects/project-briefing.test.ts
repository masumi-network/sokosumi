import { describe, expect, it } from "vitest";

import {
  briefingCopySources,
  countBriefingWords,
  insertBriefingHeading,
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

  it("does not treat a longer heading as the same section", () => {
    expect(insertBriefingHeading("## Goals and scope\nWin.", "Goals")).toBe(
      "## Goals and scope\nWin.\n\n## Goals\n",
    );
  });
});

describe("briefingCopySources", () => {
  it("names the projects that have a briefing, in list order", () => {
    expect(
      briefingCopySources([
        { id: "b", name: "Beta", briefing: "Beta brief" },
        { id: "e", name: "Empty", briefing: "   " },
        { id: "n", name: "None", briefing: null },
        { id: "a", name: "alpha", briefing: "Alpha brief" },
      ]),
    ).toEqual([
      { id: "b", name: "Beta" },
      { id: "a", name: "alpha" },
    ]);
  });
});
