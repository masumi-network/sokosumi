import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  jobs: { findMany: vi.fn(), findFirst: vi.fn() },
  posts: { findMany: vi.fn() },
  picks: { findMany: vi.fn() },
  readAssetBytes: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageJob: m.jobs,
    socialPost: m.posts,
    cmoPicturePick: m.picks,
  },
}));
vi.mock("@/services/cmo-cuso.service", async (original) => ({
  ...(await original<typeof import("@/services/cmo-cuso.service")>()),
  requireCuso: async () => ({ projectId: "project-1", sokoBotId: "bot-1" }),
}));
vi.mock("@/services/cmo-media-maker.service", () => ({
  CMO_STYLE_PASSED: "Style passed",
  CMO_STYLE_REJECTED: "Style check: ",
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: m.readAssetBytes,
}));

import {
  cmoPlainPictureReasons,
  listCmoPictures,
  readCmoPicturePreview,
} from "./cmo-pictures.service";

const key = (piece: string, attempt: string) =>
  `cmo-media:version-1:${piece}:0:image:abc1234567:${attempt}`;
const job = (id: string, piece: string, attempt: string, patch = {}) => ({
  id,
  idempotencyKey: key(piece, attempt),
  model: "meta/muse-image/edit",
  status: "SUCCEEDED",
  error: null,
  createdAt: new Date("2026-11-21T10:00:00Z"),
  asset: { id: `asset-${id}` },
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.jobs.findMany.mockResolvedValue([
    job("a1", "post-1", "p1", { error: "Style check: Extra words" }),
    job("a2", "post-1", "p2", { error: "Style passed: logo drawn" }),
    job("a3", "post-1", "p3", { error: "Style passed: logo drawn" }),
    job("a4", "post-1", "p4", {
      model: "microsoft/mai-image-2.7/edit",
      status: "FAILED",
      error: "The image provider could not finish this image.",
      asset: null,
    }),
    job("b1", "post-2", "1", { error: "Style passed" }),
    job("c1", "post-3", "p1", { error: "Style check: Logo misdrawn" }),
  ]);
  m.posts.findMany.mockResolvedValue([
    {
      id: "post-1",
      provider: "instagram",
      scheduledAt: new Date("2026-12-02T09:00:00Z"),
      planning: {
        id: "e1",
        title: "Mint now",
        format: "image",
        headline: "Mint now",
        pictureKind: "bold graphic",
      },
      media: [
        {
          pathname: "drive/a.jpg",
          fileUrl: "https://blob/a.jpg",
          name: "a.jpg",
          size: 1,
          mimeType: "image/jpeg",
          kind: "image",
        },
      ],
    },
    {
      id: "post-2",
      provider: "x",
      scheduledAt: new Date("2026-11-28T09:00:00Z"),
      planning: { id: "e2", title: "Old", format: "image" },
      media: [
        {
          pathname: "drive/b.jpg",
          fileUrl: "https://blob/b.jpg",
          name: "b.jpg",
          size: 1,
          mimeType: "image/jpeg",
          kind: "image",
        },
      ],
    },
    {
      id: "post-3",
      provider: "x",
      scheduledAt: new Date("2026-12-05T09:00:00Z"),
      planning: { id: "e3", title: "Pending", format: "image" },
      media: [],
    },
  ]);
  m.picks.findMany.mockResolvedValue([
    {
      marketingStrategyId: "version-1",
      pieceId: "post-1",
      slot: 0,
      visualKey: "abc1234567",
      chosenJobId: "a3",
      reason: "Clearest headline",
    },
  ]);
});

