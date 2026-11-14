import { describe, expect, it } from "vitest";
import { DEFAULT_SOKO_BOT_VERSION_ID, getSokoBotVersion } from "./index.js";

describe("v39 trial", () => {
  it("registers a separate trial without changing v38 or the fleet default", () => {
    const measured = getSokoBotVersion("v38");
    const trial = getSokoBotVersion("v39");
    expect(trial.id).toBe("v39");
    expect(trial.model).toBe(measured.model);
    expect(trial.systemPrompt).toBe(measured.systemPrompt);
    expect(trial.skills).toEqual([...measured.skills, "resource-identity-v39"]);
    expect(measured.skills).not.toContain("resource-identity-v39");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v33");
  });
});
