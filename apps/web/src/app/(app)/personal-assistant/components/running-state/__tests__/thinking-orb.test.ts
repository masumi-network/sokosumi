import { describe, expect, it } from "vitest";

import type { HermesStatusEvent } from "@/lib/hermes/sse";

import { orbStateForPhase } from "../thinking-orb";

const PHASES: HermesStatusEvent["phase"][] = [
  "thinking",
  "reasoning",
  "tool",
  "tool_done",
  "working",
  "answering",
];

describe("orbStateForPhase", () => {
  it("maps each streaming phase to the expected orb activity", () => {
    expect(orbStateForPhase("thinking")).toBe("solving");
    expect(orbStateForPhase("reasoning")).toBe("solving");
    expect(orbStateForPhase("tool")).toBe("searching");
    expect(orbStateForPhase("working")).toBe("working");
    expect(orbStateForPhase("answering")).toBe("composing");
  });

  it("returns null for tool_done so the previous state is kept", () => {
    expect(orbStateForPhase("tool_done")).toBeNull();
  });

  it("covers every HermesStatusEvent phase", () => {
    for (const phase of PHASES) {
      expect(() => orbStateForPhase(phase)).not.toThrow();
    }
  });
});
