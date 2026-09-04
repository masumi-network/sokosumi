import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskFileClient } from "./source-import.service";
import { sourceImportService } from "./source-import.service";

const {
  captureExceptionMock,
  captureMessageMock,
  createLinksMock,
  createOutputBlobsMock,
  mockTaskFileClient,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  captureMessageMock: vi.fn(),
  createLinksMock: vi.fn(),
  createOutputBlobsMock: vi.fn(),
  mockTaskFileClient: {
    taskFile: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  } satisfies TaskFileClient,
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: captureMessageMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  blobRepository: {
    createOutputBlobs: createOutputBlobsMock,
  },
  linkRepository: {
    createLinks: createLinksMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

describe("sourceImportService.enqueueFromMarkdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes unique file blobs and http links in one batch each", async () => {
    await sourceImportService.enqueueFromMarkdown(
      "event_1",
      [
        "[file](https://example.com/result.pdf)",
        "[dup file](https://example.com/result.pdf)",
        "[second file](https://example.com/notes.pdf)",
        "<https://example.com/page>",
        "[link](https://example.com/page)",
        "[other](https://example.com/other)",
        "[skip](mailto:test@example.com)",
        // `new URL()` reads this as https, `isHttpUrl` does not. The filter
        // between them is load-bearing.
        "[schemeless](https:example.com/nope)",
      ].join("\n"),
    );

    expect(createOutputBlobsMock).toHaveBeenCalledTimes(1);
    expect(createOutputBlobsMock).toHaveBeenCalledWith(
      [
        {
          eventId: "event_1",
          sourceUrl: "https://example.com/result.pdf",
          name: "result.pdf",
        },
        {
          eventId: "event_1",
          sourceUrl: "https://example.com/notes.pdf",
          name: "notes.pdf",
        },
      ],
      expect.anything(),
    );
    expect(createLinksMock).toHaveBeenCalledTimes(1);
    expect(createLinksMock).toHaveBeenCalledWith(
      [
        { eventId: "event_1", url: "https://example.com/page" },
        { eventId: "event_1", url: "https://example.com/other" },
      ],
      expect.anything(),
    );
  });

  it("captures a failing batch with its job event and still attempts the other", async () => {
    const blobFailure = new Error("blob failed");
    const linkFailure = new Error("link failed");
    createOutputBlobsMock.mockRejectedValueOnce(blobFailure);
    createLinksMock.mockRejectedValueOnce(linkFailure);

    await sourceImportService.enqueueFromMarkdown(
      "event_1",
      [
        "[file](https://example.com/result.pdf)",
        "[link](https://example.com/page)",
      ].join("\n"),
    );

    expect(createOutputBlobsMock).toHaveBeenCalledTimes(1);
    expect(createLinksMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenCalledWith(blobFailure, {
      extra: { jobEventId: "event_1", blobs: 1 },
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(linkFailure, {
      extra: { jobEventId: "event_1", links: 1 },
    });
  });

  it("drops URLs the unique index cannot hold and reports the count", async () => {
    // The two batches filter separately, so each needs its own fixture. A
    // `.pdf` URL only ever reaches the blob batch, because `extractHttpLinks`
    // excludes file-like URLs.
    const oversizedFile = `https://example.com/${"a".repeat(2100)}.pdf`;
    const oversizedLink = `https://example.com/${"b".repeat(2100)}`;
    // Exactly MAX_INDEXABLE_URL_BYTES, so it must survive. This pins the
    // boundary itself, not just the magnitude of the constant.
    const atTheLimit = `https://example.com/${"c".repeat(1980)}`;

    await sourceImportService.enqueueFromMarkdown(
      "event_1",
      [
        `[huge file](${oversizedFile})`,
        "[file](https://example.com/result.pdf)",
        `[huge link](${oversizedLink})`,
        `[at the limit](${atTheLimit})`,
        "[link](https://example.com/page)",
      ].join("\n"),
    );

    // An oversized row would abort its whole statement, taking the good rows
    // with it. Only the good rows are written, and every drop is reported.
    expect(createOutputBlobsMock).toHaveBeenCalledWith(
      [
        {
          eventId: "event_1",
          sourceUrl: "https://example.com/result.pdf",
          name: "result.pdf",
        },
      ],
      expect.anything(),
    );
    expect(createLinksMock).toHaveBeenCalledWith(
      [
        { eventId: "event_1", url: atTheLimit },
        { eventId: "event_1", url: "https://example.com/page" },
      ],
      expect.anything(),
    );
    // One report per batch, so the count says which batch lost the URL.
    expect(captureMessageMock).toHaveBeenCalledTimes(2);
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Dropped source-import URLs over the index limit",
      { level: "warning", extra: { jobEventId: "event_1", dropped: 1 } },
    );
  });

  it("writes nothing when markdown contains no importable links", async () => {
    await sourceImportService.enqueueFromMarkdown("event_1", "No links here");

    expect(createOutputBlobsMock).not.toHaveBeenCalled();
    expect(createLinksMock).not.toHaveBeenCalled();
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
      mockTaskFileClient,
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
      mockTaskFileClient,
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
      mockTaskFileClient,
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
      mockTaskFileClient,
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
      mockTaskFileClient,
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
      mockTaskFileClient,
    );

    expect(mockTaskFileClient.taskFile.findFirst).not.toHaveBeenCalled();
    expect(mockTaskFileClient.taskFile.upsert).not.toHaveBeenCalled();
  });
});
