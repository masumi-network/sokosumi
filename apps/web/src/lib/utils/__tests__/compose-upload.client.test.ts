import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  uploadUserFileDirectMock,
  createFileUploadProgressToastMock,
  toastErrorMock,
  toastDismissMock,
  updateFileProgressMock,
  markFileCompleteMock,
  dismissMock,
} = vi.hoisted(() => ({
  uploadUserFileDirectMock: vi.fn(),
  createFileUploadProgressToastMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastDismissMock: vi.fn(),
  updateFileProgressMock: vi.fn(),
  markFileCompleteMock: vi.fn(),
  dismissMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    dismiss: (...args: unknown[]) => toastDismissMock(...args),
  },
}));

vi.mock("@/lib/utils/file-upload-progress-toast", () => ({
  createFileUploadProgressToast: (...args: unknown[]) =>
    createFileUploadProgressToastMock(...args),
}));

vi.mock("@/lib/utils/user-file-upload.client", () => ({
  getUserFileUploadErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  uploadUserFileDirect: (...args: unknown[]) =>
    uploadUserFileDirectMock(...args),
}));

import { uploadComposeAttachments } from "@/lib/utils/compose-upload.client";

describe("uploadComposeAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFileUploadProgressToastMock.mockReturnValue({
      updateFileProgress: updateFileProgressMock,
      markFileComplete: markFileCompleteMock,
      dismiss: dismissMock,
    });
  });

  it("returns empty array without toast when no files", async () => {
    await expect(
      uploadComposeAttachments([], {
        labels: {
          uploadingFile: "Uploading {fileName}",
          uploadingFiles: "Uploading {count} files",
          uploadError: "Failed",
        },
      }),
    ).resolves.toEqual([]);

    expect(createFileUploadProgressToastMock).not.toHaveBeenCalled();
    expect(uploadUserFileDirectMock).not.toHaveBeenCalled();
  });

  it("uploads files with progress toast and returns compose results", async () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    uploadUserFileDirectMock.mockImplementation(
      async (
        _file: File,
        options?: {
          onUploadProgress?: (progress: {
            loaded: number;
            total: number;
            percentage: number;
          }) => void;
        },
      ) => {
        options?.onUploadProgress?.({
          loaded: 5,
          total: 5,
          percentage: 100,
        });
        return { publicUrl: "https://blob.example/note.txt" };
      },
    );

    const results = await uploadComposeAttachments([file], {
      labels: {
        uploadingFile: "Uploading {fileName}",
        uploadingFiles: "Uploading {count} files",
        uploadError: "Failed",
      },
      fallbackFileName: "attachment",
    });

    expect(createFileUploadProgressToastMock).toHaveBeenCalledWith({
      files: [file],
      labels: {
        uploadingFile: "Uploading {fileName}",
        uploadingFiles: "Uploading {count} files",
      },
    });
    expect(uploadUserFileDirectMock).toHaveBeenCalledTimes(1);
    expect(updateFileProgressMock).toHaveBeenCalledWith(0, {
      loaded: 5,
      total: 5,
      percentage: 100,
    });
    expect(markFileCompleteMock).toHaveBeenCalledWith(0);
    expect(dismissMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        publicUrl: "https://blob.example/note.txt",
        fileName: "note.txt",
        mediaType: "text/plain",
        file,
      },
    ]);
  });

  it("shows error toast, dismisses progress, and rethrows on failure", async () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    uploadUserFileDirectMock.mockRejectedValue(new Error("boom"));

    await expect(
      uploadComposeAttachments([file], {
        labels: {
          uploadingFile: "Uploading {fileName}",
          uploadingFiles: "Uploading {count} files",
          uploadError: "Upload failed",
        },
      }),
    ).rejects.toThrow("boom");

    expect(dismissMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith("boom");
  });
});
