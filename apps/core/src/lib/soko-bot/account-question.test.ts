import { describe, expect, it } from "vitest";
import { accountQuestionHint } from "./account-question";

describe("accountQuestionHint", () => {
  it("hands the next owner turn the question and its options, for the tool only", () => {
    const hint = accountQuestionHint({
      id: "q-1",
      options: [
        {
          id: "c-1",
          externalHandle: "acme_hq",
          projectId: "p1",
          project: { name: "Company marketing" },
        },
        {
          id: "c-2",
          externalHandle: "@pat",
          projectId: "p2",
          project: { name: "Founder notes" },
        },
      ],
    });
    expect(hint).toContain("accountQuestionId q-1");
    expect(hint).toMatch(/@acme_hq .*socialConnectionId c-1.*@pat /);
    // Core stores what was offered, not how the reply listed it: the pick is
    // read against the reply the owner saw.
    expect(hint).not.toMatch(/\b1\.|in the order/);
    expect(hint).toMatch(/your last reply as the owner read it/);
    expect(hint).toMatch(/never show them to the owner/);
  });
});
