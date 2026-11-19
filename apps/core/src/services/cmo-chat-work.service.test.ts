import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  db,
  liveResources,
  ensureFile,
  publicUrl,
  cuso,
  driveText,
  seoCheck,
  audits,
} = vi.hoisted(() => ({
  audits: vi.fn(),
  seoCheck: vi.fn(),
  db: {
    sokoBotToolCall: { findMany: vi.fn(), findFirst: vi.fn() },
    sokoBot: { findUniqueOrThrow: vi.fn() },
    projectImageJob: { findMany: vi.fn() },
    task: { findMany: vi.fn(), findFirst: vi.fn() },
    job: { findMany: vi.fn() },
  },
  liveResources: vi.fn(),
  ensureFile: vi.fn(),
  publicUrl: vi.fn(),
  cuso: vi.fn(),
  driveText: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/lib/drive-blob", () => ({ publicDriveUrl: publicUrl }));
vi.mock("@/services/cmo-cuso.service", () => ({
  requireCuso: cuso,
  CmoNotFoundError: class CmoNotFoundError extends Error {},
}));
vi.mock("@/services/soko-bot-runtime/drive-reading", () => ({
  isTextMimeType: (mime: string | null) => mime?.startsWith("text/") ?? false,
  readDriveText: driveText,
}));
vi.mock("@sokosumi/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/database")>()),
  jobInclude: {},
}));
// A status-mapped Job is the row itself here: the fixtures carry its fields.
vi.mock("@sokosumi/database/helpers", () => ({
  mapJobWithStatus: (row: unknown) => row,
}));
vi.mock("@/services/cmo-media-maker.service", () => ({
  CMO_STYLE_PASSED: "Style passed",
  CMO_STYLE_REJECTED: "Style check: ",
}));
vi.mock("@/services/cmo-seo-audit.service", () => ({
  listCmoSeoAuditRuns: audits,
}));
vi.mock("@/services/cmo-seo-rankings.service", () => ({
  readSeoCheck: seoCheck,
}));
vi.mock("@/services/file-search.service", () => ({
  loadLiveResources: liveResources,
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  ensureStudioAssetDriveFile: ensureFile,
}));

import { listCmoChatWork, readCmoChatWorkText } from "./cmo-chat-work.service";

const TURN = "01a1f0eb-1488-76ff-835f-5d99fc1b0792";
const target = { userId: "user-1", projectId: "project-1" };
const now = new Date("2026-11-18T12:00:00Z");

/** What only handed work has; a picture, video, voice-over or file has none. */
const alone = { by: null, text: null, readable: false, files: [] };

function call(
  id: string,
  capability: string,
  extra: { input?: unknown; result?: unknown; targetId?: string } = {},
) {
  return {
    id,
    turnId: TURN,
    toolCallId: `call-${id}`,
    capability,
    createdAt: now,
    input: extra.input ?? null,
    result: extra.result ?? null,
    targetId: extra.targetId ?? null,
  };
}

function task(
  id: string,
  status: string,
  extra: Partial<{
    assignee: { name: string } | null;
    events: {
      status: string | null;
      comment: string;
      coworkerId: string | null;
    }[];
    files: { name: string; fileUrl: string | null }[];
  }> = {},
) {
  return {
    id,
    name: "Research three trends",
    status,
    assignee:
      extra.assignee === undefined ? { name: "Hannah" } : extra.assignee,
    events: extra.events ?? [],
    files: extra.files ?? [],
  };
}

