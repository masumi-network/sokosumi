import { Channel, TaskStatus } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectMemoryService } from "./project-memory.service";

const {
  captureExceptionMock,
  generateTextMock,
  getEnvMock,
  projectFindUniqueMock,
  projectUpdateManyMock,
  taskFindFirstMock,
  taskFindManyMock,
  uploadProjectContextMdFileMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  generateTextMock: vi.fn(),
  getEnvMock: vi.fn(),
  projectFindUniqueMock: vi.fn(),
  projectUpdateManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  uploadProjectContextMdFileMock: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/lib/project-files-blob", () => ({
  uploadProjectContextMdFile: uploadProjectContextMdFileMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      findUnique: projectFindUniqueMock,
      updateMany: projectUpdateManyMock,
    },
    task: {
      findFirst: taskFindFirstMock,
      findMany: taskFindManyMock,
    },
  },
}));

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "task_123";
const MODEL_ID = "mistral/mistral-medium-3.5";

const project = {
  id: PROJECT_ID,
  workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  name: "Launch",
  briefing: "Reach technical founders",
  briefingUrl: "https://blob.example/BRIEFING.md",
  contextMd: "# Existing\nKeep this decision",
  contextMdUrl: "https://blob.example/CONTEXT.md",
  contextMdUpdatedAt: new Date("2026-08-16T09:00:00.000Z"),
  contextMdModel: MODEL_ID,
  contextMdUpdatingSince: new Date("2026-08-16T09:00:00.000Z"),
  contextMdVersion: 3,
  createdAt: new Date("2026-08-15T09:00:00.000Z"),
  updatedAt: new Date("2026-08-16T09:00:00.000Z"),
};

const completedTask = {
  id: TASK_ID,
  name: "Publish launch report",
  description: "Summarize campaign results",
  updatedAt: new Date("2026-08-16T10:00:00.000Z"),
  assignee: { name: "Research coworker" },
  events: [
    {
      id: "event_1",
      createdAt: new Date("2026-08-16T10:00:00.000Z"),
      status: TaskStatus.COMPLETED,
      comment: "Report published",
      channel: Channel.SOKOSUMI,
    },
  ],
  files: [{ name: "launch-report.pdf" }],
};

describe("projectMemoryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getEnvMock.mockReturnValue({
      AI_GATEWAY_API_KEY: "gateway_key",
      PROJECT_MEMORY_MODEL: MODEL_ID,
    });
    projectUpdateManyMock.mockResolvedValue({ count: 1 });
    projectFindUniqueMock.mockResolvedValue(project);
    taskFindFirstMock.mockResolvedValue(completedTask);
    taskFindManyMock.mockResolvedValue([]);
    generateTextMock.mockResolvedValue({ text: "# Updated\nNew decision" });
    uploadProjectContextMdFileMock.mockResolvedValue(
      "https://blob.example/projects/project_1/CONTEXT.md",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a no-op without an AI Gateway key", async () => {
    getEnvMock.mockReturnValue({
      AI_GATEWAY_API_KEY: undefined,
      PROJECT_MEMORY_MODEL: MODEL_ID,
    });

    await expect(
      projectMemoryService.refreshAfterTaskCompleted({
        projectId: PROJECT_ID,
        taskId: TASK_ID,
      }),
    ).resolves.toEqual({ status: "skipped", reason: "missing_api_key" });
    expect(projectUpdateManyMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("hard-caps output at 500 lines and persists an optimistic version update", async () => {
    const generatedLines = Array.from(
      { length: 505 },
      (_, index) => `Line ${index + 1}`,
    );
    generateTextMock.mockResolvedValue({ text: generatedLines.join("\n") });

    const result = await projectMemoryService.refreshAfterTaskCompleted({
      projectId: PROJECT_ID,
      taskId: TASK_ID,
    });

    const expectedContent = generatedLines.slice(0, 500).join("\n");
    expect(result).toEqual({ status: "updated", version: 4, lineCount: 500 });
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: MODEL_ID,
        timeout: 60_000,
        providerOptions: { gateway: { only: ["mistral"] } },
        prompt: expect.stringContaining("Report published"),
      }),
    );
    expect(uploadProjectContextMdFileMock).toHaveBeenCalledWith(
      PROJECT_ID,
      expectedContent,
    );
    expect(projectUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: PROJECT_ID,
          contextMdVersion: 3,
        }),
        data: expect.objectContaining({
          contextMd: expectedContent,
          contextMdModel: MODEL_ID,
          contextMdVersion: { increment: 1 },
          contextMdUpdatingSince: null,
        }),
      }),
    );
  });

  it("skips when another fresh refresh owns the project lock", async () => {
    projectUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    await expect(
      projectMemoryService.refreshAfterTaskCompleted({
        projectId: PROJECT_ID,
        taskId: TASK_ID,
      }),
    ).resolves.toEqual({ status: "skipped", reason: "already_updating" });
    expect(projectFindUniqueMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("keeps old memory when model output is empty and releases the lock", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "  \n " });

    await expect(
      projectMemoryService.refreshAfterTaskCompleted({
        projectId: PROJECT_ID,
        taskId: TASK_ID,
      }),
    ).resolves.toEqual({ status: "skipped", reason: "empty_output" });
    expect(uploadProjectContextMdFileMock).not.toHaveBeenCalled();
    expect(projectUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: PROJECT_ID }),
        data: { contextMdUpdatingSince: null },
      }),
    );
  });
});
