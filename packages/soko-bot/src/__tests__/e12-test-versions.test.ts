import { describe, expect, it } from "vitest";
import {
  applyVersionCapabilities,
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
import { BUILD_ON_RESULT_RULE } from "../versions/e12-test-versions.js";

function stripE12Meta(version: SokoBotVersion) {
  const {
    id: _id,
    name: _name,
    summary: _summary,
    createdAt: _createdAt,
    systemPrompt: _systemPrompt,
    ...rest
  } = version;
  return rest;
}

const chatTurn = {
  clientTurnId: null,
  occasions: ["chat", "DELEGATE_TASK"],
} as const;
const wakeTurn = {
  clientTurnId: "event:task",
  occasions: ["event", "DELEGATE_TASK"],
} as const;
const persona = { name: "Ada" } as never;

describe("E12 opt-in test version on v40", () => {
  it("is registered as a Soko Bot version and is not the default", () => {
    expect(SOKO_BOT_VERSIONS.map((v) => v.id)).toContain("v40-e12");
    expect(SOKO_BOT_PRODUCT_VERSIONS.map((v) => v.id)).not.toContain("v40-e12");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).not.toBe("v40-e12");
  });

  it("only v40-e12 carries the rule", () => {
    for (const version of [
      ...SOKO_BOT_VERSIONS,
      ...SOKO_BOT_PRODUCT_VERSIONS,
    ]) {
      expect(version.systemPrompt.includes(BUILD_ON_RESULT_RULE)).toBe(
        version.id === "v40-e12",
      );
    }
  });

  it("is v40 with the rule appended to its system prompt and nothing else changed", () => {
    const base = getSokoBotVersion("v40");
    const variant = getSokoBotVersion("v40-e12");

    expect(stripE12Meta(variant)).toEqual(stripE12Meta(base));
    expect(variant.systemPrompt).toBe(
      `${base.systemPrompt.trimEnd()}\n\n${BUILD_ON_RESULT_RULE}`,
    );

    const variantCaps = applyVersionCapabilities(
      variant,
      SOKO_BOT_CAPABILITIES,
    );
    const baseCaps = applyVersionCapabilities(base, SOKO_BOT_CAPABILITIES);
    expect(variantCaps).toEqual(baseCaps);
    expect(versionIntegrityProblems(variant, variantCaps)).toEqual([]);
  });

  it.each([
    ["chat", chatTurn],
    ["wake", wakeTurn],
  ] as const)(
    "a %s turn sees the rule, and its preamble is v40's",
    (_, turn) => {
      const base = getSokoBotVersion("v40");
      const variant = getSokoBotVersion("v40-e12");

      const prompt = composeSystemPrompt(variant, persona, turn);
      expect(prompt).toContain(BUILD_ON_RESULT_RULE);
      expect(prompt.replace(`\n\n${BUILD_ON_RESULT_RULE}`, "")).toBe(
        composeSystemPrompt(base, persona, turn),
      );
      expect(composeTurnPreamble(variant, persona, turn)).toBe(
        composeTurnPreamble(base, persona, turn),
      );
    },
  );
});
