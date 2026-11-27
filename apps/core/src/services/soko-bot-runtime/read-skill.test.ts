import { getSokoBotVersion, SOKO_BOT_SKILLS } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSokoBotVersion = vi.fn();
vi.mock("@/services/soko-bot-version.service", () => ({
  resolveSokoBotVersion: (id: string | null) => resolveSokoBotVersion(id),
}));
vi.mock("@/services/cmo-cuso.service", () => ({
  ONBOARDING_TURN_PREFIX: "cmo:onboarding:",
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const { isSkillRead, readSkill, readSkillAgain } = await import("./read-skill");
const { isForegroundHumanChatTurn, skillOccasions } = await import("./context");
const { PRESET_VERSION } = await import("@/lib/soko-bot/classifier");

function authorized(versionId: string) {
  return { turn: { versionId } } as never;
}

describe("read_skill", () => {
  beforeEach(() => resolveSokoBotVersion.mockReset());

  it("reads one of the version's skills in full", async () => {
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("cmo-v24"));
    const read = await readSkill(authorized("cmo-v24"), {
      skill: "cmo-strategy-v22",
    });
    expect(read.content).toBe(
      SOKO_BOT_SKILLS.find((skill) => skill.id === "cmo-strategy-v22")?.content,
    );
  });

  it("reads a writing skill for Cuso only", async () => {
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("cmo-v24"));
    const read = await readSkill(authorized("cmo-v24"), { skill: "linkedin" });
    expect(read.skill).toBe("linkedin");
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("v36"));
    await expect(
      readSkill(authorized("v36"), { skill: "linkedin" }),
    ).rejects.toThrow(/No skill "linkedin"\. Your skills: /);
  });

  it("lets a Soko Bot with the playbooks read a playbook, and nothing else of Cuso's", async () => {
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("v39"));
    const read = await readSkill(authorized("v39"), { skill: "landing-page" });
    expect(read.skill).toBe("landing-page");
    await expect(
      readSkill(authorized("v39"), { skill: "linkedin" }),
    ).rejects.toThrow(/No skill "linkedin"/);
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("v37"));
    await expect(
      readSkill(authorized("v37"), { skill: "landing-page" }),
    ).rejects.toThrow(/No skill "landing-page"/);
  });

  it("reads the whole skill again on a replayed call", async () => {
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("cmo-v24"));
    const strategy = SOKO_BOT_SKILLS.find(
      (skill) => skill.id === "cmo-strategy-v22",
    )?.content;
    const again = await readSkillAgain(authorized("cmo-v24"), "read_skill", {
      skill: "cmo-strategy-v22",
    });
    expect(again.content).toBe(strategy);
    expect((strategy ?? "").length).toBeGreaterThan(40_000);
    const writing = await readSkillAgain(
      authorized("cmo-v24"),
      "read_writing_skill",
      { skill: "linkedin" },
    );
    expect(writing.skill).toBe("linkedin");
    expect(isSkillRead("read_skill")).toBe(true);
    expect(isSkillRead("read_calendar")).toBe(false);
  });

  it("refuses a skill of another version", async () => {
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("v36"));
    await expect(
      readSkill(authorized("v36"), { skill: "cmo-strategy-v22" }),
    ).rejects.toThrow(/No skill/);
  });

  it("returns E1-patched skills on read_skill only when e1Prompts is enabled", async () => {
    const v36 = getSokoBotVersion("v36");
    resolveSokoBotVersion.mockResolvedValueOnce(v36);
    const legacy = await readSkill(authorized("v36"), {
      skill: "long-and-chained-work-follow-ups",
    });
    expect(legacy.content).toContain("sleep 120");

    resolveSokoBotVersion.mockResolvedValueOnce({ ...v36, e1Prompts: true });
    const patched = await readSkill(authorized("v36"), {
      skill: "long-and-chained-work-follow-ups",
    });
    expect(patched.content).not.toContain("sleep 120");
    expect(patched.content).toContain("durable wakes");

    resolveSokoBotVersion.mockResolvedValueOnce({ ...v36, e1Prompts: true });
    const social = await readSkill(authorized("v36"), {
      skill: "social-posting-instructions",
    });
    expect(social.content).toContain("unscheduled proposals");
  });
});