describe("listCmoPictures", () => {
  it("groups by post, marks the chosen one, and keeps every alternative with its verdict", async () => {
    const { groups, networks, months } = await listCmoPictures({
      userId: "u",
      projectId: "project-1",
    });
    expect(networks).toEqual(["instagram", "x"]);
    expect(months).toEqual(["2026-11", "2026-12"]);
    expect(groups.map((group) => group.postId)).toEqual([
      "post-3",
      "post-1",
      "post-2",
    ]);
    const first = groups[1]!;
    expect(first).toMatchObject({
      network: "instagram",
      headline: "Mint now",
      pictureKind: "bold graphic",
      postedUrl: "https://blob/a.jpg",
      reason: "Clearest headline",
    });
    expect(
      first.alternatives.map(({ jobId, verdict, chosen, model }) => ({
        jobId,
        verdict,
        chosen,
        model,
      })),
    ).toEqual([
      { jobId: "a1", verdict: "rejected", chosen: false, model: "Muse Image" },
      { jobId: "a2", verdict: "passed", chosen: false, model: "Muse Image" },
      { jobId: "a3", verdict: "passed", chosen: true, model: "Muse Image" },
      { jobId: "a4", verdict: "failed", chosen: false, model: "MAI-Image 2.7" },
    ]);
    expect(first.alternatives[0]?.why).toBe("Extra words or marks.");
    // Before cmo-v11, the one try that passed is the chosen one.
    expect(groups[2]?.alternatives[0]?.chosen).toBe(true);
  });

  it("counts an older try that left no verdict as on the post, but not an unchecked alternative", async () => {
    m.jobs.findMany.mockResolvedValue([
      job("b0", "post-2", "1", { error: "Style check: Extra words" }),
      job("b1", "post-2", "2"),
      job("c1", "post-3", "p1"),
    ]);
    m.picks.findMany.mockResolvedValue([]);
    const { groups } = await listCmoPictures({
      userId: "u",
      projectId: "project-1",
    });
    const older = groups.find((group) => group.postId === "post-2")!;
    expect(older.postedUrl).toBe("https://blob/b.jpg");
    expect(
      older.alternatives.map(({ jobId, verdict, chosen }) => ({
        jobId,
        verdict,
        chosen,
      })),
    ).toEqual([
      { jobId: "b0", verdict: "rejected", chosen: false },
      { jobId: "b1", verdict: "passed", chosen: true },
    ]);
    const unchecked = groups.find((group) => group.postId === "post-3")!;
    expect(unchecked.alternatives[0]).toMatchObject({
      verdict: "waiting",
      chosen: false,
    });
  });

  it("filters by network, month and chosen", async () => {
    expect(
      (
        await listCmoPictures({
          userId: "u",
          projectId: "project-1",
          network: "x",
        })
      ).groups.map((g) => g.postId),
    ).toEqual(["post-3", "post-2"]);
    expect(
      (
        await listCmoPictures({
          userId: "u",
          projectId: "project-1",
          month: "2026-11",
        })
      ).groups.map((g) => g.postId),
    ).toEqual(["post-2"]);
    expect(
      (
        await listCmoPictures({
          userId: "u",
          projectId: "project-1",
          chosenOnly: true,
        })
      ).groups.map((g) => g.postId),
    ).toEqual(["post-1", "post-2"]);
  });
});

describe("readCmoPicturePreview", () => {
  it("serves a month picture of this Project only, as a small JPEG", async () => {
    m.jobs.findFirst.mockResolvedValue({
      asset: { blobPathname: "studio/a.png" },
    });
    m.readAssetBytes.mockResolvedValue(
      await sharp({
        create: { width: 1600, height: 2000, channels: 3, background: "#fff" },
      })
        .png()
        .toBuffer(),
    );
    const preview = await readCmoPicturePreview({
      userId: "u",
      projectId: "project-1",
      jobId: "a1",
    });
    const meta = await sharp(preview).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.height).toBe(720);
    expect(m.jobs.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "a1",
          projectId: "project-1",
          idempotencyKey: { startsWith: "cmo-media:" },
        },
      }),
    );
    m.jobs.findFirst.mockResolvedValue(null);
    await expect(
      readCmoPicturePreview({
        userId: "u",
        projectId: "project-1",
        jobId: "zz",
      }),
    ).rejects.toThrow("No such picture");
  });
});

describe("cmoPlainPictureReasons", () => {
  it("says the check's reasons as the owner reads them, without codes", () => {
    // entry.fyi, 2026-11-24: one alternative's reasons as the check wrote them.
    expect(
      cmoPlainPictureReasons(
        "Bright lime/yellow-green is a strong non-brand colour; the brand red #b8321f is absent; Logo reads 'entry.fyi' instead of the supplied 'entry' wordmark; No corner is plain enough for a logo",
      ),
    ).toBe(
      "Colours that aren't the brand's, the logo drawn wrong and no room for the logo.",
    );
  });

  it("falls back to one plain line", () => {
    expect(cmoPlainPictureReasons("")).toBe("It didn't pass the brand check.");
  });
});
