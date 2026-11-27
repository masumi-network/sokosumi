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

  it("answers an unknown id with the closest ids and every id it can read", async () => {
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("cmo-v24"));
    const unknown = readSkill(authorized("cmo-v24"), {
      skill: "cmo-launch-plan",
    });
    await expect(unknown).rejects.toThrow(
      /^No skill "cmo-launch-plan"\. Closest: [^.]*\blaunch-plan\b.*Your skills: .*cmo-strategy-v22.*Writing skills, read the same way:/,
    );
    await expect(
      readSkill(authorized("cmo-v24"), { skill: "cmo-seo" }),
    ).rejects.toThrow(/Closest: [^.]*\bcmo-seo-reports/);
  });

  it("refuses a skill of another version", async () => {
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("v36"));
    await expect(
      readSkill(authorized("v36"), { skill: "cmo-strategy-v22" }),
    ).rejects.toThrow(/No skill/);
  });

  it("applies autoResultCards skill rewrites when the version enables the flag and keeps flag-off raw", async () => {
    const v36 = getSokoBotVersion("v36");
    resolveSokoBotVersion.mockResolvedValue(v36);
    const flagOff = await readSkill(authorized("v36"), {
      skill: "result-cards",
    });
    expect(flagOff.content).toBe(
      SOKO_BOT_SKILLS.find((skill) => skill.id === "result-cards")?.content,
    );

    resolveSokoBotVersion.mockResolvedValue({ ...v36, autoResultCards: true });
    const flagOn = await readSkill(authorized("v36"), {
      skill: "result-cards",
    });
    expect(flagOn.content).toContain(
      "Core attaches result cards automatically from your committed writes",
    );
    expect(flagOn.content).toContain(
      "pass `resultReferences` to `send_message`.",
    );
    expect(flagOn.content).not.toContain(
      "After each successful action below, call `preview_result`",
    );

    const socialOn = await readSkill(authorized("v36"), {
      skill: "social-posting-instructions",
    });
    expect(socialOn.content).toContain(
      "Core attaches its approval card automatically",
    );
    expect(socialOn.content).not.toContain(
      'then call `preview_result` with `{kind:"social_post",id,projectId}`',
    );
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
