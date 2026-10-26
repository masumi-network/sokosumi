import { describe, expect, it } from "vitest";

import { parseSokoBotBrief } from "./brief";

describe("parseSokoBotBrief", () => {
  it("reads headline, sections, numbers, and the receipts above them", () => {
    const brief = parseSokoBotBrief(
      [
        "Updated memory.",
        "",
        "Get Catalyst submission-ready by Nov 1.",
        "",
        "### This week",
        "- Wednesday is packed (10 meetings)",
        "- Catalyst milestone due Sat Nov 1",
        "",
        "### Focus:",
        "- Catalyst readiness, Thursday afternoon",
        "",
        "Numbers: 11 Tasks created · 9 completed · 3,816 credits.",
      ].join("\n"),
    );
    expect(brief).toEqual({
      headline: "Get Catalyst submission-ready by Nov 1.",
      sections: [
        {
          title: "This week",
          body: "- Wednesday is packed (10 meetings)\n- Catalyst milestone due Sat Nov 1",
        },
        { title: "Focus", body: "- Catalyst readiness, Thursday afternoon" },
      ],
      numbers: ["11 Tasks created", "9 completed", "3,816 credits"],
      notes: "Updated memory.",
    });
  });

  it("leaves a message without the brief shape alone", () => {
    expect(parseSokoBotBrief("Calendar: busy.\nMail: quiet.")).toBeNull();
    expect(parseSokoBotBrief("### Only a heading\n- item")).toBeNull();
    expect(
      parseSokoBotBrief("Two lines\nof headline\n\n### Focus\n- a"),
    ).toBeNull();
    expect(parseSokoBotBrief("Headline\n\n### Empty\n")).toBeNull();
  });
});
