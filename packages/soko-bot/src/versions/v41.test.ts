import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
} from "./index.js";

describe("v41 trial", () => {
  it("registers the trial without changing measured v40 or the fleet default", () => {
    const measured = getSokoBotVersion("v40");
    const trial = getSokoBotVersion("v41");
    expect(trial.id).toBe("v41");
    expect(trial.model).toBe(measured.model);
    expect(trial.capabilities).toBe(measured.capabilities);
    expect(trial.systemPrompt).toBe(measured.systemPrompt);
    expect(trial.skills).toEqual([
      ...measured.skills,
      "proactive-evidence-v41",
    ]);
    expect(composeSystemPrompt(trial)).toContain("# Act on useful evidence");
    expect(composeSystemPrompt(measured)).not.toContain(
      "# Act on useful evidence",
    );
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v33");
  });
});
