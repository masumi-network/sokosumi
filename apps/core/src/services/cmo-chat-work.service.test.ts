import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  db,
  liveResources,
  ensureFile,
  publicUrl,
  cuso,
  driveText,
  records,
  recordText,
  seoWork,
  seoText,
  recordTable,
} = vi.hoisted(() => ({
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
  records: vi.fn(),
  recordText: vi.fn(),
  seoWork: vi.fn(),
  seoText: vi.fn(),
  recordTable: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: db, networkPrisma: () => db }));
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
  cmoStylePassed: (error: string | null) =>
    error?.startsWith("Style passed") ?? false,
}));
// Records (tables, contacts, runs, questions) have their own tests.
vi.mock("@/services/cmo-chat-records.service", () => ({
  listCmoChatRecords: records,
  readCmoChatRecordText: recordText,
  readCmoChatTable: recordTable,
}));
vi.mock("@/services/cmo-chat-seo.service", () => ({
  listCmoChatSeoWork: seoWork,
  readCmoChatSeoText: seoText,
}));
vi.mock("@/services/file-search.service", () => ({
  loadLiveResources: liveResources,
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  ensureStudioAssetDriveFile: ensureFile,
}));

import {
  listCmoChatWork,
  readCmoChatWorkTable,
  readCmoChatWorkText,
} from "./cmo-chat-work.service";

const TURN = "01a1f0eb-1488-76ff-835f-5d99fc1b0792";
const target = { userId: "user-1", projectId: "project-1" };
const now = new Date("2026-11-18T12:00:00Z");

/** What only handed work has; a picture, video, voice-over or file has none. */
const alone = {
  by: null,
  text: null,
  readable: false,
  files: [],
  table: null,
  people: [],
  total: null,
  steps: [],
  turnId: null,
};

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
  records.mockResolvedValue([]);
  recordText.mockResolvedValue(null);
  seoWork.mockResolvedValue([]);
  seoText.mockResolvedValue(null);
  recordTable.mockResolvedValue(null);
  db.task.findMany.mockResolvedValue([]);
  db.job.findMany.mockResolvedValue([]);
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
        ...alone,
        by: "Hannah",
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

describe("records in the chat work list", () => {
  const run = {
    id: "run-1",
    kind: "run" as const,
    state: "making" as const,
    at: new Date("2026-11-18T12:30:00Z"),
    title: "Results log",
    ...alone,
    turnId: "run-1",
  };

  it("lists a record beside what Cuso made, newest first", async () => {
    records.mockResolvedValue([run]);
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("v", "generate_voiceover", {
        result: { id: "file-1", filename: "intro.mp3" },
      }),
    ]);
    liveResources.mockResolvedValue([
      { id: "file-1", sourceId: "drive/intro.mp3" },
    ]);

    const items = await listCmoChatWork(target);
    expect(items.map((item) => item.kind)).toEqual(["run", "audio"]);
    expect(items[0]).toEqual({ ...run, url: null, files: [] });
  });

  it("lists records when Cuso made nothing else", async () => {
    records.mockResolvedValue([run]);
    db.sokoBotToolCall.findMany.mockResolvedValue([]);

    await expect(listCmoChatWork(target)).resolves.toHaveLength(1);
  });

  it("reads a run's report or a Coworker's answer when no call matches", async () => {
    db.sokoBotToolCall.findFirst.mockResolvedValue(null);
    recordText.mockResolvedValue("Four weeks are in the table.");

    await expect(readCmoChatWorkText({ ...target, id: "run-1" })).resolves.toBe(
      "Four weeks are in the table.",
    );
    expect(recordText).toHaveBeenCalledWith(
      expect.objectContaining({ sokoBotId: "bot-1" }),
      "run-1",
    );
  });

  it("lists the SEO specialist's work among the rest, newest first", async () => {
    const check = {
      id: "s1",
      kind: "seo" as const,
      state: "making" as const,
      at: new Date(now.getTime() + 60_000),
      title: 'Where you rank on Google for "calendly alternative"',
      by: "The SEO specialist",
      text: null,
      readable: false,
    };
    const audit = {
      ...check,
      id: "audit-a1",
      kind: "audit" as const,
      state: "ready" as const,
      at: new Date(now.getTime() - 86_400_000),
      title: "Weekly audit of your site",
      text: "86 of 110 checks passed. 5 things to fix are in your SEO tab.",
    };
    seoWork.mockResolvedValue([audit, check]);
    records.mockResolvedValue([run]);

    const items = await listCmoChatWork(target);

    expect(seoWork).toHaveBeenCalledWith(
      expect.objectContaining({ sokoBotId: "bot-1", projectId: "project-1" }),
    );
    expect(items.map((item) => item.id)).toEqual([run.id, "s1", "audit-a1"]);
    expect(items[1]).toEqual({
      ...check,
      url: null,
      files: [],
      table: null,
      people: [],
      total: null,
      steps: [],
      turnId: null,
    });
  });

  it("reads a finished position check when neither a call nor a record matches", async () => {
    db.sokoBotToolCall.findFirst.mockResolvedValue(null);
    seoText.mockResolvedValue("position 4");

    await expect(readCmoChatWorkText({ ...target, id: "s1" })).resolves.toBe(
      "position 4",
    );
  });

  it("opens a whole table, or says it is gone", async () => {
    const table = { columns: ["Week"], rows: [["45"]], total: 1 };
    recordTable.mockResolvedValueOnce({ title: "Results log", table });
    await expect(
      readCmoChatWorkTable({ ...target, id: "call-1" }),
    ).resolves.toEqual({ title: "Results log", table });

    await expect(
      readCmoChatWorkTable({ ...target, id: "call-1" }),
    ).rejects.toThrow("This table is no longer there");
  });
});
