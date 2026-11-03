import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { chatResultSnapshotSchema } from "@/schemas/chat-result-preview.schema";

const {
  workspace,
  readTask,
  taskSchedule,
  botSchedule,
  decision,
  studioJob,
  asset,
  socialPost,
  projectAccess,
  liveFiles,
  job,
  projects,
  reportMessage,
} = vi.hoisted(() => ({
  workspace: vi.fn(),
  readTask: vi.fn(),
  taskSchedule: vi.fn(),
  botSchedule: vi.fn(),
  decision: vi.fn(),
  studioJob: vi.fn(),
  asset: vi.fn(),
  socialPost: vi.fn(),
  projectAccess: vi.fn(),
  liveFiles: vi.fn(),
  job: vi.fn(),
  projects: vi.fn(),
  reportMessage: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: {
      findFirst: workspace,
      findMany: async () => {
        const row = await workspace();
        return row ? [row] : [];
      },
    },
    project: { findMany: projects },
    taskSchedule: { findFirst: taskSchedule },
    sokoBotSchedule: { findFirst: botSchedule },
    sokoBotPendingDecision: { findFirst: decision },
    job: { findFirst: job },
    fileResource: { findMany: vi.fn().mockResolvedValue([]) },
    chatRoomMessage: { findFirst: reportMessage },
  },
}));
vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForWorkspace: readTask,
  requireJobRead: vi.fn(),
}));

vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: vi
    .fn()
    .mockRejectedValue(new Error("Outside Ads beta")),
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: projectAccess,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  getJob: studioJob,
  getAsset: asset,
}));
vi.mock("@/services/social-posts.service", () => ({
  getSocialPost: socialPost,
}));
vi.mock("@/services/file-search.service", () => ({
  loadLiveResources: liveFiles,
}));
vi.mock("@sokosumi/database/helpers", () => ({
  mapJobWithStatus: (row: unknown) => row,
}));

import {
  hydrateChatResultSnapshots,
  resolveChatResultReference,
} from "./chat-result-preview.service";

