import { beforeEach, describe, expect, it, vi } from "vitest";

import { sourceImportService } from "./source-import.service";

const {
  captureExceptionMock,
  upsertLinkMock,
  upsertOutputBlobMock,
  mockTaskFileClient,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  upsertLinkMock: vi.fn(),
  upsertOutputBlobMock: vi.fn(),
  mockTaskFileClient: {
    taskFile: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  blobRepository: {
    upsertOutputBlob: upsertOutputBlobMock,
  },
  linkRepository: {
    upsertLink: upsertLinkMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

describe("sourceImportService.enqueueFromMarkdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts unique file blobs and http links from markdown", async () => {
    await sourceImportService.enqueueFromMarkdown(
      "event_1",
      [
        "[file](https://example.com/result.pdf)",
        "[dup file](https://example.com/result.pdf)",
        "<https://example.com/page>",
        "[link](https://example.com/page)",
        "[skip](mailto:test@example.com)",
      ].join("\n"),
    );

    expect(upsertOutputBlobMock).toHaveBeenCalledTimes(1);
    expect(upsertOutputBlobMock).toHaveBeenCalledWith(
      {
        eventId: "event_1",
        sourceUrl: "https://example.com/result.pdf",
        name: "result.pdf",
      },
      expect.anything(),
    );
    expect(upsertLinkMock).toHaveBeenCalledTimes(1);
    expect(upsertLinkMock).toHaveBeenCalledWith(
      {
        eventId: "event_1",
        url: "https://example.com/page",
        title: undefined,
      },
      expect.anything(),
    );
  });

  it("captures repository errors and continues processing other links", async () => {
    upsertOutputBlobMock.mockRejectedValueOnce(new Error("blob failed"));
    upsertLinkMock.mockRejectedValueOnce(new Error("link failed"));

    await sourceImportService.enqueueFromMarkdown(
      "event_1",
      [
        "[file](https://example.com/result.pdf)",
        "[link](https://example.com/page)",
      ].join("\n"),
    );

    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(upsertOutputBlobMock).toHaveBeenCalledTimes(1);
    expect(upsertLinkMock).toHaveBeenCalledTimes(1);
  });

  it("skips upserts when markdown contains no importable links", async () => {
    await sourceImportService.enqueueFromMarkdown("event_1", "No links here");

    expect(upsertOutputBlobMock).not.toHaveBeenCalled();
    expect(upsertLinkMock).not.toHaveBeenCalled();
  });
});

describe("sourceImportService.enqueueTaskOutputsFromMarkdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskFileClient.taskFile.findFirst.mockResolvedValue(null);
    mockTaskFileClient.taskFile.upsert.mockResolvedValue({});
  });

  it("creates PENDING TASK_OUTPUT for file URLs in markdown", async () => {
    await sourceImportService.enqueueTaskOutputsFromMarkdown(
      "task_1",
      "[file](https://example.com/result.pdf)",
      mockTaskFileClient as any,
    );

    expect(mockTaskFileClient.taskFile.findFirst).toHaveBeenCalledWith({
      where: {
        taskId: "task_1",
        OR: [
          { fileUrl: "https://example.com/result.pdf" },
          { sourceUrl: "https://example.com/result.pdf" },
        ],
      },
    });

    expect(mockTaskFileClient.taskFile.upsert).toHaveBeenCalledWith({
      where: {
        taskId_sourceUrl: {
          taskId: "task_1",
          sourceUrl: "https://example.com/result.pdf",
        },
      },
      update: {},
      create: {
        taskId: "task_1",
        name: "result.pdf",
        sourceUrl: "https://example.com/result.pdf",
        fileUrl: null,
        status: "PENDING",
        origin: "TASK_OUTPUT",
      },
    });
  });

  it("skips file URLs that already exist as USER_UPLOAD (fileUrl match)", async () => {
    const blobUrl = "https://store.public.blob.vercel-storage.com/file.pdf";
    mockTaskFileClient.taskFile.findFirst.mockResolvedValueOnce({
      id: "tf_1",
      taskId: "task_1",
      fileUrl: blobUrl,
      sourceUrl: null,
      origin: "USER_UPLOAD",
      status: "READY",
    });

    await sourceImportService.enqueueTaskOutputsFromMarkdown(
      "task_1",
      `[uploaded file](${blobUrl})`,
      mockTaskFileClient as any,
    );

    expect(mockTaskFileClient.taskFile.findFirst).toHaveBeenCalledWith({
      where: {
        taskId: "task_1",
        OR: [{ fileUrl: blobUrl }, { sourceUrl: blobUrl }],
      },
    });

    expect(mockTaskFileClient.taskFile.upsert).not.toHaveBeenCalled();
  });

  it("skips file URLs that already exist as TASK_OUTPUT (sourceUrl match)", async () => {
    const externalUrl = "https://example.com/output.pdf";
    mockTaskFileClient.taskFile.findFirst.mockResolvedValueOnce({
      id: "tf_2",
      taskId: "task_1",
      fileUrl: null,
      sourceUrl: externalUrl,
      origin: "TASK_OUTPUT",
      status: "PENDING",
    });

    await sourceImportService.enqueueTaskOutputsFromMarkdown(
      "task_1",
      `[same file](${externalUrl})`,
      mockTaskFileClient as any,
    );

    expect(mockTaskFileClient.taskFile.findFirst).toHaveBeenCalledWith({
      where: {
        taskId: "task_1",
        OR: [{ fileUrl: externalUrl }, { sourceUrl: externalUrl }],
      },
    });

    expect(mockTaskFileClient.taskFile.upsert).not.toHaveBeenCalled();
  });

  it("processes multiple unique URLs and skips duplicates", async () => {
    const uploadedUrl = "https://store.vercel-storage.com/uploaded.pdf";
    const newUrl1 = "https://example.com/new1.pdf";
    const newUrl2 = "https://example.com/new2.pdf";

    mockTaskFileClient.taskFile.findFirst
      .mockResolvedValueOnce({
        id: "tf_1",
        fileUrl: uploadedUrl,
        sourceUrl: null,
        origin: "USER_UPLOAD",
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await sourceImportService.enqueueTaskOutputsFromMarkdown(
      "task_1",
      [
        `[uploaded](${uploadedUrl})`,
        `[new1](${newUrl1})`,
        `[new2](${newUrl2})`,
      ].join("\n"),
      mockTaskFileClient as any,
    );

    expect(mockTaskFileClient.taskFile.findFirst).toHaveBeenCalledTimes(3);
    expect(mockTaskFileClient.taskFile.upsert).toHaveBeenCalledTimes(2);
    expect(mockTaskFileClient.taskFile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sourceUrl: newUrl1 }),
      }),
    );
    expect(mockTaskFileClient.taskFile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sourceUrl: newUrl2 }),
      }),
    );
  });

  it("captures exceptions and continues processing other URLs", async () => {
    const errorUrl = "https://example.com/error.pdf";
    const validUrl = "https://example.com/valid.pdf";

    mockTaskFileClient.taskFile.findFirst
      .mockRejectedValueOnce(new Error("Database error"))
      .mockResolvedValueOnce(null);

    await sourceImportService.enqueueTaskOutputsFromMarkdown(
      "task_1",
      [`[error](${errorUrl})`, `[valid](${validUrl})`].join("\n"),
      mockTaskFileClient as any,
    );

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(mockTaskFileClient.taskFile.upsert).toHaveBeenCalledTimes(1);
    expect(mockTaskFileClient.taskFile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sourceUrl: validUrl }),
      }),
    );
  });

  it("skips when markdown contains no file links", async () => {
    await sourceImportService.enqueueTaskOutputsFromMarkdown(
      "task_1",
      "Just a comment with no files",
      mockTaskFileClient as any,
    );

    expect(mockTaskFileClient.taskFile.findFirst).not.toHaveBeenCalled();
    expect(mockTaskFileClient.taskFile.upsert).not.toHaveBeenCalled();
  });
});
