import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
} from "./index.js";

describe("v42 trial", () => {
  it("registers the trial without altering measured v41 or the fleet default", () => {
    const measured = getSokoBotVersion("v41");
    const trial = getSokoBotVersion("v42");
    expect(trial.id).toBe("v42");
    expect(trial.model).toBe(measured.model);
    expect(trial.capabilities).toBe(measured.capabilities);
    expect(trial.systemPrompt).toBe(measured.systemPrompt);
    expect(trial.skills).toEqual([
      ...measured.skills,
      "bounded-follow-through-v42",
    ]);
    expect(composeSystemPrompt(trial)).toContain(
      "# Resolve scope and report confirmed outcomes",
    );
    expect(composeSystemPrompt(measured)).not.toContain(
      "# Resolve scope and report confirmed outcomes",
    );
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v33");
  });
});
