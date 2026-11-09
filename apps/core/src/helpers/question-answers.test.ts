import { describe, expect, it } from "vitest";

import {
  answerNote,
  changesAfterPlanAnswer,
  keepAnswers,
} from "./question-answers";

describe("keepAnswers", () => {
  it("keeps a stored answer when the save leaves it out", () => {
    expect(
      keepAnswers(
        [{ id: "q1" }, { id: "q2" }],
        [{ id: "q1", answer: "no", note: "About 80" }],
      ),
    ).toEqual([{ id: "q1", answer: "no", note: "About 80" }, { id: "q2" }]);
  });
});

describe("answerNote", () => {
  it("keeps a trimmed note only for a no", () => {
    expect(answerNote("no", "  About 80  ")).toBe("About 80");
    expect(answerNote("yes", "About 80")).toBeUndefined();
    expect(answerNote("no", "   ")).toBeUndefined();
  });
});

describe("changesAfterPlanAnswer", () => {
  const prior = ["LinkedIn twice a week"];

  it("clears revision notes when a new no lands", () => {
    expect(
      changesAfterPlanAnswer({
        changes: prior,
        previous: { answer: "yes" },
        answer: "no",
        note: "About 80",
      }),
    ).toEqual([]);
    expect(
      changesAfterPlanAnswer({
        changes: prior,
        previous: undefined,
        answer: "no",
        note: "About 80",
      }),
    ).toEqual([]);
  });

  it("clears revision notes when the no's note changes", () => {
    expect(
      changesAfterPlanAnswer({
        changes: prior,
        previous: { answer: "no", note: "About 40" },
        answer: "no",
        note: "About 80",
      }),
    ).toEqual([]);
  });

  it("keeps revision notes for the same no, a yes, or not sure", () => {
    expect(
      changesAfterPlanAnswer({
        changes: prior,
        previous: { answer: "no", note: "About 80" },
        answer: "no",
        note: "About 80",
      }),
    ).toEqual(prior);
    expect(
      changesAfterPlanAnswer({
        changes: prior,
        previous: { answer: "no", note: "About 80" },
        answer: "yes",
        note: undefined,
      }),
    ).toEqual(prior);
    expect(
      changesAfterPlanAnswer({
        changes: prior,
        previous: undefined,
        answer: "unsure",
        note: undefined,
      }),
    ).toEqual(prior);
  });
});
