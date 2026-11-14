import { describe, expect, it } from "vitest";
import { DEFAULT_SOKO_BOT_VERSION_ID, getSokoBotVersion } from "./index.js";

describe("v37 trial", () => {
  it("keeps measured versions and the fleet default separate from the new trial", () => {
    const measured = getSokoBotVersion("v36");
    const trial = getSokoBotVersion("v37");
    expect(trial.id).toBe("v37");
    expect(trial.model).toBe(measured.model);
    expect(trial.systemPrompt).toBe(measured.systemPrompt);
    expect(trial.skills).toEqual([...measured.skills, "work-completion-v37"]);
    expect(measured.skills).not.toContain("work-completion-v37");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v33");
  });
});
