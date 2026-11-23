import { convertCreditsToCents } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";

/**
 * A short rides the talking video's row: its one paid request is its music,
 * and Core puts the video together around it from the voice, the brand's
 * pictures and its site when the music comes back.
 */

const {
  jobCreateMock,
  jobFindUniqueMock,
  jobFindUniqueOrThrowMock,
  jobUpdateMock,
  jobUpdateManyMock,
  getEnvMock,
  submitToQueueMock,
  fetchQueueStatusMock,
  uploadReferenceMock,
  downloadMediaMock,
  requireProjectAccessMock,
  getBalanceMock,
  speakVoiceoverMock,
  writeHookLineMock,
  writeBrollPromptMock,
  timeSpokenWordsMock,
  editTalkingVideoMock,
  projectFindUniqueMock,
  captureSitePageMock,
  loadEndCardMock,
  fetchQueueResultMock,
  readAssetBytesMock,
  putMock,
  assetCountMock,
  assetFindManyMock,
  editShortVideoMock,
  loadStudioBrandMock,
} = vi.hoisted(() => ({
  jobCreateMock: vi.fn(),
  jobFindUniqueMock: vi.fn(),
  jobFindUniqueOrThrowMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  getEnvMock: vi.fn(),
  submitToQueueMock: vi.fn(),
  fetchQueueStatusMock: vi.fn(),
  uploadReferenceMock: vi.fn(),
  downloadMediaMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  getBalanceMock: vi.fn(),
  speakVoiceoverMock: vi.fn(),
  writeHookLineMock: vi.fn(),
  writeBrollPromptMock: vi.fn(),
  timeSpokenWordsMock: vi.fn(),
  projectFindUniqueMock: vi.fn(),
  captureSitePageMock: vi.fn(),
  loadEndCardMock: vi.fn(),
  fetchQueueResultMock: vi.fn(),
  readAssetBytesMock: vi.fn(),
  editTalkingVideoMock: vi.fn(),
  putMock: vi.fn(),
  assetCountMock: vi.fn(),
  assetFindManyMock: vi.fn(),
  editShortVideoMock: vi.fn(),
  loadStudioBrandMock: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ put: putMock }));
vi.mock("@/services/image-studio-drive.service", () => ({
  publishStudioAssetToFiles: vi.fn(),
}));
vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: { getBalance: getBalanceMock },
}));
vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
  getBetterAuthPublicBaseUrl: () => "http://localhost:3001",
}));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    projectImageJob: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { chargedCents: null } }),
      count: vi.fn().mockResolvedValue(0),
      create: jobCreateMock,
      findUnique: jobFindUniqueMock,
      findUniqueOrThrow: jobFindUniqueOrThrowMock,
      update: jobUpdateMock,
      updateMany: jobUpdateManyMock,
    },
    project: { findUnique: projectFindUniqueMock },
    projectImageAsset: {
      count: assetCountMock,
      findMany: assetFindManyMock,
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }) => ({ id: "asset-1", ...data })),
    },
  };
  return { default: client };
});
vi.mock("@/lib/db/transaction", async () => ({
  ...(await vi.importActual<typeof import("@/lib/db/transaction")>(
    "@/lib/db/transaction",
  )),
  serializableTransaction: async (run: (tx: unknown) => Promise<unknown>) =>
    await run((await import("@/lib/db/prisma")).default),
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: requireProjectAccessMock,
  requireProjectAccessForUser: requireProjectAccessMock,
}));
vi.mock("@/lib/image-studio/fal-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/fal-client")>(
    "@/lib/image-studio/fal-client",
  )),
  submitToQueue: submitToQueueMock,
  fetchQueueStatus: fetchQueueStatusMock,
  uploadReference: uploadReferenceMock,
  downloadMedia: downloadMediaMock,
  fetchQueueResult: fetchQueueResultMock,
}));
vi.mock("@/lib/image-studio/talking-video-brand", () => ({
  captureTalkingVideoSitePage: captureSitePageMock,
  loadTalkingVideoEndCard: loadEndCardMock,
}));
vi.mock("@/lib/image-studio/reference-files", () => ({
  requireStudioReferenceFiles: vi.fn(
    async ({ resourceIds }: { resourceIds: string[] }) => resourceIds,
  ),
}));
vi.mock("@/lib/soko-bot/voiceover", () => ({
  speakVoiceover: speakVoiceoverMock,
}));
vi.mock("@/services/talking-video-scripts.service", () => ({
  writeTalkingVideoHookLine: writeHookLineMock,
  writeTalkingVideoBrollPrompt: writeBrollPromptMock,
}));
vi.mock("@/lib/image-studio/talking-video-words", () => ({
  timeSpokenWords: timeSpokenWordsMock,
}));
vi.mock("@/lib/image-studio/talking-video-edit", async () => ({
  ...(await vi.importActual<
    typeof import("@/lib/image-studio/talking-video-edit")
  >("@/lib/image-studio/talking-video-edit")),
  editTalkingVideo: editTalkingVideoMock,
  editShortVideo: editShortVideoMock,
}));
vi.mock("@/lib/image-studio/talking-video", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/talking-video")>(
    "@/lib/image-studio/talking-video",
  )),
  frameTalkingVideoPresenter: vi.fn(async () => new Uint8Array([9])),
}));
vi.mock("@/lib/image-studio/studio-brand", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/studio-brand")>(
    "@/lib/image-studio/studio-brand",
  )),
  loadStudioBrand: loadStudioBrandMock,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: readAssetBytesMock,
}));

