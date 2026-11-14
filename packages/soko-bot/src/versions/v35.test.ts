import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
} from "./index.js";

describe("v35 rollout", () => {
  it("adds a separate trial without changing the measured v34 or default", () => {
    const prior = getSokoBotVersion("v34");
    const trial = getSokoBotVersion("v35");
    expect(trial.id).toBe("v35");
    expect(trial.model).toBe(prior.model);
    expect(trial.systemPrompt).toBe(prior.systemPrompt);
    expect(trial.skills).toEqual([...prior.skills, "work-recovery-v35"]);
    expect(prior.skills).not.toContain("work-recovery-v35");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v33");
    expect(composeSystemPrompt(trial)).toContain(
      "# Finish recovery and preserve source claims",
    );
  });
});