const actor = { userId: "owner", workspaceId: "workspace" };
const id = "00000000-0000-4000-8000-000000000001";
const capturedAt = new Date("2026-10-06T10:00:00Z");
describe("authorized chat results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveFiles.mockResolvedValue([]);
    workspace.mockResolvedValue({
      id: "workspace",
      userId: "owner",
      organizationId: null,
    });
    readTask.mockResolvedValue({
      id: "task-1",
      name: "Launch campaign",
      status: "READY",
      description: "Prepare launch",
      number: 12,
      createdAt: capturedAt,
      priority: "HIGH",
      visibility: "PRIVATE",
      _count: { events: 3 },
      participants: [],
      assignee: {
        id: "writer",
        name: "Writer",
        image: "https://example.test/writer.png",
      },
      assigneeUser: null,
      assigneeSokoBot: null,
      project: {
        id: "summer",
        name: "Summer",
        identifier: "SUM",
        logo: "https://example.test/project.png",
      },
      schedule: null,
      events: [],
    });
  });
  it("records the real task state and turns revoked access into an opaque fallback", async () => {
    const snapshot = await resolveChatResultReference({
      reference: { kind: "task", id: "task-1" },
      actor,
      previewId: id,
      capturedAt,
    });
    expect(snapshot.data).toMatchObject({
      title: "Launch campaign",
      status: "READY",
      assignee: "Writer",
      project: "Summer",
      sourceHref: "/tasks/task-1",
      task: {
        identifier: "SUM-12",
        priority: "HIGH",
        visibility: "PRIVATE",
        commentsCount: 3,
        assignee: { id: "writer", image: "https://example.test/writer.png" },
        project: { id: "summer", logo: "https://example.test/project.png" },
      },
    });
    workspace.mockResolvedValue(null);
    expect(await hydrateChatResultSnapshots([snapshot], "other-user")).toEqual([
      { id, state: "unavailable" },
    ]);
  });

  it("keeps historical task state while showing the recorded input question", async () => {
    readTask.mockResolvedValue({
      id: "task-1",
      name: "Brief",
      status: "INPUT_REQUIRED",
      description: null,
      schedule: null,
      events: [{ comment: "Which audience?" }],
    });
    const snapshot = await resolveChatResultReference({
      reference: { kind: "task", id: "task-1" },
      actor,
    });
    readTask.mockResolvedValue({
      id: "task-1",
      name: "Brief revised",
      status: "COMPLETED",
      description: null,
      schedule: null,
      events: [],
    });
    expect(await hydrateChatResultSnapshots([snapshot], "owner")).toMatchObject(
      [
        {
          title: "Brief",
          status: "INPUT_REQUIRED",
          question: "Which audience?",
          assignee: null,
        },
      ],
    );
  });
  it("shows tags added after the turn while keeping the reported status", async () => {
    const snapshot = await resolveChatResultReference({
      reference: { kind: "task", id: "task-1" },
      actor,
    });
    expect(snapshot.data.task?.tags.automatic).toEqual([]);
    readTask.mockResolvedValue({
      id: "task-1",
      name: "Launch campaign",
      status: "RUNNING",
      description: "Prepare launch",
      number: 12,
      schedule: null,
      events: [],
      automaticTags: ["research"],
    });
    const [live] = await hydrateChatResultSnapshots([snapshot], "owner");
    expect(live).toMatchObject({
      status: "READY",
      task: { status: "READY", tags: { automatic: ["research"] } },
    });
  });

  it("distinguishes execution schedules from private bot follow-ups", async () => {
    taskSchedule.mockResolvedValue({
      id: "schedule-1",
      name: "Weekly report",
      state: "ACTIVE",
      description: null,
      nextRunAt: capturedAt,
      timezone: "Europe/Prague",
      expr: "0 9 * * 1",
    });
    botSchedule.mockResolvedValue({
      id: "follow-up",
      name: "Check report",
      enabled: false,
      prompt: "Check progress",
      nextRunAt: capturedAt,
      timezone: "Europe/Prague",
      runOnce: true,
    });
    const execution = await resolveChatResultReference({
      reference: { kind: "task_schedule", id: "schedule-1" },
      actor,
    });
    const followUp = await resolveChatResultReference({
      reference: { kind: "bot_schedule", id: "follow-up" },
      actor,
    });
    expect(execution.data).toMatchObject({
      kind: "task_schedule",
      recurrence: "0 9 * * 1",
      sourceHref: "/schedules/schedule-1",
    });
    expect(followUp.data).toMatchObject({
      kind: "bot_schedule",
      status: "PAUSED",
      recurrence: null,
    });
    expect(botSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "follow-up",
          requestedByUserId: "owner",
          workspaceId: "workspace",
        },
      }),
    );
    botSchedule.mockResolvedValue(null);
    expect(
      await hydrateChatResultSnapshots([followUp], "someone-else"),
    ).toEqual([{ id: followUp.data.id, state: "unavailable" }]);
  });
  it("reads scheduled posts through project access outside the Ads beta", async () => {
    socialPost.mockResolvedValue({
      text: "Our launch",
      status: "SCHEDULED",
      provider: "linkedin",
      socialConnection: {
        displayName: "Team",
        externalHandle: "team",
        avatarUrl: "https://example.test/social.png",
      },
      scheduledAt: capturedAt,
      timezone: "UTC",
      media: [],
    });
    const snapshot = await resolveChatResultReference({
      reference: { kind: "social_post", id: "post", projectId: "project" },
      actor,
    });
    expect(snapshot.data).toMatchObject({
      status: "SCHEDULED",
      summary: "Our launch",
      destination: "linkedin · team",
      social: {
        provider: "linkedin",
        account: {
          displayName: "Team",
          avatarUrl: "https://example.test/social.png",
        },
      },
      scheduledAt: capturedAt.toISOString(),
    });
    expect(projectAccess).toHaveBeenCalledWith(
      { ...actor, projectId: "project" },
      expect.anything(),
    );
    projects.mockRejectedValue(new Error("db offline"));
    await expect(
      hydrateChatResultSnapshots([snapshot], "owner"),
    ).rejects.toThrow("db offline");
    projects.mockReset();
  });
  it.each(["FAILED", "CANCELLED", "QUEUED"])(
    "shows %s studio state without invented outputs",
    async (status) => {
      studioJob.mockResolvedValue({
        status,
        prompt: "A banner",
        error: "Generation failed",
        assetId: null,
      });
      const snapshot = await resolveChatResultReference({
        reference: {
          kind: "studio_job",
          id: "generation",
          projectId: "project",
        },
        actor,
      });
      expect(snapshot.data).toMatchObject({
        status,
        outputs: [],
        summary: "Generation failed",
      });
      expect(asset).not.toHaveBeenCalled();
    },
  );
  it("shows the actual studio output through protected content", async () => {
    studioJob.mockResolvedValue({
      status: "COMPLETED",
      prompt: "A banner",
      error: null,
      assetId: "asset",
    });
    asset.mockResolvedValue({
      id: "asset",
      prompt: "A banner",
      contentType: "image/png",
      bytes: 1200,
    });
    const snapshot = await resolveChatResultReference({
      reference: { kind: "studio_job", id: "generation", projectId: "project" },
      actor,
    });
    expect(snapshot.data.outputs).toEqual([
      {
        name: "A banner",
        contentType: "image/png",
        sizeBytes: 1200,
        openHref: "/studio?projectId=project&v=asset",
        previewHref: "/api/projects/project/image-studio/assets/asset/content",
        downloadHref: null,
      },
    ]);
  });
  const jobRow = (state: Record<string, unknown>) => ({
    id: "job",
    name: null,
    agentId: "agent",
    agent: { name: "Researcher", icon: null },
    input: null,
    inputSchema: null,
    result: null,
    events: [],
    ...state,
  });
  it.each([
    {
      status: "failed",
      events: [
        {
          status: "FAILED",
          result: "Provider could not read the uploaded document",
          blobs: [],
          links: [],
        },
      ],
      summary: "Provider could not read the uploaded document",
    },
    {
      status: "completed",
      result: "## Findings\n\n**Attention** is on the [hero](https://x.io).",
      events: [],
      summary: "Findings\nAttention is on the hero.",
    },
    { status: "processing", events: [], summary: null },
  ])("summarizes a $status job as plain text", async (state) => {
    job.mockResolvedValue(jobRow(state));
    const snapshot = await resolveChatResultReference({
      reference: { kind: "job", id: "job" },
      actor,
      previewId: id,
    });
    expect(snapshot.data.summary).toBe(state.summary);
  });

  it("labels the hire input with the Agent's field names instead of raw JSON", async () => {
    job.mockResolvedValue(
      jobRow({
        status: "payment_pending",
        input: JSON.stringify({
          input_url: "https://nmkr.io",
          study_type: "web",
          empty: "",
        }),
        inputSchema: JSON.stringify({
          input_data: [{ id: "input_url", type: "url", name: "Website URL" }],
        }),
      }),
    );
    const snapshot = await resolveChatResultReference({
      reference: { kind: "job", id: "job" },
      actor,
    });
    expect(snapshot.data.summary).toBeNull();
    expect(snapshot.data.details).toEqual([
      { label: "Website URL", value: "https://nmkr.io" },
      { label: "Study type", value: "web" },
    ]);
  });

  it("shows delegated job outputs without exposing object URLs", async () => {
    job.mockResolvedValue(
      jobRow({
        name: "Research",
        status: "completed",
        result: "Report ready",
        events: [
          {
            status: "COMPLETED",
            result: "Report ready",
            links: [],
            blobs: [
              {
                id: "pdf",
                status: "READY",
                fileUrl: "https://stored.example/pdf",
                name: "report.pdf",
                mimeType: "application/pdf",
                size: null,
              },
              {
                id: "png",
                status: "READY",
                fileUrl: "https://stored.example/png",
                name: "chart.png",
                mimeType: "image/png",
                size: 42n,
              },
              {
                id: "pending",
                status: "PENDING",
                fileUrl: null,
                name: "later.png",
                mimeType: "image/png",
                size: null,
              },
            ],
          },
        ],
      }),
    );
    const snapshot = await resolveChatResultReference({
      reference: { kind: "job", id: "job" },
      actor,
    });
    expect(snapshot.data.outputs).toHaveLength(2);
    expect(snapshot.data.outputs[0]).toMatchObject({
      name: "report.pdf",
      sizeBytes: null,
      openHref: "/api/jobs/job/files/pdf/content",
      previewHref: "/api/jobs/job/files/pdf/content",
      downloadHref: "/api/jobs/job/files/pdf/content?download=true",
    });
    expect(JSON.stringify(snapshot)).not.toContain("stored.example");
  });

  it("keeps a job card live after the turn that recorded it", async () => {
    job.mockResolvedValue(jobRow({ status: "processing" }));
    const snapshot = await resolveChatResultReference({
      reference: { kind: "job", id: "job" },
      actor,
    });
    job.mockResolvedValue(jobRow({ status: "completed", result: "Done" }));
    const [live] = await hydrateChatResultSnapshots([snapshot], "owner");
    expect(live).toMatchObject({ status: "completed", summary: "Done" });
  });
  it.each(["application/pdf", "text/plain", "audio/mpeg", "video/mp4"])(
    "offers authorized content for %s previews",
    async (mimeType) => {
      liveFiles.mockResolvedValue([
        { id: "file", displayName: "Output", mimeType, sizeBytes: null },
      ]);
      const snapshot = await resolveChatResultReference({
        reference: { kind: "file", id: "file" },
        actor,
      });
      expect(snapshot.data.outputs[0].previewHref).toBe(
        "/api/drive/files/file/content?scope=me",
      );
    },
  );
  it("filters private or deleted files on historical reads", async () => {
    liveFiles.mockResolvedValue([
      {
        id: "file",
        displayName: "Report",
        mimeType: "application/pdf",
        sizeBytes: null,
      },
    ]);
    const snapshot = await resolveChatResultReference({
      reference: { kind: "file", id: "file" },
      actor,
    });
    expect(snapshot.data.outputs[0]).toMatchObject({
      sizeBytes: null,
      previewHref: "/api/drive/files/file/content?scope=me",
      openHref: "/drive/files/file?scope=me",
    });
    liveFiles.mockResolvedValue([]);
    expect(
      await hydrateChatResultSnapshots([snapshot], "someone-else"),
    ).toEqual([{ id: snapshot.data.id, state: "unavailable" }]);
  });
  it("reauthorizes decisions by owner and refreshes only their actionable state", async () => {
    const row = {
      id,
      turnId: id,
      toolName: "update_task",
      proposal: { taskId: "task" },
      reason: "Update brief",
      status: "PENDING",
      expiresAt: new Date("2099-01-01"),
      createdAt: capturedAt,
      updatedAt: capturedAt,
      resolvedAt: null,
      resultingEntityId: null,
    };
    decision.mockResolvedValue(row);
    const snapshot = await resolveChatResultReference({
      reference: { kind: "decision", id },
      actor,
    });
    decision.mockResolvedValue({
      ...row,
      status: "ACCEPTED",
      resolvedAt: capturedAt,
    });
    expect(await hydrateChatResultSnapshots([snapshot], "owner")).toMatchObject(
      [{ decision: { status: "ACCEPTED" }, status: "PENDING" }],
    );
    expect(decision).toHaveBeenCalledWith({
      where: { id, requestedByUserId: "owner", workspaceId: "workspace" },
    });
    decision.mockResolvedValue(null);
    expect(
      await hydrateChatResultSnapshots([snapshot], "someone-else"),
    ).toEqual([{ id: snapshot.data.id, state: "unavailable" }]);
  });

  it("shows Cuso's report card from his shared room, reverted once it is", async () => {
    const report = {
      kind: "weekly",
      headline: "Week 1",
      done: [],
      upNext: [],
      changes: ["Two more LinkedIn posts a week"],
      results: "No provider metrics yet.",
    };
    reportMessage.mockResolvedValue({
      metadata: { cmo_report: report },
      room: { sharedSokoBot: { projectId: "project-1" } },
    });
    const snapshot = await resolveChatResultReference({
      reference: { kind: "cmo_report", id },
      actor,
    });
    expect(reportMessage.mock.calls[0]?.[0].where).toMatchObject({
      id,
      deletedAt: null,
      room: { sharedSokoBot: { workspaceId: "workspace" } },
    });
    expect(snapshot.data).toMatchObject({
      kind: "cmo_report",
      title: "Week 1",
      status: "Weekly",
      summary: "No provider metrics yet.",
      sourceHref: "/projects/project-1",
      details: [{ label: "Changed", value: "Two more LinkedIn posts a week" }],
    });
    reportMessage.mockResolvedValue({
      metadata: {
        cmo_report: { ...report, revertedAt: "2026-10-06T11:00:00Z" },
      },
      room: { sharedSokoBot: { projectId: "project-1" } },
    });
    expect(await hydrateChatResultSnapshots([snapshot], "owner")).toMatchObject(
      [{ title: "Week 1", status: "Reverted" }],
    );
    reportMessage.mockResolvedValue(null);
    expect(await hydrateChatResultSnapshots([snapshot], "owner")).toEqual([
      { id: snapshot.data.id, state: "unavailable" },
    ]);
  });

  it("keeps long recorded results within the existing tool ledger budget", async () => {
    job.mockResolvedValue(
      jobRow({
        status: "completed",
        result: "漢".repeat(4000),
        events: [
          {
            status: "COMPLETED",
            result: null,
            links: [],
            blobs: Array.from({ length: 12 }, (_, index) => ({
              id: `blob-${index}`,
              status: "READY",
              fileUrl: "https://stored.example/file",
              name: "漢".repeat(500),
              mimeType: "application/pdf",
              size: null,
            })),
          },
        ],
      }),
    );
    const snapshot = await resolveChatResultReference({
      reference: { kind: "job", id: "job" },
      actor,
    });
    expect(
      chatResultSnapshotSchema.safeParse(persistedToolResult(snapshot)).success,
    ).toBe(true);
    expect(snapshot.data.summary).toBe(`${"漢".repeat(599)}…`);
    expect(snapshot.data.outputs.length).toBeGreaterThan(0);
    expect(snapshot.data.outputs.length).toBeLessThan(12);
  });
  it("hydrates mixed-access collections without leaking an inaccessible file", async () => {
    const task = await resolveChatResultReference({
      reference: { kind: "task", id: "task-1" },
      actor,
    });
    liveFiles.mockResolvedValue([
      {
        id: "private-file",
        displayName: "Confidential.pdf",
        mimeType: "application/pdf",
        sizeBytes: null,
      },
    ]);
    const file = await resolveChatResultReference({
      reference: { kind: "file", id: "private-file" },
      actor,
    });
    liveFiles.mockResolvedValue([]);
    const cards = await hydrateChatResultSnapshots([task, file], "reader");
    expect(cards).toMatchObject([
      { title: "Launch campaign" },
      { id: file.data.id, state: "unavailable" },
    ]);
    expect(JSON.stringify(cards)).not.toContain("Confidential.pdf");
    expect(JSON.stringify(cards)).not.toContain("private-file");
  });
});

