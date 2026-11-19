import { convertCreditsToCents } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";

/**
 * A talking video rides the image job's row, lease, quote and webhook. What is
 * new is that Core edits the presenter's clip before storing it, and that a
 * clip without word timings is sent on for captions on the same row.
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
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: readAssetBytesMock,
}));

import { TALKING_VIDEO_PRESENTERS } from "@/lib/image-studio/talking-video";
import {
  createTalkingVideoJob,
  failImageJob,
  reconcileJob,
  settleWithMedia,
} from "@/services/image-studio-jobs.service";

/** 130 characters: quoted at 10 seconds. */
const SCRIPT = `${"Stop scrolling. ".repeat(8)}ok`;
const PRESENTER = TALKING_VIDEO_PRESENTERS[0]!;
const WORDS = [
  { text: "Stop", start: 0.1, end: 0.4 },
  { text: "scrolling.", start: 0.45, end: 1 },
];

const BASE_INPUT = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  script: SCRIPT,
  voice: "Sarah",
  languageCode: "en",
  presenter: { kind: "stock" as const, id: PRESENTER.id },
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
  jobUpdateMock.mockImplementation(async ({ data }) => ({
    ...stored,
    ...data,
  }));
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
    websiteUrl: null,
  });
  captureSitePageMock.mockResolvedValue(null);
  loadEndCardMock.mockResolvedValue(null);
  writeHookLineMock.mockResolvedValue("Stop the scroll");
  putMock.mockResolvedValue({
    pathname: "projects/project-1/image-studio/job-1-voice.mp3",
  });
  uploadReferenceMock.mockResolvedValue(
    "https://v3b.fal.media/files/voice.mp3",
  );
});

describe("starting a talking video that shows the site", () => {
  beforeEach(() => {
    projectFindUniqueMock.mockResolvedValue({
      websiteUrl: "https://roastery.example",
    });
  });

  it("quotes the cut-out and keeps the site's screenshot", async () => {
    captureSitePageMock.mockResolvedValue(new Uint8Array([5]));
    putMock.mockImplementation(async (pathname: string) => ({ pathname }));

    await createTalkingVideoJob(BASE_INPUT);

    expect(jobCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settings: expect.objectContaining({ siteShots: true }),
        // 10 s: the cut-out adds about 10 cents.
        chargedCents: convertCreditsToCents(62),
      }),
    });
    expect(captureSitePageMock).toHaveBeenCalledWith(
      "https://roastery.example",
    );
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({
            siteShots: true,
            sitePagePathname: "projects/project-1/image-studio/job-1-site.jpg",
          }),
        }),
      }),
    );
  });

  it("takes the cut-out off the charge when the site does not load", async () => {
    await createTalkingVideoJob(BASE_INPUT);

    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({
            siteShots: false,
            sitePagePathname: null,
          }),
          chargedCents: convertCreditsToCents(52),
        }),
      }),
    );
  });

  it("leaves the site out when the caller turned it off", async () => {
    await createTalkingVideoJob({ ...BASE_INPUT, siteShots: false });

    expect(jobCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settings: expect.objectContaining({ siteShots: false }),
        chargedCents: convertCreditsToCents(52),
      }),
    });
    expect(captureSitePageMock).not.toHaveBeenCalled();
  });
});

