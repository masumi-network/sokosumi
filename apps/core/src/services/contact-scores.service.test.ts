import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const { importanceFromAnswers } = await import("./contact-scores.service");

describe("importanceFromAnswers", () => {
  it("weighs decision power, value, live business and closeness", () => {
    expect(
      importanceFromAnswers(
        new Map([
          ["decides", 1],
          ["value", 1],
          ["active", 1],
          ["close", 1],
          ["noise", 0],
        ]),
      ),
    ).toEqual({
      importance: 100,
      reason: "decides,value,active,close",
    });
  });

  it("lets noise take most of it away, and names it", () => {
    expect(
      importanceFromAnswers(
        new Map([
          ["value", 1],
          ["noise", 1],
        ]),
      ),
    ).toEqual({ importance: 7, reason: "noise" });
  });

  it("treats a question Jev did not answer as no", () => {
    expect(importanceFromAnswers(new Map())).toEqual({
      importance: 0,
      reason: null,
    });
  });
});
