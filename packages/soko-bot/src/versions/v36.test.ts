import { describe, expect, it } from "vitest";
import { DEFAULT_SOKO_BOT_VERSION_ID, getSokoBotVersion } from "./index.js";

describe("v36 trial", () => {
  it("registers a separate trial while keeping measured v35 and default v33", () => {
    const measured = getSokoBotVersion("v35");
    const trial = getSokoBotVersion("v36");
    expect(trial.model).toBe(measured.model);
    expect(trial.systemPrompt).toBe(measured.systemPrompt);
    expect(trial.skills).toEqual([...measured.skills, "input-reliability-v36"]);
    expect(measured.skills).not.toContain("input-reliability-v36");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v33");
  });
});