describe("starting a talking video with extras", () => {
  /** A hook of four seconds: room for the presenter's first second and a clip. */
  const LONG_HOOK = [
    { text: "Your", start: 0.1, end: 0.6 },
    { text: "inbox", start: 0.7, end: 1.6 },
    { text: "is", start: 1.7, end: 2.4 },
    { text: "full.", start: 2.5, end: 4 },
    { text: "Stop.", start: 4.6, end: 5 },
  ];

  it("quotes them and starts the clip and the music beside the presenter", async () => {
    timeSpokenWordsMock.mockResolvedValue(LONG_HOOK);
    writeBrollPromptMock.mockResolvedValue("Hands on a laptop at a desk.");
    submitToQueueMock.mockImplementation(
      async ({ model }: { model: string }) => ({
        kind: "queued",
        requestId: model.includes("wan")
          ? "fal-broll"
          : model.includes("lyria")
            ? "fal-music"
            : "fal-1",
      }),
    );

    await createTalkingVideoJob({ ...BASE_INPUT, broll: true, music: true });

    expect(jobCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        // 52 for the video, 50 for the clip, 10 for the music.
        chargedCents: convertCreditsToCents(112),
      }),
    });
    expect(submitToQueueMock).toHaveBeenCalledWith({
      model: "fal-ai/wan-25-preview/text-to-video",
      input: expect.objectContaining({
        prompt: "Hands on a laptop at a desk.",
        aspect_ratio: "9:16",
        resolution: "720p",
        duration: "5",
      }),
      webhookUrl: null,
    });
    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "fal-ai/lyria2", webhookUrl: null }),
    );
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({
            brollRequestId: "fal-broll",
            musicRequestId: "fal-music",
          }),
        }),
      }),
    );
  });

  it("makes no clip for a hook too short to show one, and does not charge for it", async () => {
    writeBrollPromptMock.mockResolvedValue("Hands on a laptop at a desk.");
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });

    await createTalkingVideoJob({ ...BASE_INPUT, broll: true });

    expect(writeBrollPromptMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ model: "fal-ai/wan-25-preview/text-to-video" }),
    );
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({ broll: false }),
          chargedCents: convertCreditsToCents(52),
        }),
      }),
    );
  });

  it("takes an extra that could not be started off the charge", async () => {
    timeSpokenWordsMock.mockResolvedValue(LONG_HOOK);
    writeBrollPromptMock.mockResolvedValue(null);
    submitToQueueMock
      .mockResolvedValueOnce({ kind: "rejected", status: 422 })
      .mockResolvedValue({ kind: "queued", requestId: "fal-1" });

    await createTalkingVideoJob({ ...BASE_INPUT, broll: true, music: true });

    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({ broll: false, music: false }),
          chargedCents: convertCreditsToCents(52),
        }),
      }),
    );
  });
});

describe("starting a talking video", () => {
  it("quotes the script, keeps the voice and sends the photo with it", async () => {
    await createTalkingVideoJob(BASE_INPUT);

    expect(jobCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "TALKING_VIDEO",
        model: "heygen/avatar-6/turbo/image-to-video",
        prompt: SCRIPT,
        settings: {
          aspectRatio: "9:16",
          durationSeconds: 10,
          resolution: "1080p",
          voice: "Sarah",
          presenterId: PRESENTER.id,
          languageCode: "en",
          words: [],
          hookLine: null,
          siteShots: false,
          sitePagePathname: null,
          broll: false,
          brollRequestId: null,
          music: false,
          musicRequestId: null,
        },
        // 10 s at $0.05, plus the voice and timing its words.
        chargedCents: convertCreditsToCents(52),
      }),
    });
    expect(speakVoiceoverMock).toHaveBeenCalledWith({
      text: SCRIPT,
      voice: "Sarah",
      languageCode: "en",
    });
    expect(timeSpokenWordsMock).toHaveBeenCalledWith({
      audioUrl: "https://v3b.fal.media/files/voice.mp3",
      script: SCRIPT,
      languageCode: "en",
    });
    // The spoken length replaces the quoted one; the quote stays as shown.
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          voiceBlobPathname: "projects/project-1/image-studio/job-1-voice.mp3",
          settings: expect.objectContaining({
            durationSeconds: 9,
            words: WORDS,
            hookLine: "Stop the scroll",
          }),
        },
      }),
    );
    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "heygen/avatar-6/turbo/image-to-video",
        input: {
          image_url: PRESENTER.imageUrl,
          audio_url: "https://v3b.fal.media/files/voice.mp3",
          resolution: "1080p",
        },
      }),
    );
  });

  it("records consent with a person's own photo", async () => {
    const consentAt = new Date("2026-11-18T10:00:00Z");
    jobFindUniqueOrThrowMock.mockRejectedValue(new Error("stop before send"));

    await expect(
      createTalkingVideoJob({
        ...BASE_INPUT,
        presenter: {
          kind: "file",
          fileId: "9b2f6c0e-6f0e-4b56-9d59-1d1c9c7a7b11",
          actor: { kind: "soko_bot", userId: "user-1", organizationId: null },
          consentAt,
        },
      }),
    ).rejects.toThrow("stop before send");

    expect(jobCreateMock.mock.calls[0]![0].data).toMatchObject({
      referenceFileIds: ["9b2f6c0e-6f0e-4b56-9d59-1d1c9c7a7b11"],
      presenterConsentAt: consentAt,
      settings: expect.objectContaining({ presenterId: null }),
    });
  });

  it("refuses a presenter that is not in the catalog before reserving", async () => {
    await expect(
      createTalkingVideoJob({
        ...BASE_INPUT,
        presenter: { kind: "stock", id: "nobody" },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(speakVoiceoverMock).not.toHaveBeenCalled();
  });

  it("refuses a script that speaks as a customer before reserving", async () => {
    await expect(
      createTalkingVideoJob({
        ...BASE_INPUT,
        script:
          "I've been using this planner for a month and it changed my life.",
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(jobCreateMock).not.toHaveBeenCalled();
  });

  it("fails the job without sending when the voice cannot be made", async () => {
    speakVoiceoverMock.mockRejectedValue(new Error("voice service down"));
    const logged = expectCoreLog(
      "warn",
      "An image generation failed before it was sent",
    );

    await createTalkingVideoJob(BASE_INPUT);

    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(jobUpdateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          failureReason: "voice_unavailable",
        }),
      }),
    );
    expect(logged).toHaveLength(1);
  });

  it("reads the voice's length from the mp3 when it comes without timings", async () => {
    speakVoiceoverMock.mockResolvedValue({
      // 7.6 s of a 128 kbps mp3.
      bytes: new Uint8Array(121_600),
      costUsd: 0.01,
      durationSeconds: null,
      sentences: [],
    });

    await createTalkingVideoJob(BASE_INPUT);

    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({ durationSeconds: 8 }),
        }),
      }),
    );
  });

  it("refuses a voice that runs far longer than the quote", async () => {
    speakVoiceoverMock.mockResolvedValue({
      bytes: new Uint8Array([1]),
      costUsd: 0.01,
      durationSeconds: 21,
      sentences: [],
    });
    expectCoreLog("warn", "An image generation failed before it was sent");

    await createTalkingVideoJob(BASE_INPUT);

    expect(submitToQueueMock).not.toHaveBeenCalled();
  });
});