function agentJob(id: string, status: string, result: string | null) {
  return {
    id,
    name: null,
    status,
    input: null,
    inputSchema: null,
    result,
    agent: { name: "Market Scout" },
    events: [
      {
        id: "e1",
        status: "COMPLETED",
        result,
        inputSchema: null,
        blobs: [
          {
            status: "READY",
            fileUrl: "https://blob/scan.pdf",
            name: "scan.pdf",
            mimeType: "application/pdf",
          },
        ],
        links: [],
      },
    ],
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
  db.task.findMany.mockResolvedValue([]);
  db.job.findMany.mockResolvedValue([]);
  liveResources.mockResolvedValue([]);
  audits.mockResolvedValue([]);
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
        ...alone,
      },
      {
        id: "b",
        kind: "video",
        state: "ready",
        at: now,
        title: "A square picture of NMKR Pay",
        url: "https://blob/drive/job-b.jpg",
        ...alone,
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
        ...alone,
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

  it("shows work handed to a Coworker once, with where it stands", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("assign", "assign_task", { targetId: "task-1" }),
      call("create", "create_task", { targetId: "task-1" }),
      call("note", "create_task", { targetId: "task-2" }),
    ]);
    db.task.findMany.mockResolvedValue([
      task("task-1", "RUNNING"),
      task("task-2", "DRAFT", { assignee: null }),
    ]);

    await expect(listCmoChatWork(target)).resolves.toEqual([
      {
        id: "create",
        kind: "task",
        state: "making",
        at: now,
        title: "Research three trends",
        url: null,
        by: "Hannah",
        text: null,
        readable: false,
        files: [],
      },
    ]);
    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws-1",
          archivedAt: null,
        }),
      }),
    );
  });

  it("says what a Coworker asks, then what it came back with", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("a", "create_task", { targetId: "asks" }),
      call("b", "create_task", { targetId: "done" }),
      call("c", "create_task", { targetId: "failed" }),
    ]);
    db.task.findMany.mockResolvedValue([
      task("asks", "INPUT_REQUIRED", {
        events: [
          {
            status: "INPUT_REQUIRED",
            comment: "Brands in general, or only Cardano projects?",
            coworkerId: "hannah",
          },
        ],
      }),
      task("done", "COMPLETED", {
        events: [
          { status: null, comment: "Thanks!", coworkerId: null },
          {
            status: "COMPLETED",
            comment: "## Three trends\n\nLoyalty passes replace drops.",
            coworkerId: "hannah",
          },
        ],
        files: [{ name: "trends.pdf", fileUrl: "https://blob/trends.pdf" }],
      }),
      task("failed", "FAILED"),
    ]);

    const items = await listCmoChatWork(target);
    expect(
      items.map(({ state, text, readable, files }) => ({
        state,
        text,
        readable,
        files,
      })),
    ).toEqual([
      {
        state: "waiting",
        text: "Brands in general, or only Cardano projects?",
        readable: false,
        files: [],
      },
      {
        state: "ready",
        text: expect.stringContaining("Loyalty passes replace drops."),
        readable: true,
        files: [{ name: "trends.pdf", url: "https://blob/trends.pdf" }],
      },
      { state: "failed", text: null, readable: false, files: [] },
    ]);
  });

  it("shows a hired Agent's Job with its result and files", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("h", "hire_agent", {
        result: { executed: true, resultingEntityId: "job-1" },
      }),
      call("h2", "hire_agent", {
        result: { executed: true, resultingEntityId: "job-2" },
      }),
    ]);
    db.job.findMany.mockResolvedValue([
      agentJob("job-1", "completed", "Three trends stand out."),
      agentJob("job-2", "processing", null),
    ]);

    const items = await listCmoChatWork(target);
    expect(items).toMatchObject([
      {
        id: "h",
        kind: "agent",
        state: "ready",
        title: "Market Scout",
        by: "Market Scout",
        text: "Three trends stand out.",
        readable: true,
        files: [{ name: "scan.pdf", url: "https://blob/scan.pdf" }],
      },
      { id: "h2", kind: "agent", state: "making", text: null },
    ]);
    expect(db.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["job-1", "job-2"] }, workspaceId: "ws-1" },
      }),
    );
  });

  it("shows a check asked of the SEO specialist while it runs, with its result once done, and once", async () => {
    const CHECK = "01a1f0eb-1488-76ff-835f-5d99fc1b0001";
    const asked = (id: string, at = now) => ({
      ...call(id, "check_search_rankings", {
        input: { keywords: ["calendly alternative", "scheduling api"] },
        result: { status: "started", analysisId: CHECK },
      }),
      createdAt: at,
    });
    db.sokoBotToolCall.findMany.mockResolvedValue([
      // Asked again while it ran: the same check, shown where it was first asked.
      { ...asked("s2"), result: { status: "running", analysisId: CHECK } },
      asked("s1"),
      // Answered at once from the last day's check: nothing was handed on.
      call("s0", "check_search_rankings", {
        input: { keywords: ["cal.com"] },
        result: { status: "done", result: "position 1" },
      }),
    ]);
    const card = {
      id: "s1",
      kind: "seo",
      at: now,
      title:
        'Where you rank on Google for "calendly alternative", "scheduling api"',
      url: null,
      by: "The SEO specialist",
      files: [],
    };

    seoCheck.mockResolvedValue({ state: "running" });
    expect(await listCmoChatWork(target)).toEqual([
      { ...card, state: "making", text: null, readable: false },
    ]);
    expect(seoCheck).toHaveBeenCalledWith(CHECK);

    const outcome =
      'The SEO specialist checked Google on 2026-11-18 for https://cal.com/:\n- "calendly alternative" (mobile, US): not in the top 19, 880 searches a month. Top results: 1. zapier.com';
    seoCheck.mockResolvedValue({ state: "done", outcome });
    expect(await listCmoChatWork(target)).toEqual([
      {
        ...card,
        state: "ready",
        text: expect.stringContaining("not in the top 19"),
        readable: true,
      },
    ]);

    seoCheck.mockResolvedValue({
      state: "failed",
      outcome: "The SEO specialist's check failed. Nothing was charged for it.",
    });
    expect(await listCmoChatWork(target)).toEqual([
      {
        ...card,
        state: "failed",
        text: "The SEO specialist's check failed. Nothing was charged for it.",
        readable: false,
      },
    ]);
  });

  it("shows the SEO specialist's weekly audits among what Cuso handed on, newest first", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("f1", "upload_file", { targetId: "file-1" }),
    ]);
    liveResources.mockResolvedValue([
      {
        id: "file-1",
        sourceId: "drive/brief.md",
        displayName: "Brief.md",
        mimeType: "text/markdown",
      },
    ]);
    const audit = (id: string, daysAgo: number, rest: object) => ({
      id,
      startedAt: new Date(now.getTime() - daysAgo * 86_400_000),
      ...rest,
    });
    audits.mockResolvedValue([
      audit("a3", -1, { state: "running", found: null }),
      audit("a2", 7, {
        state: "done",
        found: { checked: 110, passed: 86, fixes: 5 },
      }),
      audit("a1", 14, { state: "failed", found: null }),
    ]);

    const items = await listCmoChatWork(target);

    expect(audits).toHaveBeenCalledWith(
      "project-1",
      new Date(now.getTime() - 30 * 86_400_000),
    );
    expect(
      items.map((item) => [item.id, item.kind, item.state, item.text]),
    ).toEqual([
      ["audit-a3", "audit", "making", null],
      ["f1", "file", "ready", null],
      [
        "audit-a2",
        "audit",
        "ready",
        "86 of 110 checks passed. 5 things to fix are in your SEO tab.",
      ],
      [
        "audit-a1",
        "audit",
        "failed",
        "The audit did not finish, so nothing was charged. The next one runs on schedule.",
      ],
    ]);
    expect(items[0]).toMatchObject({
      title: "Weekly audit of your site",
      by: "The SEO specialist",
      readable: false,
    });
  });

  it("shows the audits when Cuso started nothing himself", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([]);
    audits.mockResolvedValue([
      {
        id: "a1",
        startedAt: now,
        state: "done",
        found: { checked: 50, passed: 50, fixes: 0 },
      },
    ]);
    expect(await listCmoChatWork(target)).toMatchObject([
      {
        id: "audit-a1",
        text: "50 of 50 checks passed. Nothing to fix this week.",
      },
    ]);
  });

  it("gives up on a check that is still running after an hour", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      {
        ...call("s1", "check_search_rankings", {
          input: { keywords: ["calendly alternative"] },
          result: {
            status: "started",
            analysisId: "01a1f0eb-1488-76ff-835f-5d99fc1b0001",
          },
        }),
        createdAt: new Date(Date.now() - 61 * 60 * 1000),
      },
    ]);
    seoCheck.mockResolvedValue({ state: "running" });
    expect(await listCmoChatWork(target)).toMatchObject([
      { kind: "seo", state: "failed", text: null },
    ]);
  });

  it("shows a file Cuso wrote, to read when it is text", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("f", "upload_file", { targetId: "file-1" }),
      call("again", "upload_file", { targetId: "file-1" }),
      call("gone", "upload_file", { targetId: "file-deleted" }),
    ]);
    liveResources.mockResolvedValue([
      {
        id: "file-1",
        displayName: "Launch brief.md",
        mimeType: "text/markdown",
        sourceId: "drive/brief.md",
      },
    ]);

    await expect(listCmoChatWork(target)).resolves.toEqual([
      {
        id: "again",
        kind: "file",
        state: "ready",
        at: now,
        title: "Launch brief.md",
        url: "https://blob/drive/brief.md",
        ...alone,
        readable: true,
      },
    ]);
  });
});

