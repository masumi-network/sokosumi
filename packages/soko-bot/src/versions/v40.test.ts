import { describe, expect, it } from "vitest";
import { DEFAULT_SOKO_BOT_VERSION_ID, getSokoBotVersion } from "./index.js";

describe("v40 trial", () => {
  it("keeps measured v39 and the fleet default unchanged", () => {
    const measured = getSokoBotVersion("v39");
    const trial = getSokoBotVersion("v40");
    expect(trial.id).toBe("v40");
    expect(trial.model).toBe(measured.model);
    expect(trial.systemPrompt).toBe(measured.systemPrompt);
    expect(trial.skills).toEqual([
      ...measured.skills,
      "verified-follow-through-v40",
    ]);
    expect(measured.skills).not.toContain("verified-follow-through-v40");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v33");
  });
});
