import { describe, expect, it } from "vitest";

import { fileTitle, isTeamFileName, parseTeam, teamTree } from "./team-file";

const person = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Person ${id}`,
  role: "Engineer",
  ...extra,
});

const team = (people: unknown[]) => ({
  kind: "sokosumi.team",
  version: 1,
  people,
});

describe("isTeamFileName", () => {
  it("matches only the .team.json suffix, in any case", () => {
    expect(isTeamFileName("Team.team.json")).toBe(true);
    expect(isTeamFileName("TEAM.TEAM.JSON")).toBe(true);
    expect(isTeamFileName("team.json")).toBe(false);
    expect(isTeamFileName("Team.pdf")).toBe(false);
  });
});

describe("fileTitle", () => {
  it("drops the team suffix and leaves other names alone", () => {
    expect(fileTitle("Team.team.json")).toBe("Team");
    expect(fileTitle("Teaser.pdf")).toBe("Teaser.pdf");
  });
});

describe("parseTeam", () => {
  it("accepts a minimal team and fills the defaults", () => {
    const parsed = parseTeam(team([person("a")]));
    expect(parsed?.people[0]).toMatchObject({
      highlights: [],
      experience: [],
      education: [],
      advisor: false,
    });
  });

  it("rejects photos that would load from another host", () => {
    expect(
      parseTeam(
        team([person("a", { photo: "https://tracker.example/pixel.png" })]),
      ),
    ).toBeNull();
    expect(
      parseTeam(team([person("a", { photo: "data:image/png;base64,iVBOR=" })])),
    ).not.toBeNull();
  });

  it("rejects a LinkedIn link that is not LinkedIn over https", () => {
    expect(
      parseTeam(team([person("a", { linkedin: "javascript:alert(1)" })])),
    ).toBeNull();
    expect(
      parseTeam(
        team([person("a", { linkedin: "https://evil.example/linkedin.com" })]),
      ),
    ).toBeNull();
    expect(
      parseTeam(
        team([
          person("a", { linkedin: "https://www.linkedin.com/in/someone" }),
        ]),
      ),
    ).not.toBeNull();
  });

  it("rejects anything that is not a team file", () => {
    expect(parseTeam({ people: [person("a")] })).toBeNull();
    expect(parseTeam(team([]))).toBeNull();
  });
});

describe("teamTree", () => {
  const ids = (nodes: ReturnType<typeof teamTree>["roots"]): unknown =>
    nodes.map((node) => [node.person.id, ids(node.reports)]);

  it("nests reports under their manager and keeps advisors apart", () => {
    const parsed = parseTeam(
      team([
        person("ceo"),
        person("cto", { reportsTo: "ceo" }),
        person("dev", { reportsTo: "cto" }),
        person("cmo", { reportsTo: "ceo" }),
        person("adv", { advisor: true }),
      ]),
    );
    if (!parsed) throw new Error("expected a team");
    const tree = teamTree(parsed);
    expect(ids(tree.roots)).toEqual([
      [
        "ceo",
        [
          ["cto", [["dev", []]]],
          ["cmo", []],
        ],
      ],
    ]);
    expect(tree.advisors.map((advisor) => advisor.id)).toEqual(["adv"]);
  });

  it("keeps everyone when a manager is missing or reporting loops", () => {
    const parsed = parseTeam(
      team([
        person("a", { reportsTo: "b" }),
        person("b", { reportsTo: "a" }),
        person("c", { reportsTo: "gone" }),
      ]),
    );
    if (!parsed) throw new Error("expected a team");
    expect(ids(teamTree(parsed).roots)).toEqual([
      ["c", []],
      ["a", [["b", []]]],
    ]);
  });
});
