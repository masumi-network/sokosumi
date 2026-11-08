import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  jobFindMany,
  jobCount,
  postFindUnique,
  fileUpdateMany,
  createImageJob,
  createVideoJob,
  ensureDriveFile,
  updateSocialPost,
  scheduleSocialPost,
  brandPictures,
} = vi.hoisted(() => ({
  jobFindMany: vi.fn(),
  jobCount: vi.fn(),
  postFindUnique: vi.fn(),
  fileUpdateMany: vi.fn(),
  createImageJob: vi.fn(),
  createVideoJob: vi.fn(),
  ensureDriveFile: vi.fn(),
  updateSocialPost: vi.fn(),
  scheduleSocialPost: vi.fn(),
  brandPictures: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageJob: { findMany: jobFindMany, count: jobCount },
    socialPost: { findUnique: postFindUnique },
    marketingStrategyFile: { updateMany: fileUpdateMany },
  },
}));
vi.mock("@/lib/image-studio/catalog", () => ({
  imageModel: () => ({ id: "image-model", outputFormats: ["jpeg", "png"] }),
}));
vi.mock("@/lib/image-studio/fal-catalog-refresh", () => ({
  ensureImageCatalogFresh: vi.fn(),
}));
vi.mock("@/services/image-studio-jobs.service", () => ({
  createImageJob,
  createVideoJob,
  DEFAULT_SETTINGS: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  ensureStudioAssetDriveFile: ensureDriveFile,
}));
vi.mock("@/services/social-posts.service", () => ({
  updateSocialPost,
  scheduleSocialPost,
}));
vi.mock("@/services/cmo-brand-media.service", () => ({
  listCmoBrandPictures: brandPictures,
}));
vi.mock("@/services/cuso-project-files.service", () => ({
  cusoDrive: async () => ({
    workspaceId: "ws-1",
    organizationId: "org-1",
    userId: "runner-1",
    projectId: "project-1",
  }),
}));
vi.mock("@vercel/blob", () => ({
  head: async (pathname: string) => ({ url: `https://blob/${pathname}` }),
}));

import {
  advanceCmoMedia,
  type CmoMediaJob,
  type CmoMediaPiece,
  cmoImagePrompt,
  cmoMediaState,
  cmoPieceSlides,
  cmoSlotAction,
  cmoVisualKey,
} from "./cmo-media-maker.service";

function piece(patch: Partial<CmoMediaPiece> = {}): CmoMediaPiece {
  return {
    id: "post-1",
    channel: "x",
    format: "image",
    status: "draft",
    title: "Book.io's 130,000 NFT books",
    visual: "A reader holding a phone with a Book.io NFT cover",
    socialPostId: "post-1",
    media: [],
    ...patch,
  };
}

function job(patch: Partial<CmoMediaJob>): CmoMediaJob {
  return {
    id: "job-1",
    pieceId: "post-1",
    slot: 0,
    step: "image",
    visualKey: cmoVisualKey(piece()),
    status: "SUCCEEDED",
    assetId: "asset-1",
    prompt: "prompt",
    ...patch,
  };
}

describe("cmoSlotAction", () => {
  it("starts a picture, waits for it, attaches it, and gives up after two failures", () => {
    expect(cmoSlotAction(piece(), [])).toEqual({
      kind: "start",
      step: "image",
      attempt: 1,
      sourceAssetId: null,
    });
    expect(
      cmoSlotAction(piece(), [job({ status: "QUEUED", assetId: null })]),
    ).toEqual({ kind: "wait" });
    expect(cmoSlotAction(piece(), [job({})])).toEqual({
      kind: "attach",
      job: job({}),
    });
    const failed = job({ status: "FAILED", assetId: null });
    expect(cmoSlotAction(piece(), [failed])).toMatchObject({
      kind: "start",
      attempt: 2,
    });
    expect(cmoSlotAction(piece(), [failed, failed])).toEqual({
      kind: "failed",
    });
  });

  it("makes a video by animating a still made first", () => {
    const short = piece({ channel: "youtube", format: "short" });
    expect(cmoSlotAction(short, [])).toMatchObject({
      kind: "start",
      step: "still",
    });
    const still = job({ step: "still", assetId: "still-asset" });
    expect(cmoSlotAction(short, [still])).toEqual({
      kind: "start",
      step: "video",
      attempt: 1,
      sourceAssetId: "still-asset",
    });
    const video = job({ id: "job-2", step: "video", assetId: "video-asset" });
    expect(cmoSlotAction(short, [still, video])).toEqual({
      kind: "attach",
      job: video,
    });
  });
});

