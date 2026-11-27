import { describe, expect, it } from "vitest";
import {
  applyVersionCapabilities,
  CMO_SOKO_BOT_VERSION_ID,
  CMO_SOKO_BOT_VERSION_IDS,
  composeSystemPrompt,
  composeTurnPreamble,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  SOKO_BOT_PRODUCT_VERSIONS,
  SOKO_BOT_VERSIONS,
  type SokoBotVersion,
  versionIntegrityProblems,
} from "../index.js";
import { SOKO_BOT_CAPABILITIES } from "../policy.js";

function stripE11Meta(version: SokoBotVersion) {
  const {
    id: _id,
    name: _name,
    summary: _summary,
    createdAt: _createdAt,
    effortFloor: _effortFloor,
    ...rest
  } = version;
  return rest;
}

describe("E11 opt-in test versions on v40 and cmo-v27", () => {
  it("leaves defaults, control, loop-only, and every other version without effortFloor", () => {
    expect(DEFAULT_SOKO_BOT_VERSION_ID).not.toBe("v40-e11");
    expect(CMO_SOKO_BOT_VERSION_ID).not.toBe("cmo-v27-e11");
    const e11Ids = new Set(["v40-e11", "cmo-v27-e11"]);
    for (const version of [
      ...SOKO_BOT_VERSIONS,
      ...SOKO_BOT_PRODUCT_VERSIONS,
    ]) {
      if (e11Ids.has(version.id)) expect(version.effortFloor).toBe(true);
      else expect(version.effortFloor).toBeUndefined();
    }
  });

  it("registers v40-e11 as a Soko Bot version and cmo-v27-e11 as a Cuso version", () => {
    expect(SOKO_BOT_VERSIONS.map((v) => v.id)).toContain("v40-e11");
    expect(SOKO_BOT_VERSIONS.map((v) => v.id)).not.toContain("cmo-v27-e11");
    expect(CMO_SOKO_BOT_VERSION_IDS).toContain("cmo-v27-e11");
    expect(CMO_SOKO_BOT_VERSION_IDS).not.toContain("v40-e11");
  });

  it.each([
    ["v40-e11", "v40"],
    ["cmo-v27-e11", "cmo-v27"],
  ] as const)(
    "%s is %s with effortFloor: true and nothing else changed",
    (id, baseId) => {
      const base = getSokoBotVersion(baseId);
      const variant = getSokoBotVersion(id);

      expect(variant.id).toBe(id);
      expect(variant.planLoop).toBe(true);
      expect(variant.effortFloor).toBe(true);
      expect(base.effortFloor).toBeUndefined();
      expect(stripE11Meta(variant)).toEqual(stripE11Meta(base));

      const variantCaps = applyVersionCapabilities(
        variant,
        SOKO_BOT_CAPABILITIES,
      );
      const baseCaps = applyVersionCapabilities(base, SOKO_BOT_CAPABILITIES);
      expect(variantCaps).toEqual(baseCaps);
      expect(versionIntegrityProblems(variant, variantCaps)).toEqual([]);

      const chatTurn = {
        clientTurnId: null,
        occasions: ["chat", "MANAGE_WORK"],
      } as const;
      const prodTurn = {
        clientTurnId: "cmo:production:1",
        occasions: ["production", "MANAGE_WORK"],
      } as const;
      const persona = { name: "Ada" } as never;
      const sharedPersona = { name: "Nova", shared: true } as never;

      expect(composeSystemPrompt(variant, persona, chatTurn)).toBe(
        composeSystemPrompt(base, persona, chatTurn),
      );
      expect(composeSystemPrompt(variant, sharedPersona, prodTurn)).toBe(
        composeSystemPrompt(base, sharedPersona, prodTurn),
      );
      expect(composeTurnPreamble(variant, persona, chatTurn)).toBe(
        composeTurnPreamble(base, persona, chatTurn),
      );
      expect(composeTurnPreamble(variant, sharedPersona, prodTurn)).toBe(
        composeTurnPreamble(base, sharedPersona, prodTurn),
      );
    },
  );
});