describe("the presenter model's video arriving", () => {
  const AVATAR_URL = "https://v3b.fal.media/files/avatar.mp4";
  const waiting = {
    kind: "TALKING_VIDEO",
    falRequestId: "fal-1",
    pendingMediaUrl: null,
    settings: { languageCode: "de" },
  };

  it("sends it on for captions when the voice's words were not timed", async () => {
    jobFindUniqueMock.mockResolvedValue(waiting);
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-2" });

    await settleWithMedia("job-1", AVATAR_URL, undefined, "fal-1");

    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "fal-ai/workflow-utilities/auto-subtitle",
        input: expect.objectContaining({
          video_url: AVATAR_URL,
          language: "de",
        }),
      }),
    );
    // The lease is taken on the request the video answers.
    expect(jobUpdateManyMock.mock.calls[0]![0].where).toMatchObject({
      id: "job-1",
      falRequestId: "fal-1",
    });
    expect(jobUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          falRequestId: "fal-2",
          pendingMediaUrl: AVATAR_URL,
        }),
      }),
    );
    expect(downloadMediaMock).not.toHaveBeenCalled();
  });

  it("ignores a second delivery of the same video once captions are running", async () => {
    jobFindUniqueMock.mockResolvedValue({
      ...waiting,
      falRequestId: "fal-2",
      pendingMediaUrl: AVATAR_URL,
    });

    await settleWithMedia("job-1", AVATAR_URL, undefined, "fal-1");

    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(downloadMediaMock).not.toHaveBeenCalled();
  });

  it("sends no caption request when another settler holds the lease", async () => {
    jobFindUniqueMock.mockResolvedValue(waiting);
    jobUpdateManyMock.mockResolvedValue({ count: 0 });

    await settleWithMedia("job-1", AVATAR_URL, undefined, "fal-1");

    expect(submitToQueueMock).not.toHaveBeenCalled();
  });
});

