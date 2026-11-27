import { describe, expect, it } from "vitest";
import {
  ASK_POLICY_SECTION,
  applyVersionCapabilities,
  CMO_SOKO_BOT_VERSION_ID,
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  type SokoBotVersion,
  versionIntegrityProblems,
} from "../index.js";
import { SOKO_BOT_CAPABILITIES } from "../policy.js";

function stripVariantMeta(version: SokoBotVersion) {
  const {
    id: _id,
    name: _name,
    summary: _summary,
    createdAt: _createdAt,
    routeSteering: _routeSteering,
    classifierPolicy: _classifierPolicy,
    e1Prompts: _e1Prompts,
    cmoOwnerAudience: _cmoOwnerAudience,
    askPolicy: _askPolicy,
    cmoApplyChanges: _cmoApplyChanges,
    ...rest
  } = version;
  return rest;
}

describe("E1 opt-in test versions on v40 and cmo-v27", () => {
  it("keeps live defaults, control (v39/cmo-v26), and loop-only (v40/cmo-v27) completely free of E1 flags", () => {
    expect(DEFAULT_SOKO_BOT_VERSION_ID).not.toContain("e1");
    expect(CMO_SOKO_BOT_VERSION_ID).not.toContain("e1");
    for (const id of ["v39", "v40", "cmo-v26", "cmo-v27"]) {
      const version = getSokoBotVersion(id);
      expect(version.routeSteering).toBeUndefined();
      expect(version.classifierPolicy).toBeUndefined();
      expect(version.e1Prompts).toBeUndefined();
      expect(version.cmoOwnerAudience).toBeUndefined();
      expect(version.askPolicy).toBeUndefined();
      expect(version.cmoApplyChanges).toBeUndefined();
      expect(composeSystemPrompt(version)).not.toContain(ASK_POLICY_SECTION);
    }
  });

  it.each([
    [
      "v40-e1-route",
      "v40",
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ],
    [
      "v40-e1-v4",
      "v40",
      true,
      "v4",
      undefined,
      undefined,
      undefined,
      undefined,
    ],
    ["v40-e1", "v40", true, "v4", true, undefined, true, undefined],
    [
      "cmo-v27-e1-route",
      "cmo-v27",
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ],
    [
      "cmo-v27-e1-v4",
      "cmo-v27",
      true,
      "v4",
      undefined,
      undefined,
      undefined,
      undefined,
    ],
    ["cmo-v27-e1", "cmo-v27", true, "v4", true, true, true, true],
  ] as const)(
    "%s differs from %s only by its declared E1 flag(s), passes version integrity, and preserves prompt-cache invariance",
    (id, baseId, routeSteering, classifierPolicy, e1Prompts, cmoOwnerAudience, askPolicy, cmoApplyChanges) => {
      const base = getSokoBotVersion(baseId);
      const variant = getSokoBotVersion(id);
      expect(variant.id).toBe(id);
      expect(variant.planLoop).toBe(true);
      expect(variant.routeSteering).toBe(routeSteering);
      expect(variant.classifierPolicy).toBe(classifierPolicy);
      expect(variant.e1Prompts).toBe(e1Prompts);
      expect(variant.cmoOwnerAudience).toBe(cmoOwnerAudience);
      expect(variant.askPolicy).toBe(askPolicy);
      expect(variant.cmoApplyChanges).toBe(cmoApplyChanges);
      expect(stripVariantMeta(variant)).toEqual(stripVariantMeta(base));

      expect(
        versionIntegrityProblems(
          variant,
          applyVersionCapabilities(variant, SOKO_BOT_CAPABILITIES),
        ),
      ).toEqual([]);

      const promptA = composeSystemPrompt(variant, { name: "Ada" } as never, {
        clientTurnId: null,
        occasions: ["chat"],
      });
      const promptB = composeSystemPrompt(
        variant,
        { name: "Nova", shared: true } as never,
        {
          clientTurnId: "cmo:production:1",
          occasions: ["production", "MANAGE_WORK"],
        },
      );
      expect(promptA).toBe(promptB);
      expect(promptA).not.toContain("# Routes");
      expect(promptA).toContain("# Act or ask");
      expect(promptA).toContain("when (date, time, or time zone)");
      expect(promptA).toContain(
        "which account, recipient, or audience (target)",
      );
      if (askPolicy) {
        expect(promptA).toContain(ASK_POLICY_SECTION);
      } else {
        expect(promptA).not.toContain(ASK_POLICY_SECTION);
      }
      if (e1Prompts) {
        expect(promptA).toContain("# Finishing the request");
        if (variant.profile === "cmo") {
          expect(promptA).toContain("# Applying requested changes");
          expect(promptA).toContain(
            "You are a shared Project assistant, not a private personal assistant.",
          );
        } else {
          expect(promptA).not.toContain("# Applying requested changes");
        }
      } else {
        expect(promptA).not.toContain("# Finishing the request");
      }
    },
  );
});
