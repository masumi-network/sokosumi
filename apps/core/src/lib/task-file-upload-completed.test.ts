import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerTaskFileFromUploadCompleted,
  TaskFileUploadClientError,
} from "./task-file-upload-completed";

const { taskFileCreateMock, headMock, delMock } = vi.hoisted(() => ({
  taskFileCreateMock: vi.fn(),
  headMock: vi.fn(),
  delMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskFile: {
      create: taskFileCreateMock,
    },
  },
}));

vi.mock("@vercel/blob", () => ({
  head: headMock,
  del: delMock,
}));

const FILE_URL =
  "https://abc.public.blob.vercel-storage.com/tasks/tsk_123/report-xyz.pdf";
const BLOB_TOKEN = "blob_rw_test";

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

function completedBlob(url = FILE_URL) {
  return {
    url,
    pathname: "tasks/tsk_123/report-xyz.pdf",
    contentType: "application/pdf",
    contentDisposition: "inline",
    downloadUrl: url,
    etag: '"etag-1"',
  };
}

describe("registerTaskFileFromUploadCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFileCreateMock.mockResolvedValue({ id: "tfile_1" });
    headMock.mockResolvedValue({ size: 11, contentType: "application/pdf" });
    delMock.mockResolvedValue(undefined);
  });

  it("creates a TaskFile row with size from Blob head", async () => {
    headMock.mockResolvedValueOnce({ size: 9, contentType: "application/pdf" });

    await registerTaskFileFromUploadCompleted({
      blob: completedBlob(),
      tokenPayload: tokenPayload(),
      blobToken: BLOB_TOKEN,
    });

    expect(headMock).toHaveBeenCalledWith(FILE_URL, { token: BLOB_TOKEN });
    expect(taskFileCreateMock).toHaveBeenCalledWith({
      data: {
        taskId: "tsk_123",
        name: "report.pdf",
        fileUrl: FILE_URL,
        mimeType: "application/pdf",
        size: 9n,
        uploadedByUserId: "user_123",
        uploadedByCoworkerId: null,
      },
    });
  });

  it("is idempotent when unique constraint races", async () => {
    taskFileCreateMock.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    await expect(
      registerTaskFileFromUploadCompleted({
        blob: completedBlob(),
        tokenPayload: tokenPayload(),
        blobToken: BLOB_TOKEN,
      }),
    ).resolves.toBeUndefined();
  });

  it("soft-acks and deletes orphan blob on foreign-key failure", async () => {
    taskFileCreateMock.mockRejectedValueOnce(
      Object.assign(new Error("Foreign key constraint failed"), {
        code: "P2003",
      }),
    );

    await expect(
      registerTaskFileFromUploadCompleted({
        blob: completedBlob(),
        tokenPayload: tokenPayload(),
        blobToken: BLOB_TOKEN,
      }),
    ).resolves.toBeUndefined();

    expect(delMock).toHaveBeenCalledWith(FILE_URL, { token: BLOB_TOKEN });
  });

  it("rejects foreign blob URLs", async () => {
    await expect(
      registerTaskFileFromUploadCompleted({
        blob: completedBlob(
          "https://abc.public.blob.vercel-storage.com/tasks/tsk_other/x.pdf",
        ),
        tokenPayload: tokenPayload(),
        blobToken: BLOB_TOKEN,
      }),
    ).rejects.toBeInstanceOf(TaskFileUploadClientError);
    expect(taskFileCreateMock).not.toHaveBeenCalled();
    expect(headMock).not.toHaveBeenCalled();
  });

  it("rejects when actual size exceeds declared mint size", async () => {
    headMock.mockResolvedValueOnce({
      size: 12,
      contentType: "application/pdf",
    });

    await expect(
      registerTaskFileFromUploadCompleted({
        blob: completedBlob(),
        tokenPayload: tokenPayload({ size: 11 }),
        blobToken: BLOB_TOKEN,
      }),
    ).rejects.toThrow(/exceeds the declared mint size/);
    expect(taskFileCreateMock).not.toHaveBeenCalled();
  });
});
