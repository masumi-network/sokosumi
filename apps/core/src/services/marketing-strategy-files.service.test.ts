import type { CmoCalendarEntry } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, upsert, update, findUnique, saveFile, download } = vi.hoisted(
  () => ({
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    saveFile: vi.fn(),
    download: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: { marketingStrategyFile: { findMany, upsert, update, findUnique } },
}));
vi.mock("@/services/cuso-project-files.service", () => ({
  saveCusoProjectFile: saveFile,
}));
vi.mock("@/services/file-index.service", () => ({ downloadBlob: download }));

import { withMarketingFiles } from "./marketing-strategy.service";
import {
  marketingPieceMarkdown,
  marketingPieceText,
  readMarketingPieceText,
  writeMarketingStrategyFiles,
} from "./marketing-strategy-files.service";

const drive = {
  workspaceId: "ws-1",
  organizationId: "org-1",
  userId: "user-1",
  projectId: "project-1",
};
const version = { id: "version-1" };

function entry(patch: Partial<CmoCalendarEntry>): CmoCalendarEntry {
  return {
    id: "seo-1",
    date: "2026-11-03",
    channel: "seo",
    format: "article",
    title: "A simple analytics check: small sites",
    status: "idea",
    ...patch,
  } as CmoCalendarEntry;
}

describe("writeMarketingStrategyFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
    saveFile.mockResolvedValue("file-1");
  });

  it("writes an article as a file under its month and links it to the entry", async () => {
    const written = await writeMarketingStrategyFiles({
      version,
      drive,
      entries: [
        entry({ draft: "Three checks before you add analytics." }),
        entry({ id: "x-1", channel: "x", format: "post", draft: "A post" }),
      ],
    });
    expect(written).toBe(1);
    expect(saveFile).toHaveBeenCalledOnce();
    expect(saveFile).toHaveBeenCalledWith(
      drive,
      {
        folder: "Marketing/November 2026",
        filename: "2026-11-03 A simple analytics check- small sites.md",
      },
      Buffer.from(
        "# A simple analytics check: small sites\n\nThree checks before you add analytics.\n",
      ),
      "text/markdown",
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          marketingStrategyId: "version-1",
          entryId: "seo-1",
          fileResourceId: "file-1",
          mediaFileIds: [],
        },
      }),
    );
  });

  it("rewrites a written piece in place, whatever its title says now", async () => {
    findMany.mockResolvedValue([
      {
        entryId: "seo-1",
        fileResource: {
          sourceId: "drive/org-1/Marketing/old name.md",
          displayName: "2026-11-03 Old name.md",
        },
      },
    ]);
    await writeMarketingStrategyFiles({
      version,
      drive,
      entries: [entry({ title: "A new title", draft: "Better words" })],
    });
    expect(saveFile).toHaveBeenCalledWith(
      drive,
      {
        pathname: "drive/org-1/Marketing/old name.md",
        filename: "2026-11-03 Old name.md",
      },
      expect.any(Buffer),
      "text/markdown",
    );
  });

  it("keeps an ad's pictures on its link, also when only the picture is sent", async () => {
    findMany.mockResolvedValue([
      { entryId: "ad-1", fileResource: { sourceId: "drive/ad.md" } },
    ]);
    const written = await writeMarketingStrategyFiles({
      version,
      drive,
      entries: [
        entry({
          id: "ad-1",
          channel: "meta_ads",
          format: "image_ad",
          imageFileId: "image-1",
        }),
      ],
    });
    expect(written).toBe(1);
    expect(saveFile).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mediaFileIds: ["image-1"] } }),
    );
  });

  it("writes nothing for a skipped piece or one without words", async () => {
    const written = await writeMarketingStrategyFiles({
      version,
      drive,
      entries: [entry({ status: "skipped", draft: "Gone" }), entry({})],
    });
    expect(written).toBe(0);
    expect(saveFile).not.toHaveBeenCalled();
  });
});

describe("reading a written piece", () => {
  it("gives back the words without the title line", async () => {
    findUnique.mockResolvedValue({
      fileResource: { sourceId: "drive/a.md", lifecycle: "ACTIVE" },
    });
    download.mockResolvedValue(
      new TextEncoder().encode(
        marketingPieceMarkdown({ title: "Title", draft: "Line one\n\nTwo" }),
      ),
    );
    await expect(readMarketingPieceText(version, "seo-1")).resolves.toBe(
      "Line one\n\nTwo",
    );
    expect(marketingPieceText("No title here")).toBe("No title here");
  });

  it("is null for a piece with no file, or a deleted one", async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(readMarketingPieceText(version, "seo-1")).resolves.toBeNull();
    findUnique.mockResolvedValueOnce({
      fileResource: { sourceId: "drive/a.md", lifecycle: "TOMBSTONED" },
    });
    await expect(readMarketingPieceText(version, "seo-1")).resolves.toBeNull();
  });
});

describe("withMarketingFiles", () => {
  it("marks written file pieces and leaves social ones to their posts", () => {
    const plan = {
      calendar: [
        entry({}),
        entry({ id: "ad-1", channel: "meta_ads", format: "carousel_ad" }),
        entry({ id: "x-1", channel: "x", format: "post" }),
      ],
    } as never;
    const files = new Map([
      ["seo-1", { fileId: "file-1", media: [] }],
      ["ad-1", { fileId: "file-2", media: ["a", "b"] }],
      ["x-1", { fileId: "file-3", media: [] }],
    ]);
    const calendar = withMarketingFiles(plan, files).calendar;
    expect(calendar[0]).toMatchObject({ fileId: "file-1", status: "draft" });
    expect(calendar[1]).toMatchObject({
      fileId: "file-2",
      imageFileId: "a",
      slideFileIds: ["a", "b"],
    });
    expect(calendar[2]).not.toHaveProperty("fileId");
  });
});
