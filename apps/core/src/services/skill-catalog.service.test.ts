import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    skillCatalogEntry: {
      findMany: db.findMany,
      findUnique: db.findUnique,
      update: db.update,
      updateMany: db.updateMany,
      upsert: db.upsert,
      deleteMany: db.deleteMany,
    },
    $transaction: db.transaction,
  },
}));

vi.mock("@/config/env", () => ({ getEnv: () => ({}) }));

import {
  MAX_SKILL_CONTENT_CHARS,
  parseLeaderboard,
  parseSkillPageDescription,
  refreshSkillCatalog,
  resolveMessageSkills,
  searchSkillCatalog,
} from "./skill-catalog.service";

/** One leaderboard row the way skills.sh escapes it inside its page payload. */
function row(source: string, skillId: string, installs: number): string {
  return `{\\"source\\":\\"${source}\\",\\"skillId\\":\\"${skillId}\\",\\"name\\":\\"${skillId}\\",\\"installs\\":${installs},\\"weeklyInstalls\\":[1,2]}`;
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  for (const fn of Object.values(db)) fn.mockReset();
  db.transaction.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseLeaderboard", () => {
  it("reads unique rows, most installed first", () => {
    const html = [
      row("mattpocock/skills", "grill-me", 10),
      row("vercel-labs/skills", "find-skills", 99),
      row("mattpocock/skills", "grill-me", 10),
    ].join(",");

    expect(parseLeaderboard(html)).toEqual([
      {
        id: "vercel-labs/skills/find-skills",
        source: "vercel-labs/skills",
        name: "find-skills",
        installs: 99,
      },
      {
        id: "mattpocock/skills/grill-me",
        source: "mattpocock/skills",
        name: "grill-me",
        installs: 10,
      },
    ]);
  });
});

describe("parseSkillPageDescription", () => {
  it("decodes the meta description", () => {
    expect(
      parseSkillPageDescription(
        '<meta name="description" content="Plans &amp; designs, &quot;sharp&quot;"/>',
      ),
    ).toBe('Plans & designs, "sharp"');
    expect(parseSkillPageDescription("<html></html>")).toBeNull();
  });
});

describe("refreshSkillCatalog", () => {
  it("ranks the leaderboard and fills missing descriptions", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/")
        ? textResponse([row("a/b", "one", 5), row("a/b", "two", 50)].join(","))
        : textResponse('<meta name="description" content="Does a thing"/>'),
    );
    db.findMany.mockResolvedValue([{ id: "a/b/two" }]);

    const result = await refreshSkillCatalog({ shouldContinue: () => true });

    expect(result).toEqual({ entries: 2, described: 1 });
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "a/b/two" },
        create: expect.objectContaining({ rank: 1, installs: 50 }),
      }),
    );
    expect(db.update).toHaveBeenCalledWith({
      where: { id: "a/b/two" },
      data: { description: "Does a thing" },
    });
  });

  it("stops fetching descriptions when the run is out of time", async () => {
    fetchMock.mockResolvedValue(textResponse(row("a/b", "one", 5)));
    db.findMany.mockResolvedValue([{ id: "a/b/one" }]);

    const result = await refreshSkillCatalog({ shouldContinue: () => false });

    expect(result.described).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a page with no leaderboard", async () => {
    fetchMock.mockResolvedValue(textResponse("<html></html>"));

    await expect(
      refreshSkillCatalog({ shouldContinue: () => true }),
    ).rejects.toThrow("Could not read the skills.sh leaderboard");
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe("searchSkillCatalog", () => {
  const local = {
    id: "a/b/react",
    name: "react",
    source: "a/b",
    description: "React rules",
    installs: 9,
  };

  it("returns the top skills without a query and never searches live", async () => {
    db.findMany.mockResolvedValue([local]);

    expect(await searchSkillCatalog("")).toEqual([local]);
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { rank: { not: null } } }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds skills.sh results when the catalog has few hits", async () => {
    db.findMany.mockResolvedValue([local]);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          skills: [
            { id: "a/b/react", name: "react", source: "a/b", installs: 9 },
            { id: "c/d/react-native", name: "react-native", source: "c/d" },
          ],
        }),
      ),
    );

    expect(await searchSkillCatalog("react")).toEqual([
      local,
      {
        id: "c/d/react-native",
        name: "react-native",
        source: "c/d",
        installs: 0,
        description: null,
      },
    ]);
  });

  it("keeps the catalog results when skills.sh is down", async () => {
    db.findMany.mockResolvedValue([local]);
    fetchMock.mockResolvedValue(textResponse("", 503));

    expect(await searchSkillCatalog("react")).toEqual([local]);
  });
});

describe("resolveMessageSkills", () => {
  const skillMd = "---\nname: grill-me\ndescription: Interview\n---\nAsk.";

  it("refuses more than three skills", async () => {
    await expect(
      resolveMessageSkills(["a/b/1", "a/b/2", "a/b/3", "a/b/4"]),
    ).rejects.toThrow("Attach at most 3 skills");
  });

  it("uses fresh cached markdown without reading GitHub", async () => {
    db.findUnique.mockResolvedValue({
      name: "grill-me",
      description: "Interview",
      markdown: skillMd,
      markdownFetchedAt: new Date(),
    });

    const [skill] = await resolveMessageSkills([
      "mattpocock/skills/grill-me",
      "mattpocock/skills/grill-me",
    ]);

    expect(skill).toEqual({
      id: "mattpocock/skills/grill-me",
      name: "grill-me",
      description: "Interview",
      url: "https://skills.sh/mattpocock/skills/grill-me",
      content: skillMd,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads an uncached skill from its usual path and caps it", async () => {
    db.findUnique.mockResolvedValue({
      name: "grill-me",
      description: null,
      markdown: null,
      markdownFetchedAt: null,
    });
    const long = `${skillMd}\n${"x".repeat(MAX_SKILL_CONTENT_CHARS)}`;
    fetchMock.mockImplementation(async (url: string) =>
      url ===
      "https://raw.githubusercontent.com/mattpocock/skills/HEAD/skills/grill-me/SKILL.md"
        ? textResponse(long)
        : textResponse("", 404),
    );

    const [skill] = await resolveMessageSkills(["mattpocock/skills/grill-me"]);

    expect(skill?.description).toBe("Interview");
    expect(skill?.content.length).toBeLessThan(long.length);
    expect(skill?.content).toContain("[Skill truncated");
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mattpocock/skills/grill-me" },
        data: expect.objectContaining({ markdown: long }),
      }),
    );
  });

  it("refuses an id that names no skill", async () => {
    await expect(resolveMessageSkills(["mattpocock/skills"])).rejects.toThrow(
      "Use a skill id like owner/repo/skill",
    );
  });
});
