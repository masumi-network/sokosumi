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
  jobs,
  checkStyledPicture,
  brandLogo,
  styleTraits,
  picks,
  pickBest,
  requestVideoShape,
} = vi.hoisted(() => ({
  requestVideoShape: vi.fn(async () => true),
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
  jobs: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  checkStyledPicture: vi.fn(),
  brandLogo: vi.fn(
    async (): Promise<{
      logo: Uint8Array | null;
      dark: Uint8Array | null;
      fileId: string | null;
    }> => ({ logo: null, dark: null, fileId: null }),
  ),
  styleTraits: vi.fn(async (): Promise<Record<string, string> | null> => null),
  picks: {
    findMany: vi.fn(async (): Promise<unknown[]> => []),
    createMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  pickBest: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findUnique: async () => null },
    projectImageJob: { findMany: jobFindMany, count: jobCount, ...jobs },
    projectImageAsset: {
      findUnique: async () => ({
        blobPathname: "studio/asset-1.png",
        contentType: "image/png",
      }),
    },
    socialPost: { findUnique: postFindUnique, updateMany: postUpdateMany },
    marketingStrategyFile: { updateMany: fileUpdateMany },
    cmoPicturePick: picks,
  },
}));
vi.mock("@/services/cmo-picture-style.service", () => ({
  cmoPictureStyle: async () => ({ text: "Flat brand look.", costUsd: 0 }),
  referenceComposition: async () => ({
    text: "Headline band on top.",
    costUsd: 0,
  }),
}));
vi.mock("@/lib/reference-library/layout", () => ({
  layoutBlockMap: async (bytes: Uint8Array) => Buffer.from(bytes),
  pickBestPicture: pickBest,
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
  CMO_MONTH_JOB_KEY_PREFIX: "cmo-media",
  createImageJob,
  createVideoJob,
  createTalkingVideoJob,
  requestVideoShape,
  NOT_A_VIDEO_SHAPE_JOB: {
    NOT: { idempotencyKey: { startsWith: "video-shape:" } },
  },
  videoShapeJobKey: (sourceJobId: string, shape: string) =>
    `video-shape:${sourceJobId}:${shape}`,
  downloadStudioFileReference: async () => ({
    bytes: await (await import("sharp"))
      .default({
        create: { width: 390, height: 844, channels: 3, background: "#0f0" },
      })
      .png()
      .toBuffer(),
  }),
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
  readCmoBrandLogo: brandLogo,
}));
vi.mock("@/services/cuso-project-files.service", () => ({
  cusoDrive: async () => ({
    workspaceId: "ws-1",
    organizationId: "org-1",
    userId: "runner-1",
    projectId: "project-1",
  }),
  saveCusoProjectFile: async () => true,
}));
vi.mock("@/services/reference-library.service", () => ({
  referenceLibraryAvailable: () => true,
  readStyleTraits: styleTraits,
  readReferenceImage: async () => ({
    bytes: Buffer.from("reference"),
    contentType: "image/jpeg",
    description: "an old poster",
  }),
}));
vi.mock("@/lib/reference-library/style-check", () => ({
  checkStyledPicture,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: async () =>
    (await import("sharp"))
      .default({
        create: { width: 100, height: 125, channels: 3, background: "#fff" },
      })
      .png()
      .toBuffer(),
}));
vi.mock("@/services/soko-bot-billing.service", () => ({
  recordSokoBotCheckUsage: vi.fn(),
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
  cmoLayoutPrompt,
  cmoMakesVariedMonth,
  cmoMediaState,
  cmoNeighbourlyKind,
  cmoPassedLogo,
  cmoPickModel,
  cmoPictureOutdated,
  cmoPictureStyleProblem,
  cmoPieceIsTalking,
  cmoPieceSlides,
  cmoShortPictures,
  cmoShotForPiece,
  cmoSlotAction,
  cmoStyleHeadline,
  cmoStyleInks,
  cmoStylePrompt,
  cmoVisualKey,
  cmoWritesSceneVisuals,
  logoForPicture,
  PLACED_SCREEN_NOTE,
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
    attempt: "1",
    createdAt: new Date(0),
    ...patch,
  };
}

describe("cmoShotForPiece", () => {
  const pictures = [
    {
      fileId: "home",
      alt: "Home page screenshot",
      phoneFileId: "home-phone",
      wideFileIds: ["home", "home-hero", "home-pricing"],
    },
    { fileId: "photo", alt: "red sneaker" },
  ];

  it("shows a page on a phone in a tall short, reel or story", () => {
    for (const patch of [
      { channel: "tiktok", format: "short" },
      { channel: "instagram", format: "story" },
      { channel: "instagram", format: "reel" },
    ])
      expect(cmoShotForPiece(piece(patch), "home", pictures)).toBe(
        "home-phone",
      );
  });

  it("shows the desktop page or one of its sections in a feed picture, another per piece", () => {
    const shots = new Set(
      ["a", "b", "c", "d", "e", "f"].map((id) =>
        cmoShotForPiece(
          piece({ id, channel: "linkedin", format: "image" }),
          "home",
          pictures,
        ),
      ),
    );
    expect(shots.size).toBeGreaterThan(1);
    for (const shot of shots)
      expect(["home", "home-hero", "home-pricing"]).toContain(shot);
  });

  it("keeps a picture that is not a page shot, and a page without a twin", () => {
    expect(cmoShotForPiece(piece({ format: "short" }), "photo", pictures)).toBe(
      "photo",
    );
    expect(
      cmoShotForPiece(piece({ format: "short" }), "phone-only", [
        { fileId: "phone-only", alt: "Home on a phone page screenshot" },
      ]),
    ).toBe("phone-only");
  });
});

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

describe("a cmo-v20 short video piece", () => {
  const short = (patch: Partial<CmoMediaPiece> = {}) =>
    piece({
      channel: "tiktok",
      format: "video",
      visual: "A developer's desk at night, warm lamp light.",
      shortFormat: "site_tour",
      script:
        "This is Entry. Paste your GitHub and it drafts one page from what is public. Try it free.",
      hookLine: "One page from your GitHub",
      ...patch,
    });

  it("cuts the short from a still of its scene, not an animation", () => {
    expect(cmoSlotAction(short(), [])).toMatchObject({ step: "still" });
    const still = job({ step: "still", assetId: "still-asset" });
    expect(cmoSlotAction(short(), [still])).toEqual({
      kind: "start",
      step: "short",
      attempt: 1,
      sourceAssetId: "still-asset",
    });
    const made = job({ id: "job-2", step: "short", assetId: "video-asset" });
    expect(cmoSlotAction(short(), [still, made])).toEqual({
      kind: "attach",
      job: made,
    });
  });

  it("still animates a short of a version before cmo-v20", () => {
    const still = job({ step: "still", assetId: "still-asset" });
    expect(
      cmoSlotAction(short({ shortFormat: undefined, script: undefined }), [
        still,
      ]),
    ).toMatchObject({ step: "video" });
  });

  it("starts over when its kind, script, hook line or scene changes", () => {
    const before = cmoVisualKey(short());
    for (const patch of [
      { shortFormat: "voiceover" as const },
      { script: `${short().script} Now.` },
      { hookLine: "Another line" },
      { visual: "Another scene." },
    ])
      expect(cmoVisualKey(short(patch))).not.toBe(before);
  });

  it("shows the site's section crops and photos as they are, never a whole page", () => {
    const pictures = [
      { fileId: "home", alt: "Home page screenshot", kind: "page" as const },
      { fileId: "hero", alt: "Hero, Home page", kind: "section" as const },
      { fileId: "team", alt: "team at work", kind: "photo" as const },
      { fileId: "desk", alt: "desk", kind: "photo" as const },
      { fileId: "cup", alt: "cup", kind: "photo" as const },
    ];
    const chosen = cmoShortPictures({ id: "p1" }, pictures);
    expect(chosen).toHaveLength(3);
    expect(chosen).not.toContain("home");
    expect(new Set(chosen).size).toBe(3);
  });

  it("asks for a scene with no screen in it, since the site is shown for real", () => {
    const prompt = cmoImagePrompt({
      piece: short(),
      slot: 0,
      businessName: "Entry",
      references: 1,
    });
    expect(prompt).toContain("no screen, phone or laptop showing anything");
    expect(prompt).not.toContain("its screens");
    expect(prompt).not.toContain("five-second");
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
    expect(prompt).toContain("#11F250 as the accent, #021205 as the ink");
    // The logo once covered the end of a headline set along the bottom.
    expect(prompt).toContain(
      "Keep one corner plain and every word clear of it",
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
    expect(withSite).toContain("Image 2 is NMKR's own picture");
    expect(withSite).toContain("Invent no price, number, plan");
    expect(withSite).toContain(
      "besides what stands in the brand's own picture",
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

  it("tells the check that Core placed the brand's page itself", async () => {
    const shows = piece({
      styleReferenceId: "01a1e700-0000-7000-8000-000000000001",
      headline: "Fresh minted",
      visual: "Hands holding a phone that shows the homepage",
      visualFileIds: ["f-home"],
    });
    jobFindMany.mockResolvedValue([
      {
        id: "job-1",
        idempotencyKey: `cmo-media:version-1:post-1:0:image:${cmoVisualKey(shows)}:1`,
        status: "SUCCEEDED",
        prompt: "prompt",
        error: null,
        asset: { id: "asset-1" },
      },
    ]);
    jobs.findUnique.mockResolvedValue({ error: null });
    jobs.updateMany.mockResolvedValue({ count: 1 });
    checkStyledPicture.mockResolvedValue({
      passes: false,
      costUsd: 0.01,
      verdict: { problems: ["anything"] },
    });
    await advanceCmoMedia(context, [shows]);
    const input = checkStyledPicture.mock.calls[0]?.[0];
    // Scenes name a phone or laptop: the check is told Core's frame is it.
    expect(input.scene).toContain("Hands holding a phone");
    expect(input.scene).toContain(PLACED_SCREEN_NOTE);
    expect(input.brandPictures).toHaveLength(1);
  });

  it("keeps one verdict per picture when two passes check it at once", async () => {
    const styledPiece = piece({
      styleReferenceId: "01a1e700-0000-7000-8000-000000000001",
      headline: "Fresh minted",
    });
    jobFindMany.mockResolvedValue([
      {
        id: "job-1",
        idempotencyKey: `cmo-media:version-1:post-1:0:image:${cmoVisualKey(styledPiece)}:1`,
        status: "SUCCEEDED",
        prompt: "prompt",
        error: null,
        asset: { id: "asset-1" },
      },
    ]);
    // The job row: a verdict is written once, where none is stored yet.
    let stored: string | null = null;
    jobs.findUnique.mockImplementation(async () => ({
      error: stored,
      workspaceId: "ws-1",
      requestedByUserId: "runner-1",
      referenceFileIds: [],
      workspace: { organizationId: "org-1" },
    }));
    jobs.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.error === null && stored !== null) return { count: 0 };
      stored = data.error;
      return { count: 1 };
    });
    jobs.update.mockImplementation(async ({ data }) => {
      stored = data.error;
      return { id: "job-1" };
    });
    // Both passes read the job before either decides; the first check
    // passes, the second refuses a moment later.
    let release: () => void = () => {};
    const bothChecking = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    checkStyledPicture.mockImplementation(async () => {
      calls += 1;
      const passes = calls === 1;
      if (calls === 2) release();
      await bothChecking;
      if (!passes) await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        passes,
        costUsd: 0.01,
        verdict: { problems: passes ? [] : ["Extra words"] },
      };
    });
    ensureDriveFile.mockResolvedValue({
      id: "file-1",
      name: "fresh.png",
      pathname: "drive/fresh.png",
      mimeType: "image/png",
      size: 10,
    });
    postFindUnique.mockResolvedValue({
      id: "post-1",
      provider: "x",
      text: "Fresh minted",
      media: [],
      revision: 1,
      status: "DRAFT",
      scheduledAt: null,
      planning: { title: "Fresh minted" },
    });
    updateSocialPost.mockResolvedValue({
      media: [{ pathname: "drive/fresh.png" }],
      revision: 2,
    });

    await Promise.all([
      advanceCmoMedia(context, [styledPiece]),
      advanceCmoMedia(context, [styledPiece]),
    ]);

    // The picture went on its post, and the job says it passed.
    expect(updateSocialPost).toHaveBeenCalled();
    expect(stored).toBe("Style passed: logo bottom-right");
  });

  it("starts each piece's picture once, within the month's limit, from the brand's pictures", async () => {
    jobFindMany.mockResolvedValue([]);
    jobCount.mockResolvedValue(10);
    await advanceCmoMedia(context, [
      piece({ id: "a", socialPostId: "a" }),
      piece({ id: "b", socialPostId: "b", visualFileIds: ["f-photo"] }),
      piece({ id: "c", socialPostId: "c" }),
      piece({ id: "d", socialPostId: "d", visual: undefined }),
    ]);
    // Ten jobs already run in the Project: two more fit of the month's twelve.
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

  it("never sends a styled picture's screen to the model, and leaves it a panel", async () => {
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
    // Asked to redraw the real homepage, the models cropped or changed it in
    // 8 of 8 tries: Core places the screenshot on the panel afterwards.
    expect(createImageJob.mock.calls[1]?.[0]).toMatchObject({
      referenceFileIds: [],
    });
    expect(createImageJob.mock.calls[1]?.[0].prompt).toContain(
      "Leave one plain, light, empty panel from 10% to 90% of the width and 30% to 76% of the height",
    );
    expect(createImageJob.mock.calls[1]?.[0].prompt).not.toContain(
      "own picture",
    );
    // Told only to leave the panel, the models drew their own pages with
    // invented words around it, and ran the headline behind the phone.
    expect(createImageJob.mock.calls[1]?.[0].prompt).toContain(
      "Draw no other screen, browser, phone, laptop, monitor or web page",
    );
    expect(createImageJob.mock.calls[0]?.[0].prompt).not.toContain("panel");
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

    describe("in each network's shape", () => {
      const linkedin = {
        ...reel,
        id: "linkedin",
        socialPostId: "linkedin",
        channel: "linkedin",
      };
      const x = {
        ...reel,
        id: "reel@x",
        socialPostId: "reel@x",
        channel: "x",
        format: "video",
        videoOf: "reel",
        videoOfTalking: true,
      };

      beforeEach(() => {
        jobFindMany.mockResolvedValue([
          {
            id: "job-1",
            idempotencyKey: `cmo-media:version-1:video:0:talking:${key}:1`,
            status: "SUCCEEDED",
            prompt: script,
            asset: { id: "asset-vertical" },
          },
        ]);
        ensureDriveFile.mockImplementation(async ({ assetId }) => ({
          id: `file-${assetId}`,
          name: `${assetId}.mp4`,
          pathname: `drive/${assetId}.mp4`,
          mimeType: "video/mp4",
          size: 10,
        }));
        postFindUnique.mockImplementation(async ({ where }) => ({
          id: where.id,
          provider: "linkedin",
          text: "One link instead of five emails.",
          media: [],
          revision: 1,
          status: "DRAFT",
          scheduledAt: null,
          planning: { title: "Booking link" },
        }));
        updateSocialPost.mockResolvedValue({
          media: [{ pathname: "drive/x.mp4" }],
          revision: 2,
        });
      });

      it("asks Core to cut the shapes it lacks and waits, while the Reel takes the vertical video", async () => {
        jobs.findUnique.mockResolvedValue(null);

        await advanceCmoMedia(context, [reel, linkedin, x]);

        expect(requestVideoShape.mock.calls).toEqual([
          ["job-1", "4:5"],
          ["job-1", "16:9"],
        ]);
        expect(
          updateSocialPost.mock.calls.map(([input]) => input.postId),
        ).toEqual(["reel"]);
      });

      it("puts each finished shape on its own post", async () => {
        jobs.findUnique.mockImplementation(async ({ where }) => {
          const shape = where.projectId_idempotencyKey.idempotencyKey
            .split(":")
            .slice(2)
            .join(":");
          return {
            id: `cut-${shape}`,
            status: "SUCCEEDED",
            asset: { id: `asset-${shape}` },
          };
        });

        await advanceCmoMedia(context, [reel, linkedin, x]);

        expect(requestVideoShape).not.toHaveBeenCalled();
        expect(
          ensureDriveFile.mock.calls.map(([input]) => input.assetId),
        ).toEqual(["asset-vertical", "asset-4:5", "asset-16:9"]);
      });

      it("posts the vertical video when its shape could not be cut", async () => {
        jobs.findUnique.mockResolvedValue({
          id: "cut",
          status: "FAILED",
          asset: null,
        });

        await advanceCmoMedia(context, [linkedin]);

        expect(ensureDriveFile.mock.calls[0]?.[0].assetId).toBe(
          "asset-vertical",
        );
      });

      it("posts the video itself when Core says it needs no cut", async () => {
        jobs.findUnique.mockResolvedValue(null);
        requestVideoShape.mockResolvedValueOnce(false);

        await advanceCmoMedia(context, [linkedin]);

        expect(ensureDriveFile.mock.calls[0]?.[0].assetId).toBe(
          "asset-vertical",
        );
      });

      it("leaves free shape cuts out of the month's job slots", async () => {
        jobs.findUnique.mockResolvedValue(null);

        await advanceCmoMedia(context, [linkedin]);

        expect(jobCount).toHaveBeenCalledWith({
          where: expect.objectContaining({
            NOT: { idempotencyKey: { startsWith: "video-shape:" } },
          }),
        });
      });
    });
  });

  it("takes a video's other shapes for its source's kind, not its own format", () => {
    const xVideo = { channel: "x", format: "video" };
    expect(cmoPieceIsTalking({ ...xVideo, videoOfTalking: true })).toBe(true);
    // A short's or an animated picture's copy, also before shortFormat is set.
    expect(cmoPieceIsTalking({ ...xVideo, videoOfTalking: false })).toBe(false);
    expect(cmoPieceIsTalking(xVideo)).toBe(false);
  });

  it("puts a TikTok's one video on its Reel and Short, starting nothing of their own", async () => {
    const tiktok = piece({
      id: "tt-1",
      socialPostId: "tt-1",
      channel: "tiktok",
      format: "video",
      visual: "A phone screen minting an NFT in three taps",
    });
    const copy = (network: string, format: string) =>
      piece({
        ...tiktok,
        id: `tt-1@${network}`,
        socialPostId: `tt-1@${network}`,
        channel: network,
        format,
        videoOf: "tt-1",
      });
    const key = cmoVisualKey(tiktok);
    jobFindMany.mockResolvedValue([
      {
        id: "job-still",
        idempotencyKey: `cmo-media:version-1:tt-1:0:still:${key}:1`,
        status: "SUCCEEDED",
        prompt: "still",
        asset: { id: "still-asset" },
      },
      {
        id: "job-video",
        idempotencyKey: `cmo-media:version-1:tt-1:0:video:${key}:1`,
        status: "SUCCEEDED",
        prompt: "video",
        asset: { id: "video-asset" },
      },
    ]);
    ensureDriveFile.mockResolvedValue({
      id: "file-1",
      name: "mint.mp4",
      pathname: "drive/mint.mp4",
      mimeType: "video/mp4",
      size: 10,
    });
    postFindUnique.mockImplementation(async ({ where }) => ({
      id: where.id,
      provider: where.id.split("@")[1] ?? "tiktok",
      text: "Mint in three taps.",
      media: [],
      revision: 1,
      status: "DRAFT",
      scheduledAt: null,
      planning: { title: "Mint in three taps" },
    }));
    updateSocialPost.mockResolvedValue({
      media: [{ pathname: "drive/mint.mp4" }],
      revision: 2,
    });
    await advanceCmoMedia(context, [
      copy("instagram", "reel"),
      copy("youtube", "short"),
    ]);
    expect(createImageJob).not.toHaveBeenCalled();
    expect(updateSocialPost.mock.calls.map(([input]) => input.postId)).toEqual([
      "tt-1@instagram",
      "tt-1@youtube",
    ]);
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
    expect(cmoMakesVariedMonth("cmo-v8")).toBe(true);
    expect(cmoMakesVariedMonth("cmo-v7")).toBe(false);
    expect(cmoMakesVariedMonth(null)).toBe(false);
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

// The 16 Nov reference test Patrick picked against production (2026-11-20):
// production's prompt named no trait of the print, sent no logo and five
// colours, and its pictures came out as the same green-on-cream icon diagram.
describe("a styled picture made the way the 16 Nov test made them", () => {
  const traits = {
    kind: "poster",
    era: "1930s",
    technique: "silkscreen, flat colour areas",
    layout: "big figure in the middle, headline band at the foot",
    lettering: "bold condensed sans capitals",
  };
  const poster = (patch: Partial<CmoMediaPiece> = {}) =>
    piece({
      styleReferenceId: "01a1e700-0000-7000-8000-000000000001",
      title: "Tokens and NFTs for everyone",
      headline: "Mint now",
      visual: "A worker stamping a large round token at a press",
      ...patch,
    });

  it("names the print's own traits, draws the logo in, and letters a print's lines", () => {
    const prompt = cmoStylePrompt({
      piece: poster(),
      slot: 0,
      businessName: "nmkr.io",
      colours: ["#11f250", "#37483b", "#1378d1", "#fffefa", "#021205"],
      traits,
      logo: true,
    });
    expect(prompt).toContain(
      "Image 1 is a 1930s poster, used ONLY as a style reference. Copy its technique (silkscreen, flat colour areas) and its lettering (bold condensed sans capitals), and keep its paper and print texture. Compose a new picture around the scene below: none of its figures, objects or drawings.",
    );
    expect(prompt).toContain(
      "Image 2 is nmkr.io's logo. Place it exactly as drawn, exactly once, as part of the design (in a masthead, a footer or a sign)",
    );
    expect(prompt).toContain(
      'Letter "Mint now" large in the reference\'s lettering, spelled exactly, the second line "Tokens and NFTs for everyone" smaller, and "nmkr.io" small at the foot.',
    );
    expect(prompt).toContain(
      "Recolour it in the brand's inks instead of the reference's own colours: #11f250 as the accent, #021205 as the ink, on #fffefa paper.",
    );
    expect(prompt).not.toContain("#1378d1");
    expect(prompt).not.toContain("corner plain");
    expect(prompt.length).toBeLessThan(1300);
  });

  it("letters only the headline on an illustration, and no second line that repeats it", () => {
    const illustration = cmoStylePrompt({
      piece: poster(),
      slot: 0,
      businessName: "nmkr.io",
      colours: [],
      traits: {
        ...traits,
        kind: "illustration",
        era: "unknown",
        lettering: "none",
      },
    });
    expect(illustration).toContain("Image 1 is an illustration, used ONLY");
    expect(illustration).not.toContain("its lettering (");
    expect(illustration).toContain(
      "Signs, papers, screens and objects carry no words; no date, issue number, price, printer's credit, caption, signature or seal.",
    );
    expect(illustration).not.toContain("second line");
    expect(
      cmoStylePrompt({
        piece: poster({ title: "Mint Now, today" }),
        slot: 0,
        businessName: "nmkr.io",
        colours: [],
        traits,
      }),
    ).not.toContain("second line");
  });

  it("picks the accent, ink and paper by role", () => {
    expect(
      cmoStyleInks(["#11f250", "#37483b", "#1378d1", "#fffefa", "#021205"]),
    ).toEqual({ accent: "#11f250", ink: "#021205", paper: "#fffefa" });
    expect(cmoStyleInks(["#ff51ff", "#000000", "#ffffff"])).toEqual({
      accent: "#ff51ff",
      ink: "#000000",
      paper: "#ffffff",
    });
  });

  describe("in a month", () => {
    const context = {
      cuso: {
        projectId: "project-1",
        workspaceId: "ws-1",
        sokoBotId: "bot-1",
        businessName: "nmkr.io",
      },
      versionId: "version-1",
      connected: new Set(["x"]),
    };
    const logoPng = () =>
      sharp({
        create: { width: 40, height: 10, channels: 4, background: "#021205" },
      })
        .png()
        .toBuffer();

    beforeEach(async () => {
      vi.clearAllMocks();
      jobCount.mockResolvedValue(0);
      brandPictures.mockResolvedValue([]);
      createImageJob.mockResolvedValue({ id: "new" });
      styleTraits.mockResolvedValue(traits);
      brandLogo.mockResolvedValue({
        logo: new Uint8Array(await logoPng()),
        dark: null,
        fileId: "f-logo",
      });
    });

    it("sends the reference first and the brand's logo second", async () => {
      jobFindMany.mockResolvedValue([]);
      await advanceCmoMedia(context, [poster()]);
      const input = createImageJob.mock.calls[0]?.[0];
      expect(input.referenceLibraryIds).toEqual([
        "01a1e700-0000-7000-8000-000000000001",
      ]);
      expect(input.referenceFileIds).toEqual(["f-logo"]);
      expect(input.prompt).toContain("Image 1 is a 1930s poster");
      expect(input.prompt).toContain("Image 2 is nmkr.io's logo");
    });

    const finished = (made: CmoMediaPiece) => {
      jobFindMany.mockResolvedValue([
        {
          id: "job-1",
          idempotencyKey: `cmo-media:version-1:post-1:0:image:${cmoVisualKey(made)}:1`,
          status: "SUCCEEDED",
          prompt: "prompt",
          error: null,
          asset: { id: "asset-1" },
        },
      ]);
      let stored: string | null = null;
      jobs.findUnique.mockImplementation(async () => ({
        error: stored,
        workspaceId: "ws-1",
        requestedByUserId: "runner-1",
        referenceFileIds: ["f-logo"],
        workspace: { organizationId: "org-1" },
      }));
      jobs.updateMany.mockImplementation(async ({ data }) => {
        stored = data.error;
        return { count: 1 };
      });
      ensureDriveFile.mockResolvedValue(null);
      return () => stored;
    };

    it("keeps a logo the model drew, and is shown it and the allowed lines", async () => {
      const stored = finished(poster());
      checkStyledPicture.mockResolvedValue({
        passes: true,
        costUsd: 0.01,
        verdict: { problems: [], logo: "correct", plainCorner: null },
      });
      await advanceCmoMedia(context, [poster()]);
      const input = checkStyledPicture.mock.calls[0]?.[0];
      expect(input.logo).toBeInstanceOf(Uint8Array);
      // The logo is not one of the brand's own pictures of its site.
      expect(input.brandPictures).toEqual([]);
      expect(input.lines).toEqual(["Tokens and NFTs for everyone", "nmkr.io"]);
      expect(stored()).toBe("Style passed: logo drawn");
    });

    it("places a missing logo on the plain corner the check found", async () => {
      const stored = finished(poster());
      checkStyledPicture.mockResolvedValue({
        passes: true,
        costUsd: 0.01,
        verdict: { problems: [], logo: "absent", plainCorner: "top-left" },
      });
      await advanceCmoMedia(context, [poster()]);
      expect(stored()).toBe("Style passed: logo top-left");
      expect(cmoPassedLogo("Style passed: logo top-left")).toBe("top-left");
      // A pass stored before this change keeps its lower-right logo.
      expect(cmoPassedLogo("Style passed")).toBe("bottom-right");
      expect(cmoPassedLogo("Style passed: logo drawn")).toBe("drawn");
    });
  });
});

describe("cmo-v9's scene visuals", () => {
  it("are cmo-v9's alone, which keeps cmo-v8's varied month", () => {
    expect(cmoWritesSceneVisuals("cmo-v9")).toBe(true);
    expect(cmoMakesVariedMonth("cmo-v9")).toBe(true);
    expect(cmoWritesSceneVisuals("cmo-v8")).toBe(false);
  });
});

// cmo-v11 (owner, 2026-11-21): the reference lends only its layout, Core
// makes five alternatives of every picture and the check model picks one.
describe("a cmo-v11 picture", () => {
  const styledPiece = (patch: Partial<CmoMediaPiece> = {}) =>
    piece({
      channel: "instagram",
      styleReferenceId: "01a1e700-0000-7000-8000-000000000001",
      headline: "Mint now",
      title: "Tokens for everyone",
      ...patch,
    });
  const alt = (n: number, patch: Partial<CmoMediaJob> = {}) =>
    job({
      id: `alt-${n}`,
      attempt: `p${n}`,
      visualKey: cmoVisualKey(styledPiece()),
      createdAt: new Date(1000 + n),
      ...patch,
    });

  it("starts five alternatives, waits for all, then asks for a pick", () => {
    const one = styledPiece();
    expect(cmoSlotAction(one, [], { picker: true })).toMatchObject({
      kind: "start",
      attempt: "p1",
    });
    expect(
      cmoSlotAction(one, [alt(1), alt(2)], { picker: true }),
    ).toMatchObject({ kind: "start", attempt: "p3" });
    const five = [1, 2, 3, 4, 5].map((n) => alt(n));
    expect(
      cmoSlotAction(one, [...five.slice(0, 4), alt(5, { status: "RUNNING" })]),
    ).toEqual({ kind: "wait" });
    // Picker mode is read from the jobs themselves, so every caller agrees.
    expect(cmoSlotAction(one, five)).toEqual({ kind: "pick", jobs: five });
    expect(
      cmoSlotAction(one, five, { pick: { chosenJobId: "alt-4" } }),
    ).toEqual({ kind: "attach", job: five[3] });
    // None passed: one remake, then the piece goes back to Cuso.
    expect(
      cmoSlotAction(one, five, { pick: { chosenJobId: null } }),
    ).toMatchObject({ kind: "start", attempt: "r1" });
    const remake = job({
      id: "r",
      attempt: "r1",
      rejected: true,
      visualKey: cmoVisualKey(one),
    });
    expect(
      cmoSlotAction(one, [...five, remake], { pick: { chosenJobId: null } }),
    ).toEqual({ kind: "failed" });
    expect(cmoMediaState(one, five)).toBe("making");
    // The state reads no pick: a remake only starts after one, so a rejected
    // remake still fails the piece and the month moves on to its review.
    expect(cmoMediaState(one, [...five, remake])).toBe("failed");
  });

  it("makes three on Muse and two on MAI where MAI can, and remakes on GPT Image", () => {
    expect(
      ["p1", "p2", "p3", "p4", "p5"].map((a) => cmoPickModel(a, "4:5")),
    ).toEqual([
      "muse-image",
      "muse-image",
      "muse-image",
      "mai-image-2-7",
      "mai-image-2-7",
    ]);
    // MAI needs both sides at 768 px: a wide X picture stays on Muse.
    expect(cmoPickModel("p4", "16:9")).toBe("muse-image");
    expect(cmoPickModel("r1", "16:9")).toBe("gpt-image-2-6");
  });

  it("borrows the layout as a block map, in the brand's look, with named text slots", () => {
    const prompt = cmoLayoutPrompt({
      piece: styledPiece({ pictureKind: "bold graphic" }),
      slot: 0,
      businessName: "nmkr.io",
      composition: "Headline band on top.",
      pictureStyle: "Flat brand look.",
      logo: true,
    });
    expect(prompt).toContain("Image 1 is a block map of a layout");
    expect(prompt).toContain("Composition: Headline band on top.");
    expect(prompt).toContain("Draw it as a bold graphic. Flat brand look.");
    expect(prompt).toContain("Image 2 is nmkr.io's logo.");
    expect(prompt).toContain(
      'Its text slots take only these words: "Mint now" in the largest slot, spelled exactly, "Tokens for everyone" in a smaller slot and "nmkr.io" in one small slot',
    );
    expect(prompt).not.toMatch(/technique|paper texture|era/);
  });

  it("keeps neighbouring pieces on a network in different picture kinds", () => {
    const calendar = [
      {
        id: "a",
        channel: "x",
        date: "2026-12-01",
        time: "09:00",
        pictureKind: "flat illustration" as const,
      },
      {
        id: "c",
        channel: "x",
        date: "2026-12-03",
        time: "09:00",
        pictureKind: "bold graphic" as const,
      },
      {
        id: "z",
        channel: "linkedin",
        date: "2026-12-02",
        time: "09:00",
        pictureKind: "photographic scene" as const,
      },
    ];
    const b = { id: "b", channel: "x", date: "2026-12-02", time: "09:00" };
    expect(cmoNeighbourlyKind("flat illustration", b, calendar as never)).toBe(
      "photographic scene",
    );
    expect(
      cmoNeighbourlyKind("isometric illustration", b, calendar as never),
    ).toBe("isometric illustration");
  });

  describe("in a month", () => {
    const context = {
      cuso: {
        projectId: "project-1",
        workspaceId: "ws-1",
        sokoBotId: "bot-1",
        businessName: "nmkr.io",
      },
      versionId: "version-1",
      connected: new Set(["instagram"]),
      picksPictures: true,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      jobCount.mockResolvedValue(0);
      brandPictures.mockResolvedValue([]);
      createImageJob.mockResolvedValue({ id: "new" });
      picks.findMany.mockResolvedValue([]);
      brandLogo.mockResolvedValue({ logo: null, dark: null, fileId: null });
    });

    it("starts all five alternatives at once, layout only", async () => {
      jobFindMany.mockResolvedValue([]);
      await advanceCmoMedia(context, [styledPiece()]);
      expect(createImageJob).toHaveBeenCalledTimes(5);
      const calls = createImageJob.mock.calls.map(([input]) => input);
      expect(calls.map((input) => input.modelId)).toEqual([
        "muse-image",
        "muse-image",
        "muse-image",
        "mai-image-2-7",
        "mai-image-2-7",
      ]);
      expect(calls.every((input) => input.styleLayoutOnly)).toBe(true);
      expect(calls[0].idempotencyKey).toMatch(/:image:[0-9a-f]{10}:p1$/);
      expect(calls[0].prompt).toContain("Image 1 is a block map of a layout");
      expect(calls[0].monthConcurrency).toBe(25);
    });

    it("checks each alternative, picks among those that passed, records why, and posts the winner", async () => {
      const made = styledPiece();
      jobFindMany.mockResolvedValue(
        [1, 2, 3, 4, 5].map((n) => ({
          id: `alt-${n}`,
          idempotencyKey: `cmo-media:version-1:post-1:0:image:${cmoVisualKey(made)}:p${n}`,
          status: "SUCCEEDED",
          prompt: "prompt",
          error: null,
          createdAt: new Date(1000 + n),
          asset: { id: `asset-${n}` },
        })),
      );
      const verdicts = new Map<string, string>();
      jobs.findUnique.mockImplementation(async ({ where }) => ({
        error: verdicts.get(where.id) ?? null,
        workspaceId: "ws-1",
        requestedByUserId: "runner-1",
        referenceFileIds: [],
        workspace: { organizationId: "org-1" },
      }));
      jobs.updateMany.mockImplementation(async ({ where, data }) => {
        verdicts.set(where.id, data.error);
        return { count: 1 };
      });
      const passing = new Set(["alt-2", "alt-4"]);
      checkStyledPicture.mockImplementation(async () => ({
        passes: true,
        costUsd: 0.01,
        verdict: { problems: [], logo: "absent", plainCorner: "bottom-right" },
      }));
      // Each job's own verdict: two of the five pass.
      jobs.updateMany.mockImplementation(async ({ where, data }) => {
        verdicts.set(
          where.id,
          passing.has(where.id) ? data.error : "Style check: Extra words",
        );
        return { count: 1 };
      });
      pickBest.mockResolvedValue({
        index: 1,
        reason: "Clearest headline",
        costUsd: 0.02,
      });
      let stored: { chosenJobId: string | null } | null = null;
      picks.createMany.mockImplementation(async ({ data }) => {
        stored ??= data[0];
        return { count: 1 };
      });
      picks.findUnique.mockImplementation(async () => ({
        id: "pick-1",
        ...stored,
      }));
      ensureDriveFile.mockResolvedValue(null);

      await advanceCmoMedia(context, [made]);

      expect(checkStyledPicture).toHaveBeenCalledTimes(5);
      expect(checkStyledPicture.mock.calls[0]?.[0].layoutOnly).toBe(true);
      expect(pickBest).toHaveBeenCalledTimes(1);
      expect(pickBest.mock.calls[0]?.[0].candidates).toHaveLength(2);
      const row = picks.createMany.mock.calls[0]?.[0].data[0];
      expect(row).toMatchObject({
        pieceId: "post-1",
        slot: 0,
        candidateJobIds: ["alt-1", "alt-2", "alt-3", "alt-4", "alt-5"],
        chosenJobId: "alt-4",
        reason: "Clearest headline",
        costUsd: 0.02,
      });
      // The winner goes to its post.
      expect(ensureDriveFile).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "alt-4" }),
      );
    });
  });
});
