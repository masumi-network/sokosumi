import { describe, expect, it, vi } from "vitest";
import { parseMarketingPlan } from "@/services/marketing-strategy.service";

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);

const entry = (id: string, questionIds?: string[]) => ({
  id,
  date: "2026-11-05",
  channel: "linkedin",
  title: `Piece ${id}`,
  format: "post",
  status: "idea",
  ...(questionIds ? { questionIds } : {}),
});

const question = (id: string, extra: object = {}) => ({
  id,
  question: `Is ${id} true?`,
  statement: `${id} is true`,
  ...extra,
});

const plan = (calendar: object[], questions: object[]) =>
  parseMarketingPlan({
    month: "2026-11",
    summary: "Grow LinkedIn reach with founder-led posts.",
    goals: ["More demo requests"],
    pillars: ["Product stories"],
    channels: [],
    calendar,
    questions,
  });

describe("parseMarketingPlan links questions to pieces", () => {
  it("lists on each question the pieces that name it, in calendar order", () => {
    const parsed = plan(
      [
        entry("w1-thu", ["quote"]),
        entry("w2-mon"),
        entry("w3-tue", ["quote", "price"]),
      ],
      [question("quote"), question("price"), question("budget")],
    );
    expect(parsed?.questions.map((item) => item.entryIds)).toEqual([
      ["w1-thu", "w3-tue"],
      ["w3-tue"],
      undefined,
    ]);
  });

  it("ignores entryIds a save sent on a question", () => {
    const parsed = plan(
      [entry("w1-thu")],
      [question("quote", { entryIds: ["w1-thu"] })],
    );
    expect(parsed?.questions[0]?.entryIds).toBeUndefined();
  });

  it("keeps at most three pieces per question, once each", () => {
    const parsed = plan(
      ["a", "b", "c", "d"].map((id) => entry(id, ["quote", "quote"])),
      [question("quote")],
    );
    expect(parsed?.questions[0]?.entryIds).toEqual(["a", "b", "c"]);
  });

  it("drops a link to a question the plan does not ask, and keeps the entry's own ids", () => {
    const parsed = plan([entry("a", ["gone", "quote"])], [question("quote")]);
    expect(parsed?.questions[0]?.entryIds).toEqual(["a"]);
    expect(parsed?.calendar[0]?.questionIds).toEqual(["gone", "quote"]);
  });
});
