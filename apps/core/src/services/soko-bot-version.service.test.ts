import { DEFAULT_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createMock,
  findFirstMock,
  findManyMock,
  findUniqueMock,
  settingFindUniqueMock,
  updateMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  settingFindUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotAuthoredVersion: {
      create: createMock,
      findFirst: findFirstMock,
      findMany: findManyMock,
      findUnique: findUniqueMock,
      update: updateMock,
    },
    sokoBotSetting: {
      findUnique: settingFindUniqueMock,
    },
  },
}));

import {
  archiveAuthoredVersion,
  createAuthoredVersion,
  isKnownSokoBotVersionId,
  listSokoBotVersions,
  resolveSokoBotVersion,
} from "@/services/soko-bot-version.service";

function authoredRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "01960001-0001-7001-8001-000000000001",
    createdAt: new Date("2026-08-27T00:00:00.000Z"),
    updatedAt: new Date("2026-08-27T00:00:00.000Z"),
    slug: "inbox-tuned",
    name: "Inbox tuned",
    summary: "Sharper mail triage",
    model: "google/gemini-3.6-flash",
    inferenceRegion: "eu",
    systemPrompt: "Be useful.",
    skills: ["personal-inbox"],
    capabilities: ["create_task"],
    archivedAt: null,
    createdById: "user_1",
    ...overrides,
  };
}

describe("Soko Bot version resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(null);
    findManyMock.mockResolvedValue([]);
    findUniqueMock.mockResolvedValue(null);
    settingFindUniqueMock.mockResolvedValue(null);
  });

  it("resolves a built-in without touching the database", async () => {
    const version = await resolveSokoBotVersion("v11");

    expect(version.id).toBe("v11");
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("resolves an authored version by slug", async () => {
    findFirstMock.mockResolvedValue(authoredRow());

    const version = await resolveSokoBotVersion("inbox-tuned");

    expect(version.id).toBe("inbox-tuned");
    expect(version.model).toBe("google/gemini-3.6-flash");
    expect(version.inferenceRegion).toBe("eu");
    expect(version.capabilities).toEqual(["create_task"]);
  });

  it("falls back to the default when an id no longer exists", async () => {
    // A bot pinned to a version that was archived still has to run.
    const version = await resolveSokoBotVersion("deleted-version");

    // The default moves with the product; the fallback is what matters here.
    expect(version.id).toBe(DEFAULT_SOKO_BOT_VERSION_ID);
  });

  it("drops an empty tool list so the route ceiling applies", async () => {
    findFirstMock.mockResolvedValue(authoredRow({ capabilities: [] }));

    const version = await resolveSokoBotVersion("inbox-tuned");

    expect(version.capabilities).toBeUndefined();
  });

  it("lists built-ins and authored versions together", async () => {
    findManyMock.mockResolvedValue([authoredRow()]);

    const versions = await listSokoBotVersions();

    expect(versions.some((v) => v.id === "v11" && !v.authored)).toBe(true);
    expect(versions.some((v) => v.id === "inbox-tuned" && v.authored)).toBe(
      true,
    );
  });

  it("refuses to shadow a built-in id", async () => {
    // Shadowing would silently change what a bot pinned to v11 runs.
    await expect(
      createAuthoredVersion(
        {
          slug: "v11",
          name: "Mine",
          model: "google/gemini-3.6-flash",
          systemPrompt: "Be useful.",
          skills: [],
          capabilities: [],
        },
        "user_1",
      ),
    ).rejects.toThrow();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects unknown tools rather than silently dropping them", async () => {
    await expect(
      createAuthoredVersion(
        {
          slug: "custom",
          name: "Mine",
          model: "google/gemini-3.6-flash",
          systemPrompt: "Be useful.",
          skills: [],
          capabilities: ["delete_the_database"],
        },
        "user_1",
      ),
    ).rejects.toThrow(/Unknown tools/);
  });

  it("accepts both built-in and authored ids as known", async () => {
    expect(await isKnownSokoBotVersionId("v11")).toBe(true);
    findFirstMock.mockResolvedValue({ id: "row" });
    expect(await isKnownSokoBotVersionId("inbox-tuned")).toBe(true);
    findFirstMock.mockResolvedValue(null);
    expect(await isKnownSokoBotVersionId("nope")).toBe(false);
  });

  it("refuses to archive the version currently promoted for new bots", async () => {
    findFirstMock.mockResolvedValue(authoredRow());
    settingFindUniqueMock.mockResolvedValue({
      defaultVersionId: "inbox-tuned",
    });

    await expect(archiveAuthoredVersion("inbox-tuned")).rejects.toThrow(
      /Promote another version/,
    );
    expect(updateMock).not.toHaveBeenCalled();
  });
});