describe("cmoMediaState", () => {
  it("asks Cuso for a visual, makes it, and hands back one that failed twice", () => {
    expect(cmoMediaState(piece({ visual: undefined }), [])).toBe("no_visual");
    expect(cmoMediaState(piece(), [])).toBe("making");
    expect(cmoMediaState(piece({ media: ["drive/a.jpg"] }), [])).toBe("made");
    const failed = job({ status: "FAILED", assetId: null });
    expect(cmoMediaState(piece(), [failed, failed])).toBe("failed");
    // A new visual starts over.
    expect(
      cmoMediaState(piece({ visual: "Another moment" }), [failed, failed]),
    ).toBe("making");
    expect(cmoMediaState(piece({ format: "post" }), [])).toBe("made");
  });
});

describe("cmoImagePrompt", () => {
  it("names the slide and keeps what the brand pictures show", () => {
    const prompt = cmoImagePrompt({
      piece: piece({ channel: "instagram", format: "carousel" }),
      slot: 1,
      businessName: "NMKR",
      references: 2,
    });
    expect(prompt).toContain("Slide 2 of 3 of one Instagram carousel");
    expect(prompt).toContain("keep what they show of the brand");
    expect(prompt).toContain("Never a real, named person.");
  });

  it("makes as many slides as Cuso described, each from its own line", () => {
    const slides = [
      "The hook",
      "Step 1: upload",
      "Step 2: price",
      "Step 3: mint",
    ];
    const carousel = piece({
      channel: "instagram",
      format: "carousel",
      slides,
    });
    expect(cmoPieceSlides(carousel)).toBe(4);
    expect(cmoPieceSlides({ ...carousel, slides: undefined })).toBe(3);
    expect(
      cmoImagePrompt({
        piece: carousel,
        slot: 2,
        businessName: "NMKR",
        references: 0,
      }),
    ).toContain("Slide 3 of 4 of one Instagram carousel");
    expect(
      cmoImagePrompt({
        piece: carousel,
        slot: 2,
        businessName: "NMKR",
        references: 0,
      }),
    ).toContain("This slide: Step 2: price");
    expect(cmoVisualKey(carousel)).not.toBe(
      cmoVisualKey({ ...carousel, slides: undefined }),
    );
  });
});

