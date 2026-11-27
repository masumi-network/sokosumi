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
import { DECLINE_OPTIONS_RULE } from "../versions/e13-test-versions.js";

function stripE13Meta(version: SokoBotVersion) {
  const {
    id: _id,
    name: _name,
    summary: _summary,
    createdAt: _createdAt,
    systemPrompt: _systemPrompt,
    declineOptions: _declineOptions,
    ...rest
  } = version;
  return rest;
}

const persona = { name: "Ada" } as never;
const turns = [
  ["chat", { clientTurnId: null, occasions: ["chat", "DELEGATE_TASK"] }],
  [
    "wake",
    { clientTurnId: "event:task", occasions: ["event", "DELEGATE_TASK"] },
  ],
] as const;

describe("E13 opt-in test version on v40", () => {
  it("is registered as a Soko Bot version and is not the default", () => {
    expect(SOKO_BOT_VERSIONS.map((v) => v.id)).toContain("v40-e13");
    expect(SOKO_BOT_PRODUCT_VERSIONS.map((v) => v.id)).not.toContain("v40-e13");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).not.toBe("v40-e13");
  });

  it("only v40-e13 has declineOptions and the rule", () => {
    for (const version of [
      ...SOKO_BOT_VERSIONS,
      ...SOKO_BOT_PRODUCT_VERSIONS,
    ]) {
      const isE13 = version.id === "v40-e13";
      expect(version.declineOptions).toBe(isE13 ? true : undefined);
      expect(version.systemPrompt.includes(DECLINE_OPTIONS_RULE)).toBe(isE13);
    }
  });

  it("is v40 with the rule appended and declineOptions, nothing else changed", () => {
    const base = getSokoBotVersion("v40");
    const variant = getSokoBotVersion("v40-e13");

    expect(stripE13Meta(variant)).toEqual(stripE13Meta(base));
    expect(variant.systemPrompt).toBe(
      `${base.systemPrompt.trimEnd()}\n\n${DECLINE_OPTIONS_RULE}`,
    );
    const variantCaps = applyVersionCapabilities(
      variant,
      SOKO_BOT_CAPABILITIES,
    );
    expect(variantCaps).toEqual(
      applyVersionCapabilities(base, SOKO_BOT_CAPABILITIES),
    );
    expect(versionIntegrityProblems(variant, variantCaps)).toEqual([]);
  });

  it.each(turns)(
    "a %s turn sees the rule, and its preamble is v40's",
    (_, turn) => {
      const base = getSokoBotVersion("v40");
      const variant = getSokoBotVersion("v40-e13");
      const prompt = composeSystemPrompt(variant, persona, turn);
      expect(prompt.replace(`\n\n${DECLINE_OPTIONS_RULE}`, "")).toBe(
        composeSystemPrompt(base, persona, turn),
      );
      expect(composeTurnPreamble(variant, persona, turn)).toBe(
        composeTurnPreamble(base, persona, turn),
      );
    },
  );
});
