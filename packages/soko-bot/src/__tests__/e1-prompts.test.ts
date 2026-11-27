import { describe, expect, it } from "vitest";
import { SOKO_BOT_CAPABILITIES } from "../policy.js";
import {
  applyE1SystemPrompt,
  E1_CUSO_CHANGE_SCOPE_SECTION,
  E1_FINISHING_SECTION,
} from "../versions/e1-prompts.js";
import {
  applyVersionCapabilities,
  composeSystemPrompt,
  composeTurnPreamble,
  getSokoBotSkillForVersion,
  getSokoBotVersion,
} from "../versions/index.js";
import { versionIntegrityProblems } from "../versions/integrity.js";

describe("e1Prompts version flag", () => {
  it("leaves flag-off Soko Bot and Cuso versions byte-identical", () => {
    const v36 = getSokoBotVersion("v36");
    const cmo = getSokoBotVersion("cmo-v24");
    expect(v36.e1Prompts).toBeUndefined();
    expect(cmo.e1Prompts).toBeUndefined();
    expect(applyE1SystemPrompt(v36.systemPrompt, v36)).toBe(
      v36.systemPrompt.trim(),
    );
    expect(applyE1SystemPrompt(cmo.systemPrompt, cmo)).toBe(
      cmo.systemPrompt.trim(),
    );
    expect(
      getSokoBotSkillForVersion("long-and-chained-work-follow-ups", v36)
        .content,
    ).toContain("sleep 120");
    expect(composeSystemPrompt(v36)).not.toContain("# Finishing the request");
    expect(composeSystemPrompt(cmo)).not.toContain(
      "# Applying requested changes",
    );
  });

  it("applies finishing checklist, durable wakes, scheduledAt clarity, and tighter index on Soko Bot without leaking CMO rules", () => {
    const base = getSokoBotVersion("v36");
    const e1 = {
      ...base,
      skillsOnDemand: true as const,
      e1Prompts: true as const,
    };
    const prompt = composeSystemPrompt(e1);
    expect(prompt).toContain(E1_FINISHING_SECTION);
    expect(prompt).toContain(
      "updating existing or upcoming items only within the scope the owner asked for",
    );
    expect(prompt).not.toContain(E1_CUSO_CHANGE_SCOPE_SECTION);
    expect(prompt).toContain(
      "Your owner's mail, calendar, files, memory, pending decisions, and costs are theirs to share",
    );
    expect(prompt).toContain(
      "not for read-only lookups, audits, or single-turn edits",
    );

    const chained = getSokoBotSkillForVersion(
      "long-and-chained-work-follow-ups",
      e1,
    );
    expect(chained.content).not.toContain("sleep 120");
    expect(chained.content).toContain("durable wakes");

    const social = getSokoBotSkillForVersion("social-posting-instructions", e1);
    expect(social.content).toContain("intended publication date or time");
    expect(social.content).toContain(
      "explicitly asks you to pick a publication slot and schedule it",
    );
    expect(social.content).toContain(
      "Never put a review deadline or unrequested suggested date into `scheduledAt`",
    );
    expect(social.content).toContain("unscheduled proposals");

    const preamble = composeTurnPreamble(e1, undefined, {
      clientTurnId: null,
      occasions: ["MIXED"],
    });
    expect(preamble).not.toContain("sleep 120");
    expect(preamble).toContain("durable wakes");

    expect(
      versionIntegrityProblems(
        { ...base, e1Prompts: true },
        applyVersionCapabilities(base, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);
    const onDemandValid = {
      ...e1,
      skills: e1.skills.filter((id) => id !== "result-cards"),
    };
    expect(
      versionIntegrityProblems(
        onDemandValid,
        applyVersionCapabilities(onDemandValid, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);
  });

  it("replaces personal-assistant TEAMMATE refusal and adds strategy-and-posts scope on Cuso with prompt-cache invariance", () => {
    const base = getSokoBotVersion("cmo-v24");
    const e1 = { ...base, e1Prompts: true as const };

    const promptA = composeSystemPrompt(e1, { name: "Cuso" } as never, {
      clientTurnId: null,
      occasions: ["chat"],
    });
    const promptB = composeSystemPrompt(
      e1,
      { name: "Other", shared: true } as never,
      {
        clientTurnId: "cmo:production:1",
        occasions: ["production"],
      },
    );
    expect(promptA).toBe(promptB);
    expect(promptA).toContain(E1_FINISHING_SECTION);
    expect(promptA).toContain(E1_CUSO_CHANGE_SCOPE_SECTION);
    expect(promptA).toContain("Single-post edits stay on that post.");
    expect(promptA).toContain(
      "within any item or date limits the owner stated",
    );
    expect(promptA).toContain("Proposals stay pending.");
    expect(promptA).toContain(
      "You are a shared Project assistant, not a private personal assistant.",
    );
    expect(promptA).not.toContain(
      "Your owner's mail, calendar, files, memory, pending decisions, and costs are theirs to share",
    );
    expect(
      versionIntegrityProblems(
        e1,
        applyVersionCapabilities(e1, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);
  });
});
