import { describe, expect, it } from "vitest";
import {
  applyVersionCapabilities,
  CMO_SOKO_BOT_VERSION_ID,
  composeSystemPrompt,
  getSokoBotVersion,
  SOKO_BOT_PRODUCT_VERSIONS,
  SOKO_BOT_VERSIONS,
  type SokoBotVersion,
  versionIntegrityProblems,
} from "../index.js";
import { SOKO_BOT_CAPABILITIES } from "../policy.js";

describe("cmoApplyChanges version flag", () => {
  it("is omitted on every shipped personal and product version", () => {
    for (const version of [
      ...SOKO_BOT_VERSIONS,
      ...SOKO_BOT_PRODUCT_VERSIONS,
    ]) {
      expect(version.cmoApplyChanges).toBeUndefined();
    }
  });

  it("leaves system prompt unchanged and passes version integrity when enabled on CMO", () => {
    const base = getSokoBotVersion(CMO_SOKO_BOT_VERSION_ID);
    const flagged: SokoBotVersion = { ...base, cmoApplyChanges: true };
    expect(composeSystemPrompt(flagged)).toBe(composeSystemPrompt(base));
    expect(
      versionIntegrityProblems(
        flagged,
        applyVersionCapabilities(flagged, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);
  });
});
