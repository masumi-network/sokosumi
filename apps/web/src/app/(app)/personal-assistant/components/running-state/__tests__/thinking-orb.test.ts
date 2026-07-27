import { describe, expect, it } from "vitest";

import { orbStateForPhase } from "../thinking-orb";

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
});
