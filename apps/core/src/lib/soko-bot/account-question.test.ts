import { describe, expect, it } from "vitest";
import { accountQuestionHint } from "./account-question";

describe("accountQuestionHint", () => {
  it("hands the next owner turn the question with the numbers Core showed, for the tool only", () => {
    const hint = accountQuestionHint({
      id: "q-1",
      options: [
        // Option 2 was disconnected since: 3 keeps the number the owner read.
        {
          id: "c-1",
          externalHandle: "acme_hq",
          projectId: "p1",
          project: { name: "Company marketing" },
          number: 1,
        },
        {
          id: "c-3",
          externalHandle: "@pat",
          projectId: "p2",
          project: { name: "Founder notes" },
          number: 3,
        },
      ],
    });
    expect(hint).toContain("accountQuestionId q-1");
    expect(hint).toMatch(/1\. @acme_hq .*socialConnectionId c-1.*3\. @pat /);
    expect(hint).toMatch(/Core listed the options exactly in this order/);
    expect(hint).toMatch(/never show them to the owner/);
  });
});
