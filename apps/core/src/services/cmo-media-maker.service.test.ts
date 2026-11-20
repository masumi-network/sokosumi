import { Hono } from "hono";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  jobFindMany,
  jobCount,
  postFindUnique,
  postUpdateMany,
  fileUpdateMany,
  createImageJob,
  createVideoJob,
  createTalkingVideoJob,
  ensureDriveFile,
  updateSocialPost,
  scheduleSocialPost,
  brandPictures,
} = vi.hoisted(() => ({
  jobFindMany: vi.fn(),
  jobCount: vi.fn(),
  postFindUnique: vi.fn(),
  postUpdateMany: vi.fn(),
  fileUpdateMany: vi.fn(),
  createImageJob: vi.fn(),
  createVideoJob: vi.fn(),
  createTalkingVideoJob: vi.fn(),
  ensureDriveFile: vi.fn(),
  updateSocialPost: vi.fn(),
  scheduleSocialPost: vi.fn(),
  brandPictures: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findUnique: async () => null },
    projectImageJob: { findMany: jobFindMany, count: jobCount },
    socialPost: { findUnique: postFindUnique, updateMany: postUpdateMany },
    marketingStrategyFile: { updateMany: fileUpdateMany },
  },
}));
vi.mock("@/lib/image-studio/catalog", () => ({
  imageModel: (id?: string) => ({
    id: id ?? "image-model",
    outputFormats: ["jpeg", "png"],
  }),
}));
vi.mock("@/lib/image-studio/fal-catalog-refresh", () => ({
  ensureImageCatalogFresh: vi.fn(),
}));
vi.mock("@/services/image-studio-jobs.service", () => ({
  createImageJob,
  createVideoJob,
  createTalkingVideoJob,
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
vi.mock("@/services/cmo-presenter.service", () => ({
  talkingVideoPresenter: async () => ({ kind: "stock", id: "maya" }),
}));
vi.mock("@/services/cmo-brand-media.service", () => ({
  listCmoBrandPictures: brandPictures,
  readCmoBrandLogo: async () => ({ logo: null, dark: null }),
}));
vi.mock("@/services/cuso-project-files.service", () => ({
  cusoDrive: async () => ({
    workspaceId: "ws-1",
    organizationId: "org-1",
    userId: "runner-1",
    projectId: "project-1",
  }),
}));
vi.mock("@/services/reference-library.service", () => ({
  referenceLibraryAvailable: () => true,
  readReferenceImage: vi.fn(),
}));
vi.mock("@/services/cmo-brand-visual.service", () => ({
  cmoBrandVisual: async () => null,
}));
vi.mock("@vercel/blob", () => ({
  head: async (pathname: string) => ({ url: `https://blob/${pathname}` }),
}));

import { coreEvlogMiddleware } from "@/lib/evlog";
import {
  coreLogEvents,
  expectCoreLog,
  expectCoreLogWhys,
} from "@/test/core-log";
import {
  advanceCmoMedia,
  type CmoMediaJob,
  type CmoMediaPiece,
  cmoAllowedKinds,
  cmoImagePrompt,
  cmoInfographicCap,
  cmoKeepsPicturesVaried,
  cmoMediaState,
  cmoPictureOutdated,
  cmoPictureStyleProblem,
  cmoPieceSlides,
  cmoSlotAction,
  cmoStyleHeadline,
  cmoStylePrompt,
  cmoVisualKey,
  logoForPicture,
  REFERENCE_STYLE_MODELS,
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
    rejected: false,
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

describe("a talking video piece", () => {
  const talking = (patch: Partial<CmoMediaPiece> = {}) =>
    piece({
      channel: "instagram",
      format: "talking_video",
      visual: undefined,
      script:
        "Stop emailing back and forth. Send one booking link and let people pick a time. Try it on your next call.",
      presenter: "maya",
      voice: "Sarah",
      ...patch,
    });

  it("is made in one talking step from its script, not from a visual", () => {
    expect(cmoSlotAction(talking(), [])).toEqual({
      kind: "start",
      step: "talking",
      attempt: 1,
      sourceAssetId: null,
    });
    const made = job({ step: "talking", assetId: "video-asset" });
    expect(cmoSlotAction(talking(), [made])).toEqual({
      kind: "attach",
      job: made,
    });
  });

  it("waits for a script before anything is made", () => {
    expect(cmoMediaState(talking({ script: undefined }), [])).toBe("no_visual");
    expect(cmoMediaState(talking(), [])).toBe("making");
  });

  it("starts over when its script or presenter changes", () => {
    const before = cmoVisualKey(talking());
    expect(cmoVisualKey(talking({ presenter: "jonas" }))).not.toBe(before);
    expect(
      cmoVisualKey(talking({ script: `${talking().script} Now.` })),
    ).not.toBe(before);
  });
});

describe("a picture in a reference library style", () => {
  const styled = (patch: Partial<CmoMediaPiece> = {}) =>
    piece({
      styleReferenceId: "01a1e700-0000-7000-8000-000000000001",
      headline: "Fresh minted",
      ...patch,
    });

  it("keeps the key of a piece without a style, and changes it with one", () => {
    expect(cmoVisualKey(piece())).toBe(cmoVisualKey(piece({ headline: "x" })));
    expect(cmoVisualKey(styled())).not.toBe(cmoVisualKey(piece()));
    expect(cmoVisualKey(styled())).not.toBe(
      cmoVisualKey(styled({ headline: "Other words" })),
    );
  });

  it("borrows only the style, letters the headline, uses the brand colours and leaves the logo corner", () => {
    const prompt = cmoStylePrompt({
      piece: styled(),
      slot: 0,
      businessName: "NMKR",
      colours: ["#11F250", "#021205"],
    });
    expect(prompt).toContain("ONLY as a style reference");
    expect(prompt).toContain("Copy none of its words");
    expect(prompt).toContain('"Fresh minted"');
    expect(prompt).toContain("#11F250, #021205");
    // The logo once covered the end of a headline set along the bottom.
    expect(prompt).toContain(
      "Keep the lower-right corner plain and every word clear of it",
    );
    // Infographic references lettered every step: 33 of 56 production tries
    // were turned down for words besides the headline.
    expect(prompt).toContain(
      "Show any steps, stages or panels with pictures alone: no numbers, step labels",
    );
    expect(
      cmoStylePrompt({
        piece: styled({ headline: undefined }),
        slot: 0,
        businessName: "NMKR",
        colours: [],
      }),
    ).toContain("No words, letters or numbers");
  });

  it("sets the brand's own picture inside the style, and letters each slide with its own words", () => {
    const withSite = cmoStylePrompt({
      piece: styled(),
      slot: 0,
      businessName: "NMKR",
      colours: [],
      brandPictures: 1,
    });
    expect(withSite).toContain("The second image is NMKR's own picture");
    expect(withSite).toContain("Invent no price, number, plan");
    expect(withSite).toContain(
      "Besides what stands in the brand's own picture",
    );
    const carousel = styled({
      channel: "linkedin",
      format: "images",
      slides: ["A draft board", "An approval gate"],
      slideHeadlines: ["Review the drafts", "Then it goes live"],
    });
    const second = cmoStylePrompt({
      piece: carousel,
      slot: 1,
      businessName: "NMKR",
      colours: [],
    });
    // Naming the slide made Muse Image letter "SLIDE 2 OF 2" into it.
    expect(second).not.toMatch(/slide \d of \d/i);
    expect(second).toContain("Draw no slide number");
    expect(second).toContain('"Then it goes live"');
    expect(second).not.toContain("Fresh minted");
    expect(cmoStyleHeadline(carousel, 0)).toBe("Review the drafts");
    expect(cmoVisualKey(carousel)).not.toBe(
      cmoVisualKey({ ...carousel, slideHeadlines: ["Other", "Words"] }),
    );
  });

  it("asks for a style on every picture and slide, once per reference", () => {
    const one = { ...styled({ id: "a" }), visual: "A desk" };
    expect(cmoPictureStyleProblem([one], [])).toBeNull();
    expect(
      cmoPictureStyleProblem([{ ...one, styleReferenceId: undefined }], []),
    ).toContain("a has a picture and no style");
    // Text, a video and a piece whose visual is not written yet need none.
    expect(
      cmoPictureStyleProblem(
        [
          piece({ id: "t", format: "post", styleReferenceId: undefined }),
          piece({ id: "v", format: "video", styleReferenceId: undefined }),
          piece({ id: "n", visual: undefined }),
        ],
        [],
      ),
    ).toBeNull();
    expect(
      cmoPictureStyleProblem(
        [one],
        [{ id: "b", styleReferenceId: one.styleReferenceId }],
      ),
    ).toContain("a and b use the same style reference");
    expect(
      cmoPictureStyleProblem(
        [
          {
            ...one,
            channel: "linkedin",
            format: "images",
            slides: ["One", "Two"],
            slideHeadlines: ["Only one"],
          },
        ],
        [],
      ),
    ).toContain("needs slideHeadlines, one entry per slide (2)");
  });

  it("tries each style model once, and a picture the check turned down counts as a try", () => {
    const tried = (count: number, patch: Partial<CmoMediaJob> = {}) =>
      Array.from({ length: count }, (_, at) =>
        job({ id: `job-${at}`, rejected: true, ...patch }),
      );
    expect(cmoSlotAction(styled(), tried(1))).toMatchObject({
      kind: "start",
      attempt: 2,
    });
    expect(cmoSlotAction(styled(), [job({ rejected: false })])).toMatchObject({
      kind: "attach",
    });
    expect(
      cmoSlotAction(styled(), tried(REFERENCE_STYLE_MODELS.length)),
    ).toEqual({ kind: "failed" });
    // A picture without a style still gets two tries.
    expect(
      cmoSlotAction(piece(), [
        job({ status: "FAILED" }),
        job({ id: "job-2", status: "FAILED" }),
      ]),
    ).toEqual({ kind: "failed" });
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

  describe("a styled picture whose headline changed after it went on", () => {
    const made = (headline: string) =>
      piece({
        styleReferenceId: "01a1e700-0000-7000-8000-000000000001",
        headline,
        status: "scheduled",
        media: ["drive/old.jpg"],
      });
    const oldJob = job({
      visualKey: cmoVisualKey(made("A good token answers")),
    });

    it("is outdated, and stops being so once its new picture is under way", () => {
      const now = made("What does the token grant?");
      expect(cmoPictureOutdated(now, [oldJob])).toBe(true);
      expect(cmoPictureOutdated(made("A good token answers"), [oldJob])).toBe(
        false,
      );
      expect(
        cmoPictureOutdated(now, [
          oldJob,
          job({ id: "job-2", status: "RUNNING", visualKey: cmoVisualKey(now) }),
        ]),
      ).toBe(false);
      // A picture the owner put on, with no job of Core's, stays.
      expect(cmoPictureOutdated(now, [])).toBe(false);
    });

    it("comes off its post, which goes back to a draft at its time, and is made again", async () => {
      jobFindMany.mockResolvedValue([
        {
          id: "job-1",
          idempotencyKey: `cmo-media:version-1:post-1:0:image:${oldJob.visualKey}:1`,
          status: "SUCCEEDED",
          prompt: "prompt",
          error: null,
          asset: { id: "asset-1" },
        },
      ]);
      postUpdateMany.mockResolvedValue({ count: 1 });
      jobCount.mockResolvedValue(0);
      const now = made("What does the token grant?");
      await advanceCmoMedia(context, [now]);
      expect(postUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "post-1" }),
          data: expect.objectContaining({ media: [], status: "DRAFT" }),
        }),
      );
      expect(postUpdateMany.mock.calls[0]?.[0].data).not.toHaveProperty(
        "scheduledAt",
      );
      expect(createImageJob).toHaveBeenCalledTimes(1);
      expect(createImageJob.mock.calls[0]?.[0]).toMatchObject({
        idempotencyKey: `cmo-media:version-1:post-1:0:image:${cmoVisualKey(now)}:1`,
      });
      expect(createImageJob.mock.calls[0]?.[0].prompt).toContain(
        '"What does the token grant?"',
      );
    });
  });

  it("starts each piece's picture once, within the month's limit, from the brand's pictures", async () => {
    jobFindMany.mockResolvedValue([]);
    jobCount.mockResolvedValue(4);
    await advanceCmoMedia(context, [
      piece({ id: "a", socialPostId: "a" }),
      piece({ id: "b", socialPostId: "b", visualFileIds: ["f-photo"] }),
      piece({ id: "c", socialPostId: "c" }),
      piece({ id: "d", socialPostId: "d", visual: undefined }),
    ]);
    // Four jobs already run in the Project: two more fit of the month's six.
    expect(createImageJob).toHaveBeenCalledTimes(2);
    expect(createImageJob.mock.calls[0]?.[0]).toMatchObject({
      userId: "runner-1",
      forCmoMonth: true,
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

  it("starts each piece without named pictures at another of the brand's own", async () => {
    jobFindMany.mockResolvedValue([]);
    jobCount.mockResolvedValue(0);
    brandPictures.mockResolvedValue([
      { fileId: "f-home", alt: "Home page screenshot" },
      { fileId: "f-pricing", alt: "Pricing cards, Home page: plans" },
      { fileId: "f-quotes", alt: "Testimonials, Home page: what they say" },
      { fileId: "f-photo", alt: "studio dashboard" },
    ]);
    await advanceCmoMedia(context, [
      piece({ id: "a", socialPostId: "a" }),
      piece({ id: "b", socialPostId: "b" }),
      piece({ id: "c", socialPostId: "c" }),
    ]);
    const used = createImageJob.mock.calls.map(([job]) => job.referenceFileIds);
    expect(used).toEqual([
      ["f-quotes", "f-home"],
      ["f-photo", "f-home"],
      ["f-pricing", "f-home"],
    ]);
  });

  it("makes a styled picture on Muse Image twice before the dearer models", async () => {
    const styled = piece({
      styleReferenceId: "01a1eb53-3608-720e-8fa1-84dcd2eb5ec9",
      headline: "Mint in minutes",
    });
    const models: string[] = [];
    for (let tried = 0; tried < REFERENCE_STYLE_MODELS.length; tried += 1) {
      createImageJob.mockClear();
      jobFindMany.mockResolvedValue(
        Array.from({ length: tried }, (_, at) => ({
          id: `job-${at}`,
          idempotencyKey: `cmo-media:version-1:post-1:0:image:${cmoVisualKey(styled)}:${at + 1}`,
          status: "SUCCEEDED",
          prompt: "prompt",
          error: "Style check: extra words",
          asset: { id: `asset-${at}` },
        })),
      );
      await advanceCmoMedia(context, [styled]);
      models.push(createImageJob.mock.calls[0]?.[0].modelId);
    }
    expect(models).toEqual([
      "muse-image",
      "muse-image",
      "gpt-image-2-6",
      "nano-banana-2-1",
    ]);
  });

  it("gives a styled picture only the brand pictures its visual names", async () => {
    jobFindMany.mockResolvedValue([]);
    jobCount.mockResolvedValue(0);
    const style = "01a1eb53-3608-720e-8fa1-84dcd2eb5ec9";
    await advanceCmoMedia(context, [
      piece({ id: "a", socialPostId: "a", styleReferenceId: style }),
      piece({
        id: "b",
        socialPostId: "b",
        styleReferenceId: "01a1eb55-a767-7259-af74-b1d86f203752",
        visualFileIds: ["f-home", "f-unknown"],
      }),
    ]);
    expect(createImageJob.mock.calls[0]?.[0]).toMatchObject({
      referenceLibraryIds: [style],
      referenceFileIds: [],
    });
    expect(createImageJob.mock.calls[0]?.[0].prompt).not.toContain(
      "own picture",
    );
    expect(createImageJob.mock.calls[1]?.[0]).toMatchObject({
      referenceFileIds: ["f-home"],
    });
    expect(createImageJob.mock.calls[1]?.[0].prompt).toContain(
      "The second image is NMKR's own picture",
    );
  });

  it("keeps attaching finished pictures after the studio refuses a start", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "The image studio refused to start a CMO picture",
      ["Image studio refused the generation"],
    );
    const { HTTPException } = await import("hono/http-exception");
    createImageJob.mockRejectedValue(
      new HTTPException(429, {
        message: "Refused: SENTINEL-PROMPT a sunlit bookshop",
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
    expect(warnings[0]?.event).toMatchObject({
      operation: "cmo_media",
      cmoPieces: [{ id: "a", failure: { errorName: "Error", status: 429 } }],
    });
    // The refusal can quote the prompt; none of it reaches the drain.
    expect(JSON.stringify(coreLogEvents())).not.toContain("SENTINEL-PROMPT");
  });

  it("puts a finished picture on a post Cuso already scheduled, keeping its time", async () => {
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
      revision: 3,
      status: "SCHEDULED",
      scheduledAt: new Date(Date.now() + 86_400_000),
      planning: {},
    });
    updateSocialPost.mockResolvedValue({ media: [{}], revision: 4 });
    await advanceCmoMedia(context, [
      piece({ id: "b", socialPostId: "b", status: "scheduled" }),
    ]);
    expect(updateSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId: "b", revision: 3 }),
    );
    expect(updateSocialPost.mock.calls[0]?.[0]).not.toHaveProperty(
      "scheduledAt",
    );
    expect(scheduleSocialPost).not.toHaveBeenCalled();
  });

  it("logs a refused schedule without the post's text", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Could not schedule a CMO Social post",
      ["Social publishing refused the schedule"],
    );
    const { HTTPException } = await import("hono/http-exception");
    scheduleSocialPost.mockRejectedValue(
      new HTTPException(409, { message: "Refused: SENTINEL-POST words" }),
    );
    postFindUnique.mockResolvedValue({
      id: "post-1",
      provider: "x",
      text: "Rewritten words after the picture.",
      revision: 10,
      status: "DRAFT",
      scheduledAt: new Date(Date.now() + 86_400_000),
      planning: {},
    });
    await advanceCmoMedia(context, [piece({ media: ["file-1"] })]);
    expect(warnings[0]?.event).toMatchObject({
      socialPosts: [
        { id: "post-1", failure: { errorName: "Error", status: 409 } },
      ],
    });
    expect(JSON.stringify(coreLogEvents())).not.toContain("SENTINEL-POST");
  });

  it("keeps each refused schedule with its own post on one request", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not schedule a CMO Social post",
      2,
    );
    const { HTTPException } = await import("hono/http-exception");
    scheduleSocialPost
      .mockRejectedValueOnce(new HTTPException(409, { message: "Refused" }))
      .mockRejectedValueOnce(new HTTPException(423, { message: "Refused" }));
    postFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({
        id: where.id,
        provider: "x",
        text: "Rewritten words after the picture.",
        revision: 10,
        status: "DRAFT",
        scheduledAt: new Date(Date.now() + 86_400_000),
        planning: {},
      }),
    );
    const app = new Hono();
    app.use(coreEvlogMiddleware());
    app.post("/cmo/month", async (c) => {
      await advanceCmoMedia(context, [
        piece({ id: "a", socialPostId: "post-a", media: ["file-1"] }),
        piece({ id: "b", socialPostId: "post-b", media: ["file-1"] }),
      ]);
      return c.json({ ok: true });
    });

    await app.request("http://localhost/cmo/month", { method: "POST" });

    expect(warnings[1]?.event.socialPosts).toEqual([
      { id: "post-a", failure: { errorName: "Error", status: 409 } },
      { id: "post-b", failure: { errorName: "Error", status: 423 } },
    ]);
  });

  it("schedules a post that went back to a draft after its picture went on", async () => {
    const at = new Date(Date.now() + 86_400_000);
    postFindUnique.mockResolvedValue({
      id: "post-1",
      provider: "x",
      text: "Rewritten words after the picture.",
      revision: 10,
      status: "DRAFT",
      scheduledAt: at,
      planning: { title: "Book.io's 130,000 NFT books" },
    });
    await advanceCmoMedia(context, [piece({ media: ["file-1"] })]);
    expect(scheduleSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: "post-1",
        revision: 10,
        scheduledAt: at,
      }),
    );
    expect(createImageJob).not.toHaveBeenCalled();
  });

  it("schedules a finished words-only post only where Core schedules every post (cmo-v6)", async () => {
    const at = new Date(Date.now() + 86_400_000);
    postFindUnique.mockResolvedValue({
      id: "post-1",
      provider: "x",
      text: "Words that need no picture.",
      revision: 4,
      status: "DRAFT",
      scheduledAt: at,
      planning: { title: "A words-only post" },
    });
    const words = piece({ format: "post", visual: undefined });
    await advanceCmoMedia(context, [words]);
    expect(scheduleSocialPost).not.toHaveBeenCalled();
    await advanceCmoMedia({ ...context, schedulesEveryPost: true }, [words]);
    expect(scheduleSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId: "post-1", revision: 4 }),
    );
    expect(createImageJob).not.toHaveBeenCalled();
  });

  it("hands a finished TikTok video to the owner instead of scheduling it", async () => {
    postFindUnique.mockResolvedValue({
      id: "post-1",
      provider: "tiktok",
      text: "Three things nobody tells you about minting.",
      revision: 4,
      status: "DRAFT",
      scheduledAt: new Date(Date.now() + 86_400_000),
      planning: { title: "Minting myths" },
    });
    await advanceCmoMedia(
      { ...context, connected: new Set([...context.connected, "tiktok"]) },
      [piece({ channel: "tiktok", format: "video", media: ["file-1"] })],
    );
    expect(scheduleSocialPost).not.toHaveBeenCalled();
    expect(postUpdateMany).toHaveBeenCalledWith({
      where: { id: "post-1", status: "DRAFT", revision: 4 },
      data: { status: "NEEDS_APPROVAL", revision: { increment: 1 } },
    });
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

  describe("a talking video on several networks", () => {
    const script =
      "Stop emailing back and forth. Send one booking link and let people pick a time. Try it on your next call.";
    const reel = piece({
      id: "reel",
      socialPostId: "reel",
      channel: "instagram",
      format: "talking_video",
      visual: undefined,
      script,
      presenter: "maya",
      voice: "Sarah",
    });
    const short = {
      ...reel,
      id: "short",
      socialPostId: "short",
      channel: "youtube",
    };
    const key = cmoVisualKey(reel);

    it("is made once for all its posts", async () => {
      jobFindMany.mockResolvedValue([]);
      await advanceCmoMedia(context, [reel, short]);
      expect(createTalkingVideoJob).toHaveBeenCalledTimes(1);
      expect(createTalkingVideoJob.mock.calls[0]?.[0]).toMatchObject({
        script,
        music: true,
        broll: true,
        idempotencyKey: `cmo-media:version-1:video:0:talking:${key}:1`,
      });
    });

    it("waits on every post while the one job runs", async () => {
      jobFindMany.mockResolvedValue([
        {
          id: "job-1",
          idempotencyKey: `cmo-media:version-1:video:0:talking:${key}:1`,
          status: "RUNNING",
          prompt: script,
          asset: null,
        },
      ]);
      await advanceCmoMedia(context, [reel, short]);
      expect(createTalkingVideoJob).not.toHaveBeenCalled();
    });

    it.each([
      ["the shared job", "video"],
      ["a job started for one post before posts shared it", "reel"],
    ])("goes on every post from %s", async (_name, pieceId) => {
      jobFindMany.mockResolvedValue([
        {
          id: "job-1",
          idempotencyKey: `cmo-media:version-1:${pieceId}:0:talking:${key}:1`,
          status: "SUCCEEDED",
          prompt: script,
          asset: { id: "asset-1" },
        },
      ]);
      ensureDriveFile.mockResolvedValue({
        id: "file-1",
        name: "booking-link.mp4",
        pathname: "drive/booking-link.mp4",
        mimeType: "video/mp4",
        size: 10,
      });
      postFindUnique.mockImplementation(async ({ where }) => ({
        id: where.id,
        provider: where.id === "reel" ? "instagram" : "youtube",
        text: "One link instead of five emails.",
        media: [],
        revision: 1,
        status: "DRAFT",
        scheduledAt: null,
        planning: { title: "Booking link" },
      }));
      updateSocialPost.mockResolvedValue({
        media: [{ pathname: "drive/booking-link.mp4" }],
        revision: 2,
      });
      await advanceCmoMedia(context, [reel, short]);
      expect(createTalkingVideoJob).not.toHaveBeenCalled();
      expect(
        updateSocialPost.mock.calls.map(([input]) => input.postId),
      ).toEqual(["reel", "short"]);
      expect(updateSocialPost.mock.calls[1]?.[0].media).toEqual([
        expect.objectContaining({
          pathname: "drive/booking-link.mp4",
          kind: "video",
        }),
      ]);
    });
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

describe("logoForPicture", () => {
  const plain = (background: string) =>
    sharp({ create: { width: 400, height: 300, channels: 3, background } })
      .jpeg()
      .toBuffer();
  const logo = new Uint8Array([1]);
  const darkLogo = new Uint8Array([2]);

  it("puts the light logo on a dark corner and the dark one on a light corner", async () => {
    expect(
      await logoForPicture(await plain("#0c0c0c"), { logo, darkLogo }),
    ).toBe(darkLogo);
    expect(
      await logoForPicture(await plain("#f4f4f4"), { logo, darkLogo }),
    ).toBe(logo);
  });

  it("keeps the one logo a site has", async () => {
    expect(
      await logoForPicture(await plain("#0c0c0c"), { logo, darkLogo: null }),
    ).toBe(logo);
  });
});

// NMKR's how-to month (2026-11-20): 56 of 69 pictures took an infographic.
describe("a cmo-v8 month's kinds of print", () => {
  const kindOf = new Map([
    ["ref-info-1", "infographic"],
    ["ref-info-2", "infographic"],
    ["ref-poster", "poster"],
    ["ref-poster-2", "poster"],
    ["ref-poster-3", "poster"],
    ["ref-ad", "ad"],
    ["ref-label", "label"],
  ]);
  const at = (
    id: string,
    date: string,
    styleReferenceId: string,
    channel = "x",
  ) => ({
    ...piece({ id, channel, styleReferenceId }),
    date,
    time: "09:00",
  });

  it("are kept only by a cmo-v8 Cuso", () => {
    expect(cmoKeepsPicturesVaried("cmo-v8")).toBe(true);
    expect(cmoKeepsPicturesVaried("cmo-v7")).toBe(false);
    expect(cmoKeepsPicturesVaried(null)).toBe(false);
  });

  it("hold at most one infographic in four pictures", () => {
    expect(cmoInfographicCap(8)).toBe(2);
    expect(cmoInfographicCap(3)).toBe(1);
    const others = [at("a", "2026-11-02", "ref-info-1", "linkedin")];
    const second = at("b", "2026-11-03", "ref-info-2");
    expect(
      cmoPictureStyleProblem([second], others, { kindOf, planned: 4 }),
    ).toContain("b would make 2 infographics in a month of 4 pictures");
    // Eight pictures make room for two; without kinds nothing is counted.
    expect(
      cmoPictureStyleProblem([second], others, { kindOf, planned: 8 }),
    ).toBeNull();
    expect(cmoPictureStyleProblem([second], others)).toBeNull();
  });

  it("give neighbouring pieces on one network different kinds", () => {
    const others = [
      at("a", "2026-11-02", "ref-ad"),
      at("c", "2026-11-04", "ref-poster"),
    ];
    expect(
      cmoPictureStyleProblem([at("b", "2026-11-03", "ref-poster-2")], others, {
        kindOf,
        planned: 12,
      }),
    ).toContain("b and c follow each other on x in one kind of print (poster)");
    // Another network is no neighbour, and a month that already broke the
    // rule keeps it: only what the save brings is refused.
    expect(
      cmoPictureStyleProblem(
        [at("b", "2026-11-03", "ref-poster-2", "linkedin")],
        [...others, at("e", "2026-11-05", "ref-poster-3")],
        { kindOf, planned: 12 },
      ),
    ).toBeNull();
  });

  it("leave a pick the kinds that keep the rules", () => {
    const month = [
      { id: "a", channel: "x", date: "2026-11-02", time: "09:00", kind: "ad" },
      {
        id: "c",
        channel: "x",
        date: "2026-11-04",
        time: "09:00",
        kind: "poster",
      },
      { id: "i", channel: "linkedin", date: "2026-11-02", kind: "infographic" },
    ];
    const piece = { id: "b", channel: "x", date: "2026-11-03", time: "09:00" };
    const howTo = cmoAllowedKinds({
      piece,
      month,
      infographicSuits: false,
      planned: 12,
    });
    expect(howTo).not.toContain("ad");
    expect(howTo).not.toContain("poster");
    expect(howTo).not.toContain("infographic");
    expect(howTo).toContain("label");
    // Numbers may take one while the month is under its cap.
    expect(
      cmoAllowedKinds({ piece, month, infographicSuits: true, planned: 12 }),
    ).toContain("infographic");
    expect(
      cmoAllowedKinds({ piece, month, infographicSuits: true, planned: 4 }),
    ).not.toContain("infographic");
  });
});
