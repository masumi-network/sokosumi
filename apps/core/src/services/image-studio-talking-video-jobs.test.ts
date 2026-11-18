import { convertCreditsToCents } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";

/**
 * A talking video rides the image job's row, lease, quote and webhook. What is
 * new is that one row carries two provider requests: the presenter model, then
 * the captions.
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
}));
vi.mock("@/lib/image-studio/reference-files", () => ({
  requireStudioReferenceFiles: vi.fn(
    async ({ resourceIds }: { resourceIds: string[] }) => resourceIds,
  ),
}));
vi.mock("@/lib/soko-bot/voiceover", () => ({
  speakVoiceover: speakVoiceoverMock,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: vi.fn(),
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
  putMock.mockResolvedValue({
    pathname: "projects/project-1/image-studio/job-1-voice.mp3",
  });
  uploadReferenceMock.mockResolvedValue(
    "https://v3b.fal.media/files/voice.mp3",
  );
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
        },
        // 10 s at $0.181, plus the voice and the captions.
        chargedCents: convertCreditsToCents(183),
      }),
    });
    expect(speakVoiceoverMock).toHaveBeenCalledWith({
      text: SCRIPT,
      voice: "Sarah",
      languageCode: "en",
    });
    // The spoken length replaces the quoted one; the quote stays as shown.
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          voiceBlobPathname: "projects/project-1/image-studio/job-1-voice.mp3",
          settings: expect.objectContaining({ durationSeconds: 9 }),
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

  it("sends it on for captions and moves the row to that request", async () => {
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
