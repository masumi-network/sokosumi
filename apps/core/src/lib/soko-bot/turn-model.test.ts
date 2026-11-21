import { describe, expect, it } from "vitest";
import {
  chooseTurnModel,
  type TurnModelInput,
  turnRunModel,
} from "./turn-model";

const NOW = new Date("2026-11-21T10:00:00Z");
const routed = { model: "openai/gpt-6-luna", strongModel: "openai/strong" };

function input(overrides: Partial<TurnModelInput> = {}): TurnModelInput {
  return {
    version: routed,
    clientTurnId: "chat:1",
    preset: false,
    background: false,
    classification: {
      route: "DIRECT_RESPONSE",
      complexity: { label: "NORMAL", probabilities: { NORMAL: 0.7 } },
    },
    previous: null,
    now: NOW,
    ...overrides,
  };
}

function complexity(label: "SIMPLE" | "NORMAL" | "COMPLEX", complex: number) {
  return { label, probabilities: { COMPLEX: complex } };
}

describe("chooseTurnModel", () => {
  it("keeps a version without a stronger model on its own", () => {
    expect(
      chooseTurnModel(
        input({
          version: { model: "openai/gpt-6-luna" },
          classification: { route: "HIRE_AGENT" },
        }),
      ),
    ).toEqual({ model: "openai/gpt-6-luna", reason: "default" });
  });

  it.each([
    "cmo:strategy:bot:1795224917566",
    "cmo:strategy:bot:fix:1:1795224917566",
    "cmo:strategy:bot:patch:1795224917566",
    "cmo:strategy:bot:finish:1795224917566:2",
  ])(
    "puts every strategy turn (%s) up, though Core wrote it",
    (clientTurnId) => {
      expect(chooseTurnModel(input({ clientTurnId, preset: true }))).toEqual({
        model: "openai/strong",
        reason: "strategy",
      });
    },
  );

  it("puts a start_background_run run up but not CMO production", () => {
    expect(
      chooseTurnModel(
        input({
          clientTurnId: "background:turn-1:abc",
          preset: true,
          background: true,
        }),
      ).reason,
    ).toBe("background_run");
    expect(
      chooseTurnModel(
        input({
          clientTurnId: "cmo:production:bot:1:0",
          preset: true,
          background: true,
        }),
      ).reason,
    ).toBe("default");
  });

  it("leaves routines on the version's model", () => {
    expect(
      chooseTurnModel(
        input({
          clientTurnId: "schedule:dreaming:1",
          preset: true,
          classification: { route: "MANAGE_WORK" },
        }),
      ).reason,
    ).toBe("default");
  });

  it("puts hiring and mixed requests up", () => {
    for (const route of ["HIRE_AGENT", "MIXED"] as const)
      expect(chooseTurnModel(input({ classification: { route } })).reason).toBe(
        "orchestration",
      );
  });

  it("puts a chat turn up from Jev's complex share of one half", () => {
    expect(
      chooseTurnModel(
        input({
          classification: {
            route: "DELEGATE_TASK",
            complexity: complexity("COMPLEX", 0.5),
          },
        }),
      ),
    ).toEqual({ model: "openai/strong", reason: "complex" });
    expect(
      chooseTurnModel(
        input({
          classification: {
            route: "DELEGATE_TASK",
            complexity: complexity("NORMAL", 0.49),
          },
        }),
      ).reason,
    ).toBe("default");
  });

  it("stays up in a complex conversation until a simple message", () => {
    const previous = {
      modelReason: "complex",
      createdAt: new Date(NOW.getTime() - 10 * 60_000),
    };
    const followUp = (refersToEarlier: number) =>
      chooseTurnModel(
        input({
          previous,
          classification: {
            route: "DIRECT_RESPONSE",
            complexity: complexity("NORMAL", 0.1),
            signals: {
              refersToEarlier,
              statesPreference: 0,
              aboutMail: 0,
              aboutTasks: 0,
            },
          },
        }),
      ).reason;
    expect(followUp(0.8)).toBe("complex_thread");
    // A new subject minutes later is not the same conversation.
    expect(followUp(0.4)).toBe("default");
    expect(
      chooseTurnModel(
        input({
          previous,
          classification: {
            route: "DIRECT_RESPONSE",
            complexity: complexity("SIMPLE", 0.1),
          },
        }),
      ).reason,
    ).toBe("default");
  });

  it("does not carry a stale or default thread", () => {
    const normal = {
      route: "DIRECT_RESPONSE" as const,
      complexity: complexity("NORMAL", 0.1),
    };
    expect(
      chooseTurnModel(
        input({
          classification: normal,
          previous: {
            modelReason: "complex",
            createdAt: new Date(NOW.getTime() - 31 * 60_000),
          },
        }),
      ).reason,
    ).toBe("default");
    expect(
      chooseTurnModel(
        input({
          classification: normal,
          previous: { modelReason: "default", createdAt: NOW },
        }),
      ).reason,
    ).toBe("default");
  });

  it("stays on the version's model when Jev gave no complexity", () => {
    expect(
      chooseTurnModel(
        input({
          classification: { route: "CLARIFY" },
          previous: { modelReason: "complex", createdAt: NOW },
        }),
      ).reason,
    ).toBe("default");
  });
});

describe("turnRunModel", () => {
  it("runs the stored model only when it is the version's stronger one", () => {
    expect(turnRunModel(routed, "openai/strong")).toBe("openai/strong");
    expect(turnRunModel(routed, "openai/other")).toBe("openai/gpt-6-luna");
    expect(turnRunModel(routed, null)).toBe("openai/gpt-6-luna");
    expect(turnRunModel({ model: "openai/gpt-6-luna" }, "openai/strong")).toBe(
      "openai/gpt-6-luna",
    );
  });
});