describe("the presenter model's video arriving with word timings", () => {
  const AVATAR_URL = "https://v3b.fal.media/files/avatar.mp4";
  const row = {
    id: "job-1",
    kind: "TALKING_VIDEO",
    status: "RUNNING",
    projectId: "project-1",
    requestedByUserId: "user-1",
    falRequestId: "fal-1",
    idempotencyKey: "key-abcdefgh",
    pendingMediaUrl: null,
    settings: { durationSeconds: 9, words: WORDS, hookLine: "Stop the scroll" },
    asset: null,
  };
  const SITE = "projects/project-1/image-studio/job-1-site.jpg";
  const COLOUR_URL = "https://v3b.fal.media/files/cutout_color.mp4";
  const ALPHA_URL = "https://v3b.fal.media/files/cutout_alpha.mp4";

  beforeEach(() => {
    jobFindUniqueMock.mockResolvedValue(row);
    downloadMediaMock.mockResolvedValue({
      bytes: new Uint8Array([9]),
      contentType: "video/mp4",
    });
    // Stop at the upload: storing is the image job's own, tested path.
    putMock.mockRejectedValue(new Error("stop at the upload"));
    jobUpdateMock.mockResolvedValue({
      statusUnreachableSince: null,
      resultUnreachableSince: null,
      authUnreachableSince: null,
    });
  });

  it("edits the clip from its words and stores the edit, with no caption request", async () => {
    const edited = new Uint8Array([7, 7, 7]);
    editTalkingVideoMock.mockResolvedValue({
      bytes: edited,
      durationSeconds: 7.2,
    });

    await settleWithMedia("job-1", AVATAR_URL, undefined, "fal-1");

    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(editTalkingVideoMock).toHaveBeenCalledWith({
      clip: new Uint8Array([9]),
      words: WORDS,
      clipSeconds: 9,
      hookLine: "Stop the scroll",
    });
    expect(putMock).toHaveBeenCalledWith(
      expect.any(String),
      edited,
      expect.objectContaining({ contentType: "video/mp4" }),
    );
  });

  it("sends the clip on for a cut-out when the site's screenshot is stored", async () => {
    jobFindUniqueMock.mockResolvedValue({
      ...row,
      settings: { ...row.settings, siteShots: true, sitePagePathname: SITE },
    });
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-2" });

    await settleWithMedia("job-1", AVATAR_URL, undefined, "fal-1");

    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "veed/video-background-removal/fast",
        input: { video_url: AVATAR_URL, output_codec: "h264" },
      }),
    );
    expect(jobUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          falRequestId: "fal-2",
          pendingMediaUrl: AVATAR_URL,
        }),
      }),
    );
    expect(downloadMediaMock).not.toHaveBeenCalled();
  });

  it("edits the clip with its matte, the site and the end card once the cut-out is back", async () => {
    jobFindUniqueMock.mockResolvedValue({
      ...row,
      falRequestId: "fal-2",
      pendingMediaUrl: AVATAR_URL,
      settings: { ...row.settings, siteShots: true, sitePagePathname: SITE },
    });
    fetchQueueResultMock.mockResolvedValue({
      kind: "media",
      media: [{ url: COLOUR_URL }, { url: ALPHA_URL }],
    });
    downloadMediaMock.mockImplementation(async (url: string) => ({
      bytes: new Uint8Array([url === ALPHA_URL ? 2 : 9]),
      contentType: "video/mp4",
    }));
    readAssetBytesMock.mockResolvedValue(new Uint8Array([3]));
    const endCard = { logo: new Uint8Array([4]), dark: true, text: "x.com" };
    loadEndCardMock.mockResolvedValue(endCard);
    editTalkingVideoMock.mockResolvedValue({
      bytes: new Uint8Array([7]),
      durationSeconds: 8.9,
    });

    await settleWithMedia("job-1", COLOUR_URL, undefined, "fal-2");

    // The clip that is edited is the presenter's, not the cut-out's colour file.
    expect(downloadMediaMock).toHaveBeenCalledWith(
      AVATAR_URL,
      expect.any(Number),
      "video/mp4",
    );
    expect(editTalkingVideoMock).toHaveBeenCalledWith({
      clip: new Uint8Array([9]),
      words: WORDS,
      clipSeconds: 9,
      hookLine: "Stop the scroll",
      site: { alpha: new Uint8Array([2]), page: new Uint8Array([3]) },
      endCard,
    });
    expect(readAssetBytesMock).toHaveBeenCalledWith(SITE);
  });

  it("lays the clip and the music in once they are made", async () => {
    jobFindUniqueMock.mockResolvedValue({
      ...row,
      model: "heygen/avatar-6/turbo/image-to-video",
      prompt: SCRIPT,
      chargedCents: convertCreditsToCents(112),
      settings: {
        ...row.settings,
        broll: true,
        brollRequestId: "fal-broll",
        music: true,
        musicRequestId: "fal-music",
      },
    });
    fetchQueueResultMock.mockImplementation(
      async ({ requestId }: { requestId: string }) => ({
        kind: "media",
        media: [{ url: `https://v3b.fal.media/files/${requestId}` }],
      }),
    );
    downloadMediaMock.mockImplementation(async (url: string) => ({
      bytes: new Uint8Array([
        url.endsWith("broll") ? 5 : url.endsWith("music") ? 6 : 9,
      ]),
      contentType: "video/mp4",
    }));
    editTalkingVideoMock.mockResolvedValue({
      bytes: new Uint8Array([7]),
      durationSeconds: 7.2,
    });

    await settleWithMedia("job-1", AVATAR_URL, undefined, "fal-1");

    expect(editTalkingVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        broll: new Uint8Array([5]),
        music: new Uint8Array([6]),
      }),
    );
    expect(jobUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ chargedCents: expect.anything() }),
      }),
    );
  });

  it("edits without an extra that failed and takes it off the charge", async () => {
    jobFindUniqueMock.mockResolvedValue({
      ...row,
      model: "heygen/avatar-6/turbo/image-to-video",
      prompt: SCRIPT,
      chargedCents: convertCreditsToCents(112),
      settings: {
        ...row.settings,
        broll: true,
        brollRequestId: "fal-broll",
        music: true,
        musicRequestId: "fal-music",
      },
    });
    fetchQueueResultMock.mockImplementation(
      async ({ requestId }: { requestId: string }) =>
        requestId === "fal-broll"
          ? { kind: "error", message: "runner crashed" }
          : {
              kind: "media",
              media: [{ url: "https://v3b.fal.media/files/music" }],
            },
    );
    editTalkingVideoMock.mockResolvedValue({
      bytes: new Uint8Array([7]),
      durationSeconds: 7.2,
    });

    await settleWithMedia("job-1", AVATAR_URL, undefined, "fal-1");

    expect(editTalkingVideoMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ broll: expect.anything() }),
    );
    // 52 for the video and 10 for the music; the clip's 50 are gone.
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { chargedCents: convertCreditsToCents(62) },
      }),
    );
  });

  it("stores the clip as it came when the edit fails", async () => {
    editTalkingVideoMock.mockRejectedValue(new Error("ffmpeg exited with 1"));
    const logged = expectCoreLog(
      "warn",
      "Delivered a talking video without its edit",
    );

    await settleWithMedia("job-1", AVATAR_URL, undefined, "fal-1");

    expect(putMock).toHaveBeenCalledWith(
      expect.any(String),
      new Uint8Array([9]),
      expect.anything(),
    );
    expect(logged).toHaveLength(1);
  });
});

