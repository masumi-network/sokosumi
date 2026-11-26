import { describe, expect, it } from "vitest";
import { accountQuestionHint } from "./account-question";

describe("accountQuestionHint", () => {
  it("hands the next owner turn the question and its options in order, for the tool only", () => {
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
    expect(hint).toMatch(/1\. @acme_hq .*socialConnectionId c-1.*2\. @pat /);
    expect(hint).toMatch(/never show them to the owner/);
  });
});
