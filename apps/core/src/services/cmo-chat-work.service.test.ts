import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, liveResources, ensureFile, publicUrl, cuso } = vi.hoisted(() => ({
  db: {
    sokoBotToolCall: { findMany: vi.fn() },
    sokoBot: { findUniqueOrThrow: vi.fn() },
    projectImageJob: { findMany: vi.fn() },
  },
  liveResources: vi.fn(),
  ensureFile: vi.fn(),
  publicUrl: vi.fn(),
  cuso: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/lib/drive-blob", () => ({ publicDriveUrl: publicUrl }));
vi.mock("@/services/cmo-cuso.service", () => ({ requireCuso: cuso }));
vi.mock("@/services/cmo-media-maker.service", () => ({
  CMO_STYLE_PASSED: "Style passed",
  CMO_STYLE_REJECTED: "Style check: ",
}));
vi.mock("@/services/file-search.service", () => ({
  loadLiveResources: liveResources,
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  ensureStudioAssetDriveFile: ensureFile,
}));

import { listCmoChatWork } from "./cmo-chat-work.service";

const TURN = "01a1f0eb-1488-76ff-835f-5d99fc1b0792";
const target = { userId: "user-1", projectId: "project-1" };
const now = new Date("2026-11-18T12:00:00Z");

function call(
  id: string,
  capability: string,
  extra: { input?: unknown; result?: unknown } = {},
) {
  return {
    id,
    turnId: TURN,
    toolCallId: `call-${id}`,
    capability,
    createdAt: now,
    input: extra.input ?? null,
    result: extra.result ?? null,
  };
}

function job(
  id: string,
  callId: string,
  status: string,
  extra: Partial<{
    error: string | null;
    referenceLibraryIds: string[];
    key: string;
    createdAt: Date;
  }> = {},
) {
  return {
    id,
    status,
    prompt: "A square picture of NMKR Pay",
    error: extra.error ?? null,
    asset: status === "SUCCEEDED" ? { id: `asset-${id}` } : null,
    idempotencyKey: extra.key ?? `soko-bot:${TURN}:call-${callId}`,
    referenceLibraryIds: extra.referenceLibraryIds ?? [],
    createdAt: extra.createdAt ?? now,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now });
  vi.clearAllMocks();
  cuso.mockResolvedValue({
    sokoBotId: "bot-1",
    projectId: "project-1",
    workspaceId: "ws-1",
  });
  db.sokoBot.findUniqueOrThrow.mockResolvedValue({
    workspace: { organizationId: "org-1" },
  });
  db.projectImageJob.findMany.mockResolvedValue([]);
  liveResources.mockResolvedValue([]);
  ensureFile.mockImplementation(async ({ jobId }: { jobId: string }) => ({
    pathname: `drive/${jobId}.jpg`,
  }));
  publicUrl.mockImplementation(
    async (pathname: string) => `https://blob/${pathname}`,
  );
});

describe("listCmoChatWork", () => {
  it("reads only this Cuso's finished tool calls", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([]);

    await expect(listCmoChatWork(target)).resolves.toEqual([]);
    expect(cuso).toHaveBeenCalledWith(target);
    expect(db.sokoBotToolCall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "COMPLETED",
          turn: expect.objectContaining({ sokoBotId: "bot-1" }),
        }),
      }),
    );
  });

  it("shows a picture as being made until its job is done, then the file", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("a", "generate_image"),
      call("b", "generate_video"),
    ]);
    db.projectImageJob.findMany.mockResolvedValue([
      job("job-a", "a", "RUNNING"),
      job("job-b", "b", "SUCCEEDED"),
    ]);

    await expect(listCmoChatWork(target)).resolves.toEqual([
      {
        id: "a",
        kind: "image",
        state: "making",
        at: now,
        title: "A square picture of NMKR Pay",
        url: null,
      },
      {
        id: "b",
        kind: "video",
        state: "ready",
        at: now,
        title: "A square picture of NMKR Pay",
        url: "https://blob/drive/job-b.jpg",
      },
    ]);
    expect(ensureFile).toHaveBeenCalledTimes(1);
    expect(ensureFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        workspaceId: "ws-1",
        organizationId: "org-1",
        assetId: "asset-job-b",
        jobId: "job-b",
      }),
    );
  });

  it("says a failed job failed, and gives up on one that never finishes", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("a", "generate_image"),
      call("b", "generate_talking_video"),
    ]);
    db.projectImageJob.findMany.mockResolvedValue([
      job("job-a", "a", "FAILED"),
      job("job-b", "b", "RUNNING", {
        createdAt: new Date(now.getTime() - 61 * 60 * 1000),
      }),
    ]);

    const items = await listCmoChatWork(target);
    expect(items.map((item) => [item.kind, item.state, item.url])).toEqual([
      ["image", "failed", null],
      ["video", "failed", null],
    ]);
  });

  it("holds a styled picture back until its check passed, and follows the next try", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("a", "generate_image"),
      call("b", "generate_image"),
      call("c", "generate_image"),
    ]);
    const styled = { referenceLibraryIds: ["ref-1"] };
    db.projectImageJob.findMany.mockResolvedValue([
      job("unchecked", "a", "SUCCEEDED", styled),
      job("passed", "b", "SUCCEEDED", { ...styled, error: "Style passed" }),
      job("turned-down", "c", "SUCCEEDED", {
        ...styled,
        error: "Style check: wrong look",
      }),
      job("next-try", "c", "RUNNING", {
        ...styled,
        key: `soko-bot:${TURN}:call-c:style:2`,
      }),
    ]);

    const items = await listCmoChatWork(target);
    expect(items.map((item) => [item.id, item.state, item.url])).toEqual([
      ["a", "making", null],
      ["b", "ready", "https://blob/drive/passed.jpg"],
      ["c", "making", null],
    ]);
  });

  it("never mixes up calls whose ids start alike", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("1", "generate_image"),
    ]);
    db.projectImageJob.findMany.mockResolvedValue([
      job("other", "10", "SUCCEEDED"),
    ]);

    await expect(listCmoChatWork(target)).resolves.toEqual([]);
  });

  it("plays a voice-over from the owner's file, with the words spoken", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("v", "generate_voiceover", {
        input: { text: "NMKR Studio makes minting simple." },
        result: { id: "file-1", filename: "intro.mp3" },
      }),
      call("gone", "generate_voiceover", {
        result: { id: "file-deleted", filename: "old.mp3" },
      }),
    ]);
    liveResources.mockResolvedValue([
      { id: "file-1", sourceId: "drive/intro.mp3" },
    ]);

    await expect(listCmoChatWork(target)).resolves.toEqual([
      {
        id: "v",
        kind: "audio",
        state: "ready",
        at: now,
        title: "NMKR Studio makes minting simple.",
        url: "https://blob/drive/intro.mp3",
      },
    ]);
    expect(liveResources).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        actor: { userId: "user-1", organizationId: "org-1", kind: "oauth" },
        resourceIds: ["file-1", "file-deleted"],
      }),
    );
  });

  it("says so when a finished file cannot be shown", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("a", "generate_image"),
    ]);
    db.projectImageJob.findMany.mockResolvedValue([
      job("private", "a", "SUCCEEDED"),
    ]);
    publicUrl.mockResolvedValue(null);

    const [item] = await listCmoChatWork(target);
    expect(item).toMatchObject({ state: "failed", url: null });
  });
});
