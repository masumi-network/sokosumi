import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { writeWorkspaceFile } from "@/soko-bot-runner/local-tools";
import { ACTION_CAPABILITIES } from "./action-receipts";
import { buildActionResponse } from "./action-response";
import { sandboxActionEvidence } from "./sandbox-action-evidence";
import { finishTurn, RuntimeEventLog } from "./turn-loop";

const db = vi.hoisted(() => ({
  sokoBotToolCall: { findMany: vi.fn(), count: vi.fn() },
  sokoBotTurn: { findUnique: vi.fn(), update: vi.fn() },
  sokoBotMemoryRevision: { findFirst: vi.fn() },
  task: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

const directory = `.workspace-confirmation-${randomUUID()}`;
const filename = `${directory}/totals.csv`;
const narrative = {
  kind: "REPORT",
  message: "The total is 42.",
  question: null,
  observationToolCallIds: [],
};

function storedWrite(result: unknown, status = "COMPLETED") {
  return {
    id: randomUUID(),
    turnId: "turn-workspace",
    capability: "workspace_write",
    input: { path: filename },
    result,
    status,
    disposition: "NOT_APPLIED",
    verification: "NONE",
    committedAt: null,
    targetId: null,
    actorBotId: null,
    replayedReceiptId: null,
  };
}

function store(calls: ReturnType<typeof storedWrite>[]) {
  db.sokoBotToolCall.findMany.mockImplementation(async ({ where }) =>
    calls.filter((call) => where.capability.in.includes(call.capability)),
  );
}

describe("workspace writes in canonical action responses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.task.findMany.mockResolvedValue([]);
    db.sokoBotToolCall.count.mockResolvedValue(0);
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "CHAT",
      versionId: "v40",
      sokoBotId: "bot-workspace",
      contextSnapshot: null,
    });
  });
  afterAll(() => rm(directory, { recursive: true, force: true }));

  it("confirms the real runner result without treating it as a Core transaction receipt", async () => {
    const content = "item,total\nA,42\n";
    const output = await writeWorkspaceFile({ path: filename, content });
    expect(await readFile(filename, "utf8")).toBe(content);
    expect(output).toEqual({
      path: filename,
      bytes: Buffer.byteLength(content),
    });
    store([
      storedWrite(
        sandboxActionEvidence({
          name: "workspace_write",
          output: JSON.stringify(output),
          sources: [],
        }),
      ),
    ]);
    const result = await buildActionResponse(
      prisma,
      "turn-workspace",
      "Done",
      true,
      narrative,
    );
    expect(result.answerText).toContain("Saved workspace file:");
    expect(result.answerText).toContain("totals.csv");
    expect(result.answerText).toMatch(/\n\nThe total is 42\.$/);
    expect(result.appliedReceiptIds).toEqual([]);
    expect(result.unfulfilledActions).toEqual([]);
    expect(db.sokoBotToolCall.findMany).toHaveBeenCalledTimes(1);
    expect(db.sokoBotToolCall.findMany).toHaveBeenCalledWith({
      where: {
        turnId: "turn-workspace",
        capability: { in: [...ACTION_CAPABILITIES, "workspace_write"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(ACTION_CAPABILITIES.has("workspace_write")).toBe(false);
  });

  it("keeps correct totals but drops a stale file confirmation after a failed rewrite", async () => {
    const success = storedWrite({
      output: JSON.stringify({ path: filename, bytes: 42 }),
      sources: [],
    });
    store([
      success,
      storedWrite(
        { output: '{"error":"write failed"}', sources: [] },
        "FAILED",
      ),
    ]);
    const result = await buildActionResponse(
      prisma,
      "turn-workspace",
      "Done",
      true,
      narrative,
    );
    expect(result.answerText).toBe("The total is 42.");
    expect(result.unfulfilledActions).toEqual([]);
  });

  it.each(["SCHEDULE", "EVENT", null])(
    "does not append local file bookkeeping to %s turns",
    async (source) => {
      db.sokoBotTurn.findUnique.mockResolvedValue({
        source,
        versionId: "v40",
        sokoBotId: "bot-workspace",
        contextSnapshot: null,
      });
      store([
        storedWrite({
          output: JSON.stringify({ path: filename, bytes: 42 }),
          sources: [],
        }),
      ]);
      const result = await buildActionResponse(
        prisma,
        "turn-workspace",
        "Done",
        true,
        narrative,
      );
      expect(result.answerText).toBe("The total is 42.");
    },
  );

  it("leaves a Cuso report card as the only action report", async () => {
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "CHAT",
      versionId: "cmo-v1",
      sokoBotId: "bot-workspace",
      contextSnapshot: null,
    });
    db.sokoBotToolCall.count.mockResolvedValue(1);
    store([
      storedWrite({
        output: JSON.stringify({ path: filename, bytes: 42 }),
        sources: [],
      }),
    ]);
    const result = await buildActionResponse(
      prisma,
      "turn-workspace",
      "Done",
      true,
      narrative,
    );
    expect(result.answerText).toBe("The total is 42.");
  });

  it.each([
    "https://example.test/file.csv",
    "notes`https://example.test/file.csv",
    "notes````https://example.test/file.csv",
  ])(
    "keeps %s as filename data through completion and canonical rebuilding",
    async (path) => {
      store([
        {
          ...storedWrite({
            output: JSON.stringify({ path, bytes: 42 }),
            sources: [],
          }),
          input: { path },
        },
      ]);
      const createEvent = vi.fn();
      db.$transaction.mockImplementation(async (operation) =>
        operation({
          $executeRaw: vi.fn(),
          sokoBotRuntimeEvent: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: createEvent,
          },
        }),
      );
      await finishTurn({
        log: new RuntimeEventLog("turn-workspace", "session-workspace"),
        turnId: "turn-workspace",
        text: JSON.stringify({ ...narrative, message: null }),
        finishReason: "stop",
        requiresActionProof: true,
      });
      const saved =
        db.sokoBotTurn.update.mock.calls[0][0].data.responseContract;
      const rebuilt = await buildActionResponse(
        prisma,
        "turn-workspace",
        saved.answerText,
        true,
        saved.narrative,
      );
      expect(saved.answerText).toContain(JSON.stringify(path));
      expect(saved.answerText).not.toContain("I removed");
      expect(rebuilt.answerText).toBe(saved.answerText);
      expect(createEvent.mock.calls[0][0].data.data.message).toBe(
        saved.answerText,
      );
    },
  );
});
