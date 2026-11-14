import { describe, expect, it } from "vitest";
import { DEFAULT_SOKO_BOT_VERSION_ID, getSokoBotVersion } from "./index.js";

describe("v38 trial", () => {
  it("registers the measured trial without changing v37 or the fleet default", () => {
    const measured = getSokoBotVersion("v37");
    const trial = getSokoBotVersion("v38");
    expect(trial.id).toBe("v38");
    expect(trial.model).toBe(measured.model);
    expect(trial.systemPrompt).toBe(measured.systemPrompt);
    expect(trial.skills).toEqual([...measured.skills, "verified-state-v38"]);
    expect(measured.skills).not.toContain("verified-state-v38");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v33");
  });
});
