import { describe, expect, it } from "vitest";

import {
  answerNote,
  changesAfterPlanAnswer,
  keepAnswers,
  keepAskedQuestions,
  sameQuestion,
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

describe("keepAnswers without a note", () => {
  it("keeps the stored answer and clears an incoming note", () => {
    expect(
      keepAnswers(
        [{ id: "q1", note: "An incoming note" }],
        [{ id: "q1", answer: "yes" }],
      ),
    ).toStrictEqual([{ id: "q1", answer: "yes" }]);
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

describe("sameQuestion", () => {
  const ask = (id: string, question: string) => ({ id, question });

  it("knows one question in other words, or under the same id", () => {
    expect(
      sameQuestion(
        ask("primary-buyer", "Are independent writers your main buyers?"),
        ask("buyer", "Are independent writers the main buyer for Buttondown?"),
      ),
    ).toBe(true);
    expect(
      sameQuestion(ask("q1", "Do you post weekly?"), ask("q1", "Other words")),
    ).toBe(true);
  });

  it("keeps different questions apart", () => {
    expect(
      sameQuestion(
        ask("a", "Are independent writers your main buyers?"),
        ask("b", "Do independent writers find you through Google?"),
      ),
    ).toBe(false);
    expect(
      sameQuestion(ask("a", "Do you run ads?"), ask("b", "Do you run a blog?")),
    ).toBe(false);
  });
});

describe("keepAskedQuestions", () => {
  const ask = (id: string, question: string, answer?: "yes" | "no") => ({
    id,
    question,
    ...(answer ? { answer } : {}),
  });

  it("keeps what the owner answered when the questions are saved again under new ids", () => {
    const stored = [
      ask("a", "Do most customers find you through Google?", "yes"),
      ask("b", "Is the team trial your main offer?", "no"),
      ask("c", "Do you post on X every week?"),
    ];
    const kept = keepAskedQuestions(
      [
        ask("google", "Do most customers find you through Google search?"),
        ask("founders", "Are founders your main buyers?"),
      ],
      stored,
      6,
    );
    // Answered ones first and as asked, the repeat dropped, the open one
    // Cuso no longer asks gone.
    expect(kept.map((question) => question.id)).toEqual(["a", "b", "founders"]);
    expect(kept[0].answer).toBe("yes");
  });

  it("never holds more than the limit, answered ones first", () => {
    const stored = ["one", "two", "three"].map((id) =>
      ask(id, `Question ${id} about alpha beta`, "yes"),
    );
    const incoming = ["four", "five", "six", "seven"].map((id) =>
      ask(id, `Unrelated ${id} gamma delta epsilon`),
    );
    expect(keepAskedQuestions(incoming, stored, 6)).toHaveLength(6);
  });
});
