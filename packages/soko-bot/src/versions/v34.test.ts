import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
} from "./index.js";

describe("v34 rollout", () => {
  it("keeps the deployed default and prior version frozen while adding the trial", () => {
    const previous = getSokoBotVersion("v33");
    const trial = getSokoBotVersion("v34");
    expect(trial.id).toBe("v34");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v33");
    expect(trial.model).toBe(previous.model);
    expect(previous.skills).not.toContain("work-reliability-v34");
    expect(trial.skills).toEqual([...previous.skills, "work-reliability-v34"]);
  });

  it("replaces the inherited open-ended spending approval instead of appending a conflicting rule", () => {
    const previous = getSokoBotVersion("v33");
    const trial = getSokoBotVersion("v34");
    const oldRule = "ask only when a price is far above what they would expect";
    expect(previous.systemPrompt).toContain(oldRule);
    expect(trial.systemPrompt).not.toContain(oldRule);
    expect(trial.systemPrompt).toContain(
      "Recurring or trigger-based paid work needs the owner's agreed frequency or trigger and a total cap",
    );
    expect(composeSystemPrompt(trial)).toContain(
      "## Find the right person and keep the brief",
    );
  });
});