describe("skillOccasions", () => {
  const packet = (kind: string) => ({
    workspace: { marketing: { organizer: { kind } } },
  });

  it("takes a Cuso turn's kind from the organizer", () => {
    expect(
      skillOccasions(
        { clientTurnId: "cmo:strategy:1", source: "EVENT", route: null },
        packet("strategy"),
      ),
    ).toEqual(["strategy"]);
    expect(
      skillOccasions(
        { clientTurnId: "cmo:onboarding:b:1", source: "EVENT", route: null },
        packet("quiet"),
      ),
    ).toEqual(["quiet", "onboarding"]);
  });

  it("takes a Soko Bot turn's route and source", () => {
    expect(
      skillOccasions(
        { clientTurnId: null, source: "INGEST", route: "MANAGE_WORK" },
        { workspace: {} },
      ),
    ).toEqual(["MANAGE_WORK", "mail"]);
  });

  it("keeps work skill preloading under routeSteering without emitting CLARIFY or DIRECT_RESPONSE", () => {
    const opts = { routeSteering: true, foregroundHumanChat: true };
    // Confident work route still preloads its skills.
    expect(
      skillOccasions(
        { clientTurnId: null, source: "CHAT", route: "DELEGATE_TASK" },
        { workspace: {} },
        opts,
      ),
    ).toEqual(["DELEGATE_TASK"]);
    // Split vote / abstain with work mass recovers work preloading.
    expect(
      skillOccasions(
        {
          clientTurnId: null,
          source: "CHAT",
          route: "CLARIFY",
          classification: {
            rawRoute: "ABSTAIN",
            workConfidence: 0.42,
            abstained: true,
          },
        },
        { workspace: {} },
        opts,
      ),
    ).toEqual(["MANAGE_WORK"]);
    // Classifier failure recovers work preloading instead of starving skills.
    expect(
      skillOccasions(
        {
          clientTurnId: null,
          source: "CHAT",
          route: "CLARIFY",
          classification: { classifierFailed: true },
        },
        { workspace: {} },
        opts,
      ),
    ).toEqual(["MANAGE_WORK"]);
    // Pure low-work Q&A emits neither CLARIFY nor DIRECT_RESPONSE.
    expect(
      skillOccasions(
        {
          clientTurnId: null,
          source: "CHAT",
          route: "DIRECT_RESPONSE",
          classification: { rawRoute: "DIRECT_RESPONSE", workConfidence: 0.04 },
        },
        { workspace: {} },
        opts,
      ),
    ).toEqual([]);
    // Autonomous turns keep legacy occasions unchanged.
    expect(
      skillOccasions(
        { clientTurnId: null, source: "SCHEDULE", route: "CLARIFY" },
        { workspace: {} },
        { routeSteering: true, foregroundHumanChat: false },
      ),
    ).toEqual(["CLARIFY", "schedule"]);
  });
});

describe("isForegroundHumanChatTurn", () => {
  it("matches human foreground chat (owner or teammate) and excludes autonomous, child, preset, and assistant turns", () => {
    const base = {
      source: "CHAT",
      chainDepth: 0,
      parentTurnId: null,
      classifierVersion: "soko-bot-classifier-jev-seo-v3",
    };
    expect(isForegroundHumanChatTurn(base, "OWNER")).toBe(true);
    expect(isForegroundHumanChatTurn(base, "TEAMMATE")).toBe(true);
    expect(isForegroundHumanChatTurn(base, "ASSISTANT")).toBe(false);
    expect(
      isForegroundHumanChatTurn({ ...base, source: "SCHEDULE" }, "OWNER"),
    ).toBe(false);
    expect(
      isForegroundHumanChatTurn({ ...base, source: "INGEST" }, "OWNER"),
    ).toBe(false);
    expect(
      isForegroundHumanChatTurn({ ...base, source: "EVENT" }, "OWNER"),
    ).toBe(false);
    expect(
      isForegroundHumanChatTurn({ ...base, parentTurnId: "turn-1" }, "OWNER"),
    ).toBe(false);
    expect(isForegroundHumanChatTurn({ ...base, chainDepth: 1 }, "OWNER")).toBe(
      false,
    );
    expect(
      isForegroundHumanChatTurn(
        { ...base, classifierVersion: PRESET_VERSION },
        "OWNER",
      ),
    ).toBe(false);
  });
});
