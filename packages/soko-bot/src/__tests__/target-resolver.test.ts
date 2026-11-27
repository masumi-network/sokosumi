import { describe, expect, it } from "vitest";
import {
  applyVersionCapabilities,
  CMO_SOKO_BOT_VERSION_ID,
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  SOKO_BOT_PRODUCT_VERSIONS,
  SOKO_BOT_VERSIONS,
  type SokoBotVersion,
  TARGET_RESOLVER_SECTION,
  versionIntegrityProblems,
} from "../index.js";
import { SOKO_BOT_CAPABILITIES } from "../policy.js";

describe("targetResolver version flag (E10)", () => {
  it("is omitted on every shipped personal and product version", () => {
    for (const version of [
      ...SOKO_BOT_VERSIONS,
      ...SOKO_BOT_PRODUCT_VERSIONS,
    ]) {
      expect(version.targetResolver).toBeUndefined();
      expect(composeSystemPrompt(version)).not.toContain(
        TARGET_RESOLVER_SECTION,
      );
    }
  });

  it("appends TARGET_RESOLVER_SECTION only when targetResolver is enabled and stays cache-invariant", () => {
    const basePersonal = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID);
    const flaggedPersonal: SokoBotVersion = {
      ...basePersonal,
      targetResolver: true,
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
    expect(promptA).toContain(TARGET_RESOLVER_SECTION);
    expect(promptA).toBe(promptB);
    expect(
      versionIntegrityProblems(
        flaggedPersonal,
        applyVersionCapabilities(flaggedPersonal, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);

    const baseCmo = getSokoBotVersion(CMO_SOKO_BOT_VERSION_ID);
    const flaggedCmo: SokoBotVersion = { ...baseCmo, targetResolver: true };
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
    expect(cmoPromptA).toContain(TARGET_RESOLVER_SECTION);
    expect(cmoPromptA).toBe(cmoPromptB);
    expect(
      versionIntegrityProblems(
        flaggedCmo,
        applyVersionCapabilities(flaggedCmo, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);
  });
});
