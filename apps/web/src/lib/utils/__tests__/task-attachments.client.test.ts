import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadTaskAttachment } from "@/lib/utils/task-attachments.client";

const uploadUserFileDirectMock = vi.fn();

vi.mock("@/lib/utils/user-file-upload.client", () => ({
  uploadUserFileDirect: (...args: unknown[]) =>
    uploadUserFileDirectMock(...args),
}));

describe("task-attachments.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads task attachments through the direct upload helper", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const abortController = new AbortController();
    const onUploadProgress = vi.fn();

    uploadUserFileDirectMock.mockResolvedValue({
      publicUrl: "https://blob.example/users/user_123/report.pdf",
    });

    await expect(
      uploadTaskAttachment(file, {
        abortSignal: abortController.signal,
        onUploadProgress,
      }),
    ).resolves.toBe("https://blob.example/users/user_123/report.pdf");
    expect(uploadUserFileDirectMock).toHaveBeenCalledWith(file, {
      abortSignal: abortController.signal,
      onUploadProgress,
    });
  });

  it("preserves direct upload errors", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    uploadUserFileDirectMock.mockRejectedValue(
      new Error("Network error while uploading file. Please try again."),
    );

    await expect(uploadTaskAttachment(file)).rejects.toThrow(
      "Network error while uploading file. Please try again.",
    );
  });
});
