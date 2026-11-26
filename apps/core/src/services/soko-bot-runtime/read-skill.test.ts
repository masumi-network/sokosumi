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

const { readSkill } = await import("./read-skill");
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

  it("refuses a skill of another version", async () => {
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("v36"));
    await expect(
      readSkill(authorized("v36"), { skill: "cmo-strategy-v22" }),
    ).rejects.toThrow(/No skill/);
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
