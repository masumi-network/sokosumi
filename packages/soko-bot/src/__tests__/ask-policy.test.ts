import { describe, expect, it } from "vitest";
import {
  ASK_POLICY_SECTION,
  applyVersionCapabilities,
  CMO_SOKO_BOT_VERSION_ID,
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  SOKO_BOT_PRODUCT_VERSIONS,
  SOKO_BOT_VERSIONS,
  type SokoBotVersion,
  versionIntegrityProblems,
} from "../index.js";
import { SOKO_BOT_CAPABILITIES } from "../policy.js";

describe("askPolicy version flag", () => {
  it("is omitted on every shipped, control, loop-only, and isolated non-askPolicy version", () => {
    for (const version of [
      ...SOKO_BOT_VERSIONS,
      ...SOKO_BOT_PRODUCT_VERSIONS,
    ]) {
      if (version.id.endsWith("-e1")) continue;
      expect(version.askPolicy).toBeUndefined();
      expect(composeSystemPrompt(version)).not.toContain(ASK_POLICY_SECTION);
    }
  });

  it("appends ASK_POLICY_SECTION only when askPolicy is enabled and stays cache-invariant", () => {
    const basePersonal = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID);
    const flaggedPersonal: SokoBotVersion = {
      ...basePersonal,
      askPolicy: true,
    };
    const promptA = composeSystemPrompt(
      flaggedPersonal,
      { name: "Nova" } as never,
      { clientTurnId: null, occasions: ["chat"] },
    );
    const promptB = composeSystemPrompt(
      flaggedPersonal,
      { name: "Nova" } as never,
      { clientTurnId: "sched-1", occasions: ["schedule"] },
    );
    expect(promptA).toContain(ASK_POLICY_SECTION);
    expect(promptA).toBe(promptB);
    expect(
      versionIntegrityProblems(
        flaggedPersonal,
        applyVersionCapabilities(flaggedPersonal, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);

    const baseCmo = getSokoBotVersion(CMO_SOKO_BOT_VERSION_ID);
    const flaggedCmo: SokoBotVersion = { ...baseCmo, askPolicy: true };
    const cmoPromptA = composeSystemPrompt(
      flaggedCmo,
      { name: "Cuso", shared: true } as never,
      { clientTurnId: null, occasions: ["chat"] },
    );
    const cmoPromptB = composeSystemPrompt(
      flaggedCmo,
      { name: "Cuso", shared: true } as never,
      { clientTurnId: "prod-1", occasions: ["production"] },
    );
    expect(cmoPromptA).toContain(ASK_POLICY_SECTION);
    expect(cmoPromptA).toBe(cmoPromptB);
    expect(
      versionIntegrityProblems(
        flaggedCmo,
        applyVersionCapabilities(flaggedCmo, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);
  });
});
