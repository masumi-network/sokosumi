import { getSokoBotVersion } from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolve,
  calls,
  upsert,
  jobInput,
  captureException,
  resolveSokoBotVersion,
} = vi.hoisted(() => ({
  resolve: vi.fn(),
  calls: vi.fn(),
  upsert: vi.fn(),
  jobInput: vi.fn(),
  captureException: vi.fn(),
  resolveSokoBotVersion: vi.fn(),
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
vi.mock("@/services/soko-bot-version.service", () => ({
  resolveSokoBotVersion: (id: string | null) => resolveSokoBotVersion(id),
}));
vi.mock("@sentry/node", () => ({ captureException }));

import prisma from "@/lib/db/prisma";
import { chatResultSnapshotSchema } from "@/schemas/chat-result-preview.schema";
import { prepareTurnActionResultPreviews } from "./turn-action-result-previews.service";

const turn = {
  requestedByUserId: "owner",
  sokoBot: { userId: "owner" },
  workspaceId: "workspace",
  versionId: "v21",
  askedByUserId: null,
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
    resolveSokoBotVersion.mockImplementation((id: string | null) =>
      Promise.resolve(getSokoBotVersion(id)),
    );
    calls.mockResolvedValue([]);
    upsert.mockResolvedValue({});
    resolve.mockResolvedValue({
      workspaceId: "workspace",
      reference: { kind: "task", id: "task" },
      data: { id: "card" },
    });
  });
  it.each(["request_seo_analysis", "create_seo_action_task"])(
    "uses %s's committed Task identity rather than its SEO row ID",
    async (capability) => {
      calls.mockResolvedValue([
        {
          ...receipt,
          capability,
          targetId: "seo-record",
          result: { projectId: "project", taskId: "task" },
        },
      ]);
      await prepareTurnActionResultPreviews("turn", turn, tx);
      expect(resolve).toHaveBeenCalledWith(
        expect.objectContaining({ reference: { kind: "task", id: "task" } }),
        tx,
      );
      calls.mockResolvedValue([
        {
          ...receipt,
          capability,
          targetId: "seo-record",
          result: { projectId: "project" },
        },
      ]);
      resolve.mockClear();
      await prepareTurnActionResultPreviews("turn", turn, tx);
      expect(resolve).not.toHaveBeenCalled();
    },
  );
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
    { ...turn, askedByUserId: "colleague" },
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

  it("records an unavailable card when this turn archived the task or deleted the schedule", async () => {
    calls.mockResolvedValue([
      { ...receipt, targetId: "kept-task" },
      { ...receipt, capability: "reply_to_task", targetId: "gone-task" },
      { ...receipt, capability: "archive_task", targetId: "gone-task" },
      {
        ...receipt,
        capability: "create_schedule",
        targetId: "gone-schedule",
      },
      {
        ...receipt,
        capability: "delete_schedule",
        targetId: "gone-schedule",
      },
    ]);
    resolve.mockImplementation(
      async (input: { reference: { kind: string; id?: string } }) => {
        if (
          input.reference.id === "gone-task" ||
          input.reference.id === "gone-schedule"
        ) {
          throw new HTTPException(404, {
            message:
              input.reference.kind === "task"
                ? "Task not found"
                : "Result unavailable",
          });
        }
        return {
          workspaceId: "workspace",
          reference: input.reference,
          data: { id: "550e8400-e29b-41d4-a716-446655440099" },
        };
      },
    );
    await expect(
      prepareTurnActionResultPreviews("turn", turn, tx),
    ).resolves.toBeUndefined();
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ reference: { kind: "task", id: "kept-task" } }),
      tx,
    );
    expect(resolve).not.toHaveBeenCalledWith(
      expect.objectContaining({ reference: { kind: "task", id: "gone-task" } }),
      tx,
    );
    expect(resolve).not.toHaveBeenCalledWith(
      expect.objectContaining({
        reference: { kind: "bot_schedule", id: "gone-schedule" },
      }),
      tx,
    );
    for (const reference of [
      { kind: "task", id: "gone-task" },
      { kind: "bot_schedule", id: "gone-schedule" },
    ]) {
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            capability: "preview_result",
            result: expect.objectContaining({
              reference,
              data: expect.objectContaining({ state: "unavailable" }),
            }),
          }),
        }),
      );
    }
    expect(captureException).not.toHaveBeenCalled();
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

  describe("autoResultCards flag", () => {
    const autoTurn = { ...turn, versionId: "v36-auto" };

    beforeEach(() => {
      resolveSokoBotVersion.mockImplementation((id: string | null) =>
        Promise.resolve(
          id === "v36-auto"
            ? { ...getSokoBotVersion("v36"), autoResultCards: true as const }
            : getSokoBotVersion(id),
        ),
      );
      resolve.mockImplementation(
        async (input: { reference: { kind: string; id?: string } }) => ({
          workspaceId: "workspace",
          reference: input.reference,
          data: { id: "550e8400-e29b-41d4-a716-446655440099" },
        }),
      );
    });

    it("attaches cards for save_task_schedule, set_task_parent, and generate_voiceover when flagged, leaving flag-off unchanged", async () => {
      calls.mockResolvedValue([
        { ...receipt, capability: "save_task_schedule", targetId: "ts-1" },
        { ...receipt, capability: "set_task_parent", targetId: "task-child" },
        {
          ...receipt,
          capability: "generate_voiceover",
          targetId: "file-vo",
          verification: "PROVIDER_ACK",
        },
      ]);

      await prepareTurnActionResultPreviews(
        "turn",
        { ...turn, versionId: "v36" },
        tx,
      );
      expect(resolve).not.toHaveBeenCalled();

      await prepareTurnActionResultPreviews("turn", autoTurn, tx);
      expect(resolve).toHaveBeenCalledTimes(3);
      expect(resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: { kind: "task_schedule", id: "ts-1" },
        }),
        tx,
      );
      expect(resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: { kind: "task", id: "task-child" },
        }),
        tx,
      );
      expect(resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: { kind: "file", id: "file-vo" },
        }),
        tx,
      );
    });

    it("treats delete_file and delete_task_schedule as removals without 404 lookups or Sentry noise", async () => {
      // Delete-only turn emits no card and never looks up tombstoned resources.
      calls.mockResolvedValue([
        { ...receipt, capability: "delete_file", targetId: "gone-file" },
        {
          ...receipt,
          capability: "delete_task_schedule",
          targetId: "gone-ts",
        },
      ]);
      await prepareTurnActionResultPreviews("turn", autoTurn, tx);
      expect(resolve).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
      expect(captureException).not.toHaveBeenCalled();

      // Same-turn create + delete records an unavailable card without lookup.
      calls.mockResolvedValue([
        { ...receipt, capability: "upload_file", targetId: "temp-file" },
        { ...receipt, capability: "delete_file", targetId: "temp-file" },
        { ...receipt, capability: "save_task_schedule", targetId: "temp-ts" },
        {
          ...receipt,
          capability: "delete_task_schedule",
          targetId: "temp-ts",
        },
      ]);
      await prepareTurnActionResultPreviews("turn", autoTurn, tx);
      expect(resolve).not.toHaveBeenCalled();
      for (const reference of [
        { kind: "file", id: "temp-file" },
        { kind: "task_schedule", id: "temp-ts" },
      ]) {
        expect(upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({
              capability: "preview_result",
              result: expect.objectContaining({
                reference,
                data: expect.objectContaining({ state: "unavailable" }),
              }),
            }),
          }),
        );
      }
      expect(captureException).not.toHaveBeenCalled();
    });

    it("marks an existing file preview unavailable when the owner deletes it in the same turn", async () => {
      const reference = { kind: "file", id: "file-before" };
      const snapshot = {
        workspaceId: "workspace",
        reference,
        data: {
          id: "550e8400-e29b-41d4-a716-446655440010",
          state: "available",
          capturedAt: "2026-10-06T09:22:00.000Z",
          kind: "file",
          title: "Owner's draft",
          status: "READY",
          sourceHref: "/drive/files/file-before",
        },
      };
      expect(chatResultSnapshotSchema.safeParse(snapshot).success).toBe(true);
      calls.mockResolvedValue([
        {
          capability: "preview_result",
          status: "COMPLETED",
          toolCallId: "existing-preview",
          result: snapshot,
        },
        { ...receipt, capability: "delete_file", targetId: reference.id },
      ]);
      await prepareTurnActionResultPreviews("turn", autoTurn, tx);
      expect(resolve).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            turnId_toolCallId: {
              turnId: "turn",
              toolCallId: "existing-preview",
            },
          },
          update: {
            result: expect.objectContaining({
              reference,
              data: expect.objectContaining({
                state: "unavailable",
                id: snapshot.data.id,
              }),
            }),
          },
        }),
      );
      expect(captureException).not.toHaveBeenCalled();
    });

    it.each([
      [
        "archive_task",
        { kind: "task", id: "task-before" },
        {
          id: "550e8400-e29b-41d4-a716-446655440011",
          state: "available",
          capturedAt: "2026-10-06T09:22:00.000Z",
          kind: "task",
          title: "Task",
          status: "READY",
          sourceHref: "/tasks/task-before",
        },
      ],
      [
        "delete_schedule",
        { kind: "bot_schedule", id: "sched-before" },
        {
          id: "550e8400-e29b-41d4-a716-446655440012",
          state: "available",
          capturedAt: "2026-10-06T09:22:00.000Z",
          kind: "bot_schedule",
          title: "Daily check",
          status: "ACTIVE",
          sourceHref: "/schedules/sched-before",
        },
      ],
      [
        "delete_task_schedule",
        { kind: "task_schedule", id: "ts-before" },
        {
          id: "550e8400-e29b-41d4-a716-446655440013",
          state: "available",
          capturedAt: "2026-10-06T09:22:00.000Z",
          kind: "task_schedule",
          title: "Weekly report",
          status: "ACTIVE",
          sourceHref: "/schedules/ts-before",
        },
      ],
    ] as const)(
      "marks an existing preview unavailable when %s removes it, and ignores uncommitted removals",
      async (capability, reference, data) => {
        const snapshot = { workspaceId: "workspace", reference, data };
        expect(chatResultSnapshotSchema.safeParse(snapshot).success).toBe(true);

        // Failed / uncommitted removal leaves the existing preview intact.
        calls.mockResolvedValue([
          {
            capability: "preview_result",
            status: "COMPLETED",
            toolCallId: "existing-preview",
            result: snapshot,
          },
          {
            ...receipt,
            capability,
            targetId: reference.id,
            disposition: "UNKNOWN",
          },
        ]);
        await prepareTurnActionResultPreviews("turn", autoTurn, tx);
        expect(upsert).not.toHaveBeenCalled();

        // Committed removal marks the existing preview unavailable with its original ID.
        calls.mockResolvedValue([
          {
            capability: "preview_result",
            status: "COMPLETED",
            toolCallId: "existing-preview",
            result: snapshot,
          },
          { ...receipt, capability, targetId: reference.id },
        ]);
        await prepareTurnActionResultPreviews("turn", autoTurn, tx);
        expect(resolve).not.toHaveBeenCalled();
        expect(upsert).toHaveBeenCalledTimes(1);
        expect(upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              turnId_toolCallId: {
                turnId: "turn",
                toolCallId: "existing-preview",
              },
            },
            update: {
              result: expect.objectContaining({
                reference,
                data: expect.objectContaining({
                  state: "unavailable",
                  id: data.id,
                }),
              }),
            },
          }),
        );
      },
    );

    it("skips link-only writes that have no native card kind", async () => {
      calls.mockResolvedValue([
        {
          ...receipt,
          capability: "newsletter_draft_issue",
          targetId: "issue-1",
        },
        { ...receipt, capability: "create_table", targetId: "table-1" },
        { ...receipt, capability: "manage_reminder", targetId: "nudge-1" },
        { ...receipt, capability: "link_tasks", targetId: "link-1" },
        { ...receipt, capability: "upsert_contact", targetId: "contact-1" },
      ]);
      await prepareTurnActionResultPreviews("turn", autoTurn, tx);
      expect(resolve).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    });
  });
});