import {
  createShortVideoJob,
  settleWithMedia,
} from "@/services/image-studio-jobs.service";

/** 130 characters: quoted at 10 seconds. */
const SCRIPT = `${"Stop scrolling. ".repeat(8)}ok`;
const WORDS = [
  { text: "Stop", start: 0.1, end: 0.4 },
  { text: "scrolling.", start: 0.45, end: 1 },
];
const PICTURE = "4b8f6f1e-1c1a-4a5e-9a51-1b9d5f6f2a01";

const BASE_INPUT = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  format: "voiceover" as const,
  script: SCRIPT,
  voice: "Sarah",
  languageCode: "en",
  pictures: {
    assetIds: [PICTURE],
    fileIds: [],
    actor: {
      kind: "interactive" as const,
      userId: "user-1",
      organizationId: null,
    },
  },
  idempotencyKey: "key-abcdefgh",
};

let stored: Record<string, unknown> = {};

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({
    FAL_KEY: "k",
    IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "studio-private-store-token",
  });
  requireProjectAccessMock.mockResolvedValue({
    projectId: "project-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    organizationId: null,
  });
  getBalanceMock.mockResolvedValue(10_000_000_000_000n);
  jobFindUniqueMock.mockResolvedValue(null);
  jobCreateMock.mockImplementation(async ({ data }) => {
    stored = {
      id: "job-1",
      status: "PENDING",
      submitAttempts: 0,
      pendingMediaUrl: null,
      createdAt: new Date(),
      ...data,
    };
    return stored;
  });
  jobFindUniqueOrThrowMock.mockImplementation(async () => stored);
  jobUpdateMock.mockImplementation(async ({ data }) => {
    stored = { ...stored, ...data };
    return stored;
  });
  jobUpdateManyMock.mockResolvedValue({ count: 1 });
  submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });
  speakVoiceoverMock.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    costUsd: 0.01,
    durationSeconds: 8.4,
    sentences: [],
  });
  timeSpokenWordsMock.mockResolvedValue(WORDS);
  projectFindUniqueMock.mockResolvedValue({
    id: "project-1",
    name: "Roastery",
    logo: null,
    websiteUrl: "https://roastery.example",
  });
  captureSitePageMock.mockResolvedValue(new Uint8Array([5]));
  loadEndCardMock.mockResolvedValue(null);
  writeHookLineMock.mockResolvedValue("Stop the scroll");
  putMock.mockImplementation(async (pathname: string) => ({ pathname }));
  uploadReferenceMock.mockResolvedValue(
    "https://v3b.fal.media/files/voice.mp3",
  );
  assetCountMock.mockResolvedValue(1);
  assetFindManyMock.mockResolvedValue([
    { id: PICTURE, blobPathname: "projects/project-1/image-studio/pic.png" },
  ]);
  readAssetBytesMock.mockResolvedValue(new Uint8Array([7]));
  loadStudioBrandMock.mockResolvedValue({ designColors: ["#123456"] });
});

