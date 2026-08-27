import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadTaskAttachment } from "@/lib/utils/task-attachments.client";

const createTaskFileUploadSessionMock = vi.fn();
const uploadViaPresignedUrlMock = vi.fn();

vi.mock("@/lib/clients/core.browser.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;
    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.status = options?.status;
    }
  },
  coreClient: {
    createTaskFileUploadSession: (...args: unknown[]) =>
      createTaskFileUploadSessionMock(...args),
  },
}));

vi.mock("@/lib/utils/user-file-upload.client", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/utils/user-file-upload.client")
  >("@/lib/utils/user-file-upload.client");
  return {
    ...actual,
    uploadViaPresignedUrl: (...args: unknown[]) =>
      uploadViaPresignedUrlMock(...args),
  };
});

describe("task-attachments.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mints a task-file grant, PUTs bytes, and returns the public URL", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const abortController = new AbortController();
    const onUploadProgress = vi.fn();
    const publicUrl = "https://blob.example/tasks/tsk_123/report-xyz.pdf";

    createTaskFileUploadSessionMock.mockResolvedValue({
      data: {
        uploadUrl: "https://blob.example/upload?sig=1",
        pathname: "tasks/tsk_123/report.pdf",
        headers: { "Content-Type": "application/pdf" },
      },
    });
    uploadViaPresignedUrlMock.mockResolvedValue({
      publicUrl,
      metadata: {
        pathname: "tasks/tsk_123/report-xyz.pdf",
        downloadUrl: publicUrl,
        size: file.size,
        uploadedAt: new Date(),
        etag: '"etag"',
      },
    });

    await expect(
      uploadTaskAttachment("tsk_123", file, {
        abortSignal: abortController.signal,
        onUploadProgress,
      }),
    ).resolves.toBe(publicUrl);

    expect(createTaskFileUploadSessionMock).toHaveBeenCalledWith("tsk_123", {
      filename: "report.pdf",
      contentType: "application/pdf",
      size: file.size,
    });
    expect(uploadViaPresignedUrlMock).toHaveBeenCalledWith(
      file,
      "application/pdf",
      {
        uploadUrl: "https://blob.example/upload?sig=1",
        pathname: "tasks/tsk_123/report.pdf",
        headers: { "Content-Type": "application/pdf" },
      },
      {
        abortSignal: abortController.signal,
        onUploadProgress,
      },
    );
  });

  it("requires a task id so a TaskFile row can be created", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    await expect(uploadTaskAttachment("", file)).rejects.toThrow(
      /draft before attaching/i,
    );
    expect(createTaskFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("preserves upload errors", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    createTaskFileUploadSessionMock.mockRejectedValue(
      new Error("Network error while uploading file. Please try again."),
    );

    await expect(uploadTaskAttachment("tsk_123", file)).rejects.toThrow(
      "Network error while uploading file. Please try again.",
    );
  });
});