describe("readCmoChatWorkText", () => {
  const read = { ...target, id: "call-row" };

  it("reads only a call of this Cuso", async () => {
    db.sokoBotToolCall.findFirst.mockResolvedValue(null);

    await expect(readCmoChatWorkText(read)).rejects.toThrow(
      "There is nothing to read here yet",
    );
    expect(db.sokoBotToolCall.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "call-row",
          turn: { sokoBotId: "bot-1" },
        }),
      }),
    );
  });

  it("gives a finished Task's whole result", async () => {
    db.sokoBotToolCall.findFirst.mockResolvedValue(
      call("a", "create_task", { targetId: "task-1" }),
    );
    db.task.findFirst.mockResolvedValue(
      task("task-1", "COMPLETED", {
        events: [
          {
            status: "COMPLETED",
            comment: "## Three trends\n\nAll of it.",
            coworkerId: "hannah",
          },
        ],
      }),
    );

    await expect(readCmoChatWorkText(read)).resolves.toBe(
      "## Three trends\n\nAll of it.",
    );
    expect(db.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "task-1",
          workspaceId: "ws-1",
          status: "COMPLETED",
        }),
      }),
    );
  });

  it("gives a finished SEO check's whole result, and nothing while it runs", async () => {
    db.sokoBotToolCall.findFirst.mockResolvedValue(
      call("s1", "check_search_rankings", {
        result: {
          status: "started",
          analysisId: "01a1f0eb-1488-76ff-835f-5d99fc1b0001",
        },
      }),
    );
    seoCheck.mockResolvedValueOnce({ state: "running" });
    await expect(readCmoChatWorkText({ ...target, id: "s1" })).rejects.toThrow(
      "There is nothing to read here yet",
    );
    seoCheck.mockResolvedValueOnce({ state: "done", outcome: "position 4" });
    expect(await readCmoChatWorkText({ ...target, id: "s1" })).toBe(
      "position 4",
    );
  });

  it("gives a hired Agent's whole result and a file's words", async () => {
    db.sokoBotToolCall.findFirst.mockResolvedValueOnce(
      call("h", "hire_agent", { result: { resultingEntityId: "job-1" } }),
    );
    db.job.findMany.mockResolvedValue([
      agentJob("job-1", "completed", "The whole report."),
    ]);
    await expect(readCmoChatWorkText(read)).resolves.toBe("The whole report.");

    db.sokoBotToolCall.findFirst.mockResolvedValueOnce(
      call("f", "upload_file", { targetId: "file-1" }),
    );
    liveResources.mockResolvedValue([{ id: "file-1" }]);
    driveText.mockResolvedValue("# Launch brief");
    await expect(readCmoChatWorkText(read)).resolves.toBe("# Launch brief");
  });
});
