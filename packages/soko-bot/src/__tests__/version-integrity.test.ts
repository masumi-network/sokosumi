import { describe, expect, it } from "vitest";
import { SOKO_BOT_CAPABILITIES } from "../policy.js";
import {
  applyVersionCapabilities,
  composeSystemPrompt,
  getSokoBotVersion,
  SOKO_BOT_PRODUCT_VERSIONS,
  SOKO_BOT_VERSIONS,
} from "../versions/index.js";
import {
  type TurnToolProfile,
  versionIntegrityProblems,
} from "../versions/integrity.js";

const VERSIONS = [...SOKO_BOT_VERSIONS, ...SOKO_BOT_PRODUCT_VERSIONS];

function everyTurn(version: (typeof VERSIONS)[number]) {
  return applyVersionCapabilities(version, SOKO_BOT_CAPABILITIES);
}

describe("version integrity", () => {
  it.each(VERSIONS.map((version) => [version.id, version] as const))(
    "%s is whole: every skill exists, is indexed and has the tools it needs",
    (_id, version) => {
      expect(versionIntegrityProblems(version, everyTurn(version))).toEqual([]);
    },
  );

  it("names a skill a version's text points to but cannot read", () => {
    const v36 = getSokoBotVersion("v36");
    const pointing = {
      ...v36,
      systemPrompt: `${v36.systemPrompt}\nFor a launch, read_skill cmo-launch-video first.`,
    };
    expect(versionIntegrityProblems(pointing, everyTurn(v36))).toContain(
      "system prompt names skill cmo-launch-video, not in this version",
    );
  });

  it("names the skill and the missing tool when a version drops one", () => {
    const v24 = getSokoBotVersion("cmo-v24");
    const tools = everyTurn(v24).filter((tool) => tool !== "read_file");
    expect(versionIntegrityProblems(v24, tools)).toContain(
      "every turn: cmo-site-pages requires read_file, not offered",
    );
  });

  it("checks a narrowed tool set against the skills its turns carry", () => {
    const v24 = getSokoBotVersion("cmo-v24");
    const narrow: TurnToolProfile = {
      id: "production",
      appliesTo: (version) => version.id === "cmo-v24",
      occasion: "production",
      tools: ["write_month_pieces", "report_update"],
    };
    const problems = versionIntegrityProblems(v24, everyTurn(v24), [narrow]);
    expect(problems).toContain(
      "production: cmo-production-picked requires update_social_post, not offered",
    );
    expect(
      problems.some((problem) => problem.includes("cmo-strategy-v22")),
    ).toBe(false);
  });

  it("checks a version that carries every skill up front too", () => {
    const v23 = getSokoBotVersion("cmo-v23");
    const tools = everyTurn(v23).filter((tool) => tool !== "read_file");
    expect(versionIntegrityProblems(v23, tools)).toContain(
      "every turn: cmo-site-pages requires read_file, not offered",
    );
  });

  it("needs read_skill wherever an on-demand version's turns run", () => {
    const v24 = getSokoBotVersion("cmo-v24");
    const withoutRead: TurnToolProfile = {
      id: "production",
      appliesTo: (version) => version.id === "cmo-v24",
      occasion: "production",
      tools: everyTurn(v24).filter((tool) => tool !== "read_skill"),
    };
    expect(
      versionIntegrityProblems(v24, everyTurn(v24), [withoutRead]),
    ).toContain("production: read_skill not offered, the index cannot be read");
  });

  it("finds a skill without its index line and a skill listed twice", () => {
    const v24 = getSokoBotVersion("cmo-v24");
    const broken = {
      ...v24,
      skills: [...v24.skills, "cmo-site-pages", "not-a-skill"],
    };
    const problems = versionIntegrityProblems(broken, everyTurn(broken));
    expect(problems).toContain("cmo-site-pages is listed twice");
    expect(problems).toContain("not-a-skill is not a skill");
    expect(problems).toContain("not-a-skill has no index line");
  });

  it.each(
    VERSIONS.filter((version) => version.skillsOnDemand).map(
      (version) => [version.id, version] as const,
    ),
  )(
    "%s keeps its system prompt the same for every bot and turn",
    (_id, version) => {
      const a = composeSystemPrompt(version, { name: "Nova" } as never, {
        clientTurnId: null,
        occasions: ["strategy"],
      });
      const b = composeSystemPrompt(
        version,
        { name: "Ada", shared: true } as never,
        {
          clientTurnId: "cmo:production:x",
          occasions: ["chat", "MANAGE_WORK"],
        },
      );
      expect(a).toBe(b);
    },
  );
});