describe("the caption step failing", () => {
  it("delivers the video without captions instead of failing the job", async () => {
    const pendingMediaUrl = "https://v3b.fal.media/files/avatar.mp4";
    jobFindUniqueMock.mockResolvedValue({
      id: "job-1",
      kind: "TALKING_VIDEO",
      status: "RUNNING",
      projectId: "project-1",
      requestedByUserId: "user-1",
      falRequestId: "fal-2",
      idempotencyKey: "key-abcdefgh",
      pendingMediaUrl,
      settings: {},
      asset: null,
    });
    // Stop at the download: storing is the image job's own, tested path.
    downloadMediaMock.mockRejectedValue(new Error("stop at the download"));
    jobUpdateMock.mockResolvedValue({
      statusUnreachableSince: null,
      resultUnreachableSince: null,
      authUnreachableSince: null,
    });
    const logged = expectCoreLog(
      "warn",
      "Delivered a talking video without captions",
    );

    await failImageJob("job-1", "provider_error", "runner crashed");

    expect(downloadMediaMock).toHaveBeenCalledWith(
      pendingMediaUrl,
      expect.any(Number),
      "video/mp4",
    );
    expect(jobUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(logged).toHaveLength(1);
  });
});

describe("the caption step being cancelled", () => {
  it("delivers the video the presenter model already made", async () => {
    const pendingMediaUrl = "https://v3b.fal.media/files/avatar.mp4";
    jobFindUniqueMock.mockResolvedValue({
      id: "job-1",
      kind: "TALKING_VIDEO",
      status: "RUNNING",
      model: "heygen/avatar-6/turbo/image-to-video",
      projectId: "project-1",
      requestedByUserId: "user-1",
      falRequestId: "fal-2",
      idempotencyKey: "key-abcdefgh",
      cancelRequestedAt: new Date(),
      pendingMediaUrl,
      settings: {},
      asset: null,
    });
    fetchQueueStatusMock.mockResolvedValue({ kind: "not_found" });
    // Stop at the download: storing is the image job's own, tested path.
    downloadMediaMock.mockRejectedValue(new Error("stop at the download"));
    jobUpdateMock.mockResolvedValue({
      statusUnreachableSince: null,
      resultUnreachableSince: null,
      authUnreachableSince: null,
    });
    const logged = expectCoreLog(
      "warn",
      "Delivered a talking video without captions",
    );

    await reconcileJob("job-1");

    expect(downloadMediaMock).toHaveBeenCalledWith(
      pendingMediaUrl,
      expect.any(Number),
      "video/mp4",
    );
    expect(jobUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELED" }),
      }),
    );
    expect(logged).toHaveLength(1);
  });
});