describe("project selection previews", () => {
  it("scopes candidates to the authorized workspace and drops deleted choices on hydration", async () => {
    workspace.mockResolvedValue({
      id: "workspace",
      userId: "owner",
      organizationId: null,
    });
    projects.mockResolvedValue([
      { id, name: "Books", identifier: "BOOK", logo: null },
    ]);
    const snapshot = await resolveChatResultReference({
      reference: { kind: "project_selection", projectIds: [id] },
      actor,
    });
    expect(projects).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "workspace", id: { in: [id] } },
      }),
    );
    expect(snapshot.data.projectOptions).toEqual([
      { id, name: "Books", identifier: "BOOK", logo: null },
    ]);
    projects.mockResolvedValue([]);
    const [current] = await hydrateChatResultSnapshots([snapshot], "owner");
    expect(current).toMatchObject({ state: "available", projectOptions: [] });
  });
  it("never exposes choices after workspace membership is revoked", async () => {
    workspace.mockResolvedValue({
      id: "workspace",
      userId: "owner",
      organizationId: null,
    });
    projects.mockResolvedValue([
      { id, name: "Books", identifier: null, logo: null },
    ]);
    const snapshot = await resolveChatResultReference({
      reference: { kind: "project_selection", projectIds: [id] },
      actor,
    });
    workspace.mockResolvedValue(null);
    expect(await hydrateChatResultSnapshots([snapshot], "removed")).toEqual([
      { id: snapshot.data.id, state: "unavailable" },
    ]);
  });
});