describe("starting a short", () => {
  it("quotes music, voice and timing, and sends the music as its one request", async () => {
    await createShortVideoJob(BASE_INPUT);

    expect(jobCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "TALKING_VIDEO",
        model: "fal-ai/lyria2",
        referenceAssetIds: [PICTURE],
        settings: expect.objectContaining({
          format: "voiceover",
          presenterId: null,
          music: true,
          broll: false,
          siteShots: true,
        }),
        // $0.10 music, 130 characters of voice and 10 s of timing.
        chargedCents: convertCreditsToCents(12),
      }),
    });
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          voiceBlobPathname: "projects/project-1/image-studio/job-1-voice.mp3",
          settings: expect.objectContaining({
            words: WORDS,
            hookLine: "Stop the scroll",
            sitePagePathname: "projects/project-1/image-studio/job-1-site.jpg",
            picturePathnames: [
              "projects/project-1/image-studio/job-1-picture-0.jpg",
            ],
          }),
        },
      }),
    );
    expect(submitToQueueMock).toHaveBeenCalledTimes(1);
    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "fal-ai/lyria2" }),
    );
  });

  it("keeps a hook line it was given instead of writing one", async () => {
    await createShortVideoJob({ ...BASE_INPUT, hookLine: "Fresh this week" });

    expect(writeHookLineMock).not.toHaveBeenCalled();
    expect(stored.settings).toMatchObject({ hookLine: "Fresh this week" });
  });

  it("times a slideshow's lines for reading and speaks nothing", async () => {
    await createShortVideoJob({
      ...BASE_INPUT,
      format: "slideshow",
      script: "Shipped the code?\nNow ship the page.\nTry it free today",
    });

    expect(speakVoiceoverMock).not.toHaveBeenCalled();
    expect(jobCreateMock.mock.calls[0]![0].data.chargedCents).toBe(
      convertCreditsToCents(10),
    );
    const settings = stored.settings as { words: { text: string }[] };
    expect(settings.words.map((word) => word.text).at(-1)).toBe("today.");
  });

  it("spreads the words over the voice when they could not be timed", async () => {
    timeSpokenWordsMock.mockResolvedValue([]);

    await createShortVideoJob(BASE_INPUT);

    const settings = stored.settings as {
      words: { end: number }[];
      durationSeconds: number;
    };
    expect(settings.words).toHaveLength(17);
    expect(settings.words.at(-1)!.end).toBeCloseTo(settings.durationSeconds);
  });

  it("refuses a website tour for a Project without a website", async () => {
    projectFindUniqueMock.mockResolvedValue({ websiteUrl: null });

    await expect(
      createShortVideoJob({ ...BASE_INPUT, format: "site_tour" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(jobCreateMock).not.toHaveBeenCalled();
  });

  it("refuses a short with nothing to show", async () => {
    projectFindUniqueMock.mockResolvedValue({ websiteUrl: null });

    await expect(
      createShortVideoJob({
        ...BASE_INPUT,
        pictures: { ...BASE_INPUT.pictures, assetIds: [] },
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a picture that is not in the Project", async () => {
    assetCountMock.mockResolvedValue(0);

    await expect(createShortVideoJob(BASE_INPUT)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses a script that speaks as a customer", async () => {
    await expect(
      createShortVideoJob({
        ...BASE_INPUT,
        script:
          "I've been using this planner for a month and it changed my life.",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("a short's music arriving", () => {
  beforeEach(async () => {
    await createShortVideoJob(BASE_INPUT);
    stored = { ...stored, status: "RUNNING", falRequestId: "fal-1" };
    jobFindUniqueMock.mockImplementation(async () => ({
      ...stored,
      asset: null,
    }));
    downloadMediaMock.mockResolvedValue({
      bytes: new Uint8Array([4]),
      contentType: "audio/wav",
    });
    // Stop at the upload: storing is the image job's own, tested path.
    putMock.mockRejectedValue(new Error("stop at the upload"));
  });

  it("puts the short together from the voice, pictures, site and music", async () => {
    editShortVideoMock.mockResolvedValue({
      bytes: new Uint8Array([8]),
      durationSeconds: 9.2,
    });

    await settleWithMedia("job-1", "https://v3b.fal.media/files/music.wav");

    expect(downloadMediaMock).toHaveBeenCalledWith(
      "https://v3b.fal.media/files/music.wav",
      expect.any(Number),
      "audio/wav",
    );
    expect(editShortVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "voiceover",
        words: WORDS,
        hookLine: "Stop the scroll",
        music: new Uint8Array([4]),
        voice: new Uint8Array([7]),
        page: new Uint8Array([7]),
        pictures: [new Uint8Array([7])],
        cardColour: "0x123456",
      }),
    );
    // No cut-out or caption request: a short has no presenter clip.
    expect(submitToQueueMock).toHaveBeenCalledTimes(1);
    expect(putMock).toHaveBeenLastCalledWith(
      expect.any(String),
      new Uint8Array([8]),
      expect.objectContaining({ contentType: "video/mp4" }),
    );
  });

  it("fails the job, uncharged, when the short cannot be put together", async () => {
    editShortVideoMock.mockRejectedValue(new Error("ffmpeg exited 1"));
    const logged = expectCoreLog("warn", "Could not put a short together");

    await settleWithMedia("job-1", "https://v3b.fal.media/files/music.wav");

    expect(jobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          failureReason: "unknown",
        }),
      }),
    );
    expect(logged).toHaveLength(1);
  });
});
