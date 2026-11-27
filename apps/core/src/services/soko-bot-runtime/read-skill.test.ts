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
const { skillOccasions } = await import("./context");

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
});
