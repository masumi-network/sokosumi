import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerTaskFileFromUploadCompleted } from "./task-file-upload-completed";

const { taskFileFindFirstMock, taskFileCreateMock } = vi.hoisted(() => ({
  taskFileFindFirstMock: vi.fn(),
  taskFileCreateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskFile: {
      findFirst: taskFileFindFirstMock,
      create: taskFileCreateMock,
    },
  },
}));

const FILE_URL =
  "https://abc.public.blob.vercel-storage.com/tasks/tsk_123/report-xyz.pdf";

function tokenPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    taskId: "tsk_123",
    name: "report.pdf",
    mimeType: "application/pdf",
    size: 11,
    uploadedByUserId: "user_123",
    uploadedByCoworkerId: null,
    ...overrides,
  });
}

describe("registerTaskFileFromUploadCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFileFindFirstMock.mockResolvedValue(null);
    taskFileCreateMock.mockResolvedValue({ id: "tfile_1" });
  });

  it("creates a TaskFile row from blob + token payload", async () => {
    await registerTaskFileFromUploadCompleted({
      blob: {
        url: FILE_URL,
        pathname: "tasks/tsk_123/report-xyz.pdf",
        contentType: "application/pdf",
        contentDisposition: "inline",
        downloadUrl: FILE_URL,
        etag: '"etag-1"',
      },
      tokenPayload: tokenPayload(),
    });

    expect(taskFileCreateMock).toHaveBeenCalledWith({
      data: {
        taskId: "tsk_123",
        name: "report.pdf",
        fileUrl: FILE_URL,
        mimeType: "application/pdf",
        size: 11n,
        uploadedByUserId: "user_123",
        uploadedByCoworkerId: null,
      },
    });
  });

  it("is idempotent when the fileUrl already exists", async () => {
    taskFileFindFirstMock.mockResolvedValueOnce({ id: "tfile_existing" });

    await registerTaskFileFromUploadCompleted({
      blob: {
        url: FILE_URL,
        pathname: "tasks/tsk_123/report-xyz.pdf",
        contentType: "application/pdf",
        contentDisposition: "inline",
        downloadUrl: FILE_URL,
        etag: '"etag-1"',
      },
      tokenPayload: tokenPayload(),
    });

    expect(taskFileCreateMock).not.toHaveBeenCalled();
  });

  it("rejects foreign blob URLs", async () => {
    await expect(
      registerTaskFileFromUploadCompleted({
        blob: {
          url: "https://abc.public.blob.vercel-storage.com/tasks/tsk_other/x.pdf",
          pathname: "tasks/tsk_other/x.pdf",
          contentType: "application/pdf",
          contentDisposition: "inline",
          downloadUrl:
            "https://abc.public.blob.vercel-storage.com/tasks/tsk_other/x.pdf",
          etag: '"etag-2"',
        },
        tokenPayload: tokenPayload(),
      }),
    ).rejects.toThrow(/not under the expected task file prefix/);
    expect(taskFileCreateMock).not.toHaveBeenCalled();
  });
});
