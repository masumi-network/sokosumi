import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolve, calls, upsert, jobInput } = vi.hoisted(() => ({
  resolve: vi.fn(),
  calls: vi.fn(),
  upsert: vi.fn(),
  jobInput: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: { findMany: calls, upsert },
    jobInput: { findUnique: jobInput },
  },
}));
vi.mock("@/services/chat-result-preview.service", () => ({
  resolveChatResultReference: resolve,
}));

import prisma from "@/lib/db/prisma";
import { prepareTurnActionResultPreviews } from "./turn-action-result-previews.service";

const turn = {
  userId: "owner",
  workspaceId: "workspace",
  versionId: "v21",
  requestedByUserId: null,
  chainDepth: 0,
};
const tx = prisma;
const receipt = {
  id: "receipt",
  capability: "create_task",
  status: "COMPLETED",
  targetId: "task",
  disposition: "APPLIED",
  verification: "LOCAL_TRANSACTION",
  committedAt: new Date(),
  result: null,
};
describe("automatic result previews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.mockResolvedValue([]);
    upsert.mockResolvedValue({});
    resolve.mockResolvedValue({
      workspaceId: "workspace",
      reference: { kind: "task", id: "task" },
      data: { id: "card" },
    });
  });
  it("prepares one final-state card when creation and assignment omitted the preview tool", async () => {
    calls.mockResolvedValue([
      receipt,
      { ...receipt, capability: "assign_task" },
    ]);
    await prepareTurnActionResultPreviews("turn", turn, tx);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: { kind: "task", id: "task" },
        actor: { userId: "owner", workspaceId: "workspace", kind: "soko_bot" },
      }),
      tx,
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          capability: "preview_result",
          status: "COMPLETED",
        }),
      }),
    );
  });
  it("refreshes the first explicit card after later actions without creating a duplicate", async () => {
    const snapshot = {
      workspaceId: "workspace",
      reference: { kind: "task", id: "task" },
      data: {
        id: "550e8400-e29b-41d4-a716-446655440010",
        state: "available",
        capturedAt: "2026-10-06T09:22:00.000Z",
        kind: "task",
        title: "Task",
        status: "DRAFT",
        sourceHref: "/tasks/task",
      },
    };
    calls.mockResolvedValue([
      {
        ...receipt,
        capability: "preview_result",
        toolCallId: "first-preview",
        result: snapshot,
      },
      {
        ...receipt,
        capability: "preview_result",
        toolCallId: "duplicate-preview",
        result: snapshot,
      },
      { ...receipt, capability: "assign_task" },
    ]);
    await prepareTurnActionResultPreviews("turn", turn, tx);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        previewId: snapshot.data.id,
      }),
      tx,
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          turnId_toolCallId: { turnId: "turn", toolCallId: "first-preview" },
        },
      }),
    );
  });

  it.each([
    ["schedule_social_post", "social_post"],
    ["generate_image", "studio_job"],
  ])(
    "resolves %s with the project from its persisted result",
    async (capability, kind) => {
      calls.mockResolvedValue([
        { ...receipt, capability, result: { projectId: "project" } },
      ]);
      await prepareTurnActionResultPreviews("turn", turn, tx);
      expect(resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: { kind, id: "task", projectId: "project" },
        }),
        tx,
      );
    },
  );

  it.each([
    { ...turn, versionId: "v19" },
    { ...turn, requestedByUserId: "colleague" },
    { ...turn, chainDepth: 1 },
  ])(
    "never widens old versions or another caller's access",
    async (context) => {
      await prepareTurnActionResultPreviews("turn", context, tx);
      expect(calls).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
    },
  );
  it("ignores failed, uncertain and unverified receipts", async () => {
    calls.mockResolvedValue([
      { ...receipt, status: "FAILED" },
      { ...receipt, disposition: "UNKNOWN" },
      { ...receipt, verification: "NONE" },
      { ...receipt, committedAt: null },
    ]);
    await prepareTurnActionResultPreviews("turn", turn, tx);
    expect(resolve).not.toHaveBeenCalled();
  });
  it("maps a verified JobInput receipt through its event to the owning job", async () => {
    calls.mockResolvedValue([
      {
        ...receipt,
        capability: "provide_job_input",
        targetId: "input-1",
        verification: "PROVIDER_ACK",
        result: {
          executed: true,
          status: "ACCEPTED",
          resultingEntityId: "input-1",
        },
      },
    ]);
    jobInput.mockResolvedValue({ event: { jobId: "job-1" } });
    await prepareTurnActionResultPreviews("turn", turn, tx);
    expect(jobInput).toHaveBeenCalledWith({
      where: { id: "input-1" },
      select: { event: { select: { jobId: true } } },
    });
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ reference: { kind: "job", id: "job-1" } }),
      tx,
    );
  });

  it("propagates preview write conflicts for settlement retry", async () => {
    calls.mockResolvedValue([receipt]);
    const conflict = Object.assign(new Error("Serialization conflict"), {
      code: "P2034",
    });
    upsert.mockRejectedValue(conflict);
    await expect(
      prepareTurnActionResultPreviews("turn", turn, tx),
    ).rejects.toBe(conflict);
  });

  it("propagates unexpected resolver failures", async () => {
    calls.mockResolvedValue([receipt]);
    const error = new Error("Database unavailable");
    resolve.mockRejectedValue(error);
    await expect(
      prepareTurnActionResultPreviews("turn", turn, tx),
    ).rejects.toBe(error);
  });

  it("bounds automatic previews and keeps completed work usable if preparation fails", async () => {
    calls.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({
        ...receipt,
        targetId: `task-${i}`,
      })),
    );
    await prepareTurnActionResultPreviews("turn", turn, tx);
    expect(upsert).toHaveBeenCalledTimes(6);
    resolve.mockRejectedValue(
      new HTTPException(404, { message: "Preview unavailable" }),
    );
    await expect(
      prepareTurnActionResultPreviews("turn", turn, tx),
    ).resolves.toBeUndefined();
  });
});