describe("advanceCmoMedia", () => {
  const context = {
    cuso: {
      projectId: "project-1",
      workspaceId: "ws-1",
      sokoBotId: "bot-1",
      businessName: "NMKR",
    },
    versionId: "version-1",
    connected: new Set(["x"]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    jobCount.mockResolvedValue(1);
    brandPictures.mockResolvedValue([
      { fileId: "f-home", alt: "Home page screenshot" },
      { fileId: "f-photo", alt: "studio dashboard" },
    ]);
    createImageJob.mockResolvedValue({ id: "new" });
    scheduleSocialPost.mockResolvedValue({});
  });

  it("starts each piece's picture once, within the studio's limit, from the brand's pictures", async () => {
    jobFindMany.mockResolvedValue([]);
    await advanceCmoMedia(context, [
      piece({ id: "a", socialPostId: "a" }),
      piece({ id: "b", socialPostId: "b", visualFileIds: ["f-photo"] }),
      piece({ id: "c", socialPostId: "c" }),
      piece({ id: "d", socialPostId: "d", visual: undefined }),
    ]);
    // One job already runs in the Project: two more fit.
    expect(createImageJob).toHaveBeenCalledTimes(2);
    expect(createImageJob.mock.calls[0]?.[0]).toMatchObject({
      userId: "runner-1",
      referenceFileIds: ["f-photo", "f-home"],
      settings: { aspectRatio: "16:9", outputFormat: "jpeg" },
      idempotencyKey: expect.stringMatching(
        /^cmo-media:version-1:a:0:image:[0-9a-f]{10}:1$/,
      ),
    });
    expect(createImageJob.mock.calls[1]?.[0]).toMatchObject({
      referenceFileIds: ["f-photo"],
    });
  });

  it("keeps attaching finished pictures after the studio refuses a start", async () => {
    const { HTTPException } = await import("hono/http-exception");
    createImageJob.mockRejectedValue(
      new HTTPException(429, {
        message: "You can start at most 40 image generations per hour.",
      }),
    );
    jobFindMany.mockResolvedValue([
      {
        id: "job-b",
        idempotencyKey: `cmo-media:version-1:b:0:image:${cmoVisualKey(piece())}:1`,
        status: "SUCCEEDED",
        prompt: "prompt",
        asset: { id: "asset-b" },
      },
    ]);
    ensureDriveFile.mockResolvedValue({
      id: "file-b",
      name: "b.jpg",
      pathname: "drive/b.jpg",
      mimeType: "image/jpeg",
      size: 10,
    });
    postFindUnique.mockResolvedValue({
      id: "b",
      provider: "x",
      text: "Written words.",
      media: [],
      revision: 1,
      status: "DRAFT",
      scheduledAt: null,
      planning: {},
    });
    updateSocialPost.mockResolvedValue({ media: [{}], revision: 2 });
    await advanceCmoMedia(context, [
      piece({ id: "a", socialPostId: "a" }),
      piece({ id: "b", socialPostId: "b" }),
    ]);
    expect(createImageJob).toHaveBeenCalledTimes(1);
    expect(updateSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId: "b" }),
    );
  });

  it("puts slides on in order and hands back a carousel whose cover failed twice", async () => {
    const carousel = piece({
      channel: "instagram",
      format: "carousel",
      slides: ["Cover", "Step one", "Step two"],
    });
    const key = cmoVisualKey(carousel);
    const row = (slot: number, attempt: number, status: string) => ({
      id: `job-${slot}-${attempt}`,
      idempotencyKey: `cmo-media:version-1:post-1:${slot}:image:${key}:${attempt}`,
      status,
      prompt: "prompt",
      asset: status === "SUCCEEDED" ? { id: `asset-${slot}` } : null,
    });
    jobFindMany.mockResolvedValue([
      row(0, 1, "FAILED"),
      row(1, 1, "SUCCEEDED"),
      row(2, 1, "SUCCEEDED"),
      row(0, 2, "FAILED"),
    ]);
    await advanceCmoMedia(context, [carousel]);
    // Slides 2 and 3 wait for the cover; nothing goes on out of order.
    expect(updateSocialPost).not.toHaveBeenCalled();
    expect(
      cmoMediaState(carousel, [
        job({ visualKey: key, status: "FAILED", assetId: null }),
        job({ visualKey: key, status: "FAILED", assetId: null }),
        job({ visualKey: key, slot: 1 }),
        job({ visualKey: key, slot: 2 }),
      ]),
    ).toBe("failed");
  });

  it("puts a finished picture on its post and schedules it on a connected network", async () => {
    jobFindMany.mockResolvedValue([
      {
        id: "job-1",
        idempotencyKey: `cmo-media:version-1:post-1:0:image:${cmoVisualKey(piece())}:1`,
        status: "SUCCEEDED",
        prompt: "prompt",
        asset: { id: "asset-1" },
      },
    ]);
    ensureDriveFile.mockResolvedValue({
      id: "file-1",
      name: "reader.jpg",
      pathname: "drive/reader.jpg",
      mimeType: "image/jpeg",
      size: 10,
    });
    const at = new Date(Date.now() + 86_400_000);
    postFindUnique.mockResolvedValue({
      id: "post-1",
      provider: "x",
      text: "Book.io sold 130,000 NFT books with Studio.",
      media: [],
      revision: 3,
      status: "DRAFT",
      scheduledAt: at,
      planning: { title: "Book.io's 130,000 NFT books" },
    });
    updateSocialPost.mockResolvedValue({
      media: [{ pathname: "drive/reader.jpg" }],
      revision: 4,
    });
    await advanceCmoMedia(context, [piece()]);
    expect(updateSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: "post-1",
        revision: 3,
        media: [
          expect.objectContaining({
            pathname: "drive/reader.jpg",
            kind: "image",
          }),
        ],
      }),
    );
    expect(scheduleSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 4, scheduledAt: at }),
    );
    expect(createImageJob).not.toHaveBeenCalled();
  });
});
