import { describe, expect, it } from "vitest";

import { TRY_ASKING_BY_INTENT, tryAskingPromptKey } from "../try-asking";

describe("TRY_ASKING_BY_INTENT", () => {
  it("gives three featured coworkers per intent", () => {
    for (const intent of ["chat", "tasks", "either"] as const) {
      expect(TRY_ASKING_BY_INTENT[intent]).toHaveLength(3);
      expect(new Set(TRY_ASKING_BY_INTENT[intent]).size).toBe(3);
    }
  });

  it("leads with Elena for not-sure-yet", () => {
    expect(TRY_ASKING_BY_INTENT.either[0]).toBe("elena");
  });

  it("builds prompt translation keys", () => {
    expect(tryAskingPromptKey("either", "elena")).toBe(
      "tryAsking.prompts.either.elena",
    );
  });
});
