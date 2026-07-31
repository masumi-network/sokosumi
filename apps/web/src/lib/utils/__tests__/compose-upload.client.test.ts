import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  uploadUserFileDirectMock,
  uploadChatRoomFileDirectMock,
  createFileUploadProgressToastMock,
  toastErrorMock,
  toastDismissMock,
  updateFileProgressMock,
  markFileCompleteMock,
  dismissMock,
} = vi.hoisted(() => ({
  uploadUserFileDirectMock: vi.fn(),
  uploadChatRoomFileDirectMock: vi.fn(),
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

vi.mock("@/lib/utils/chat-room-file-upload.client", () => ({
  uploadChatRoomFileDirect: (...args: unknown[]) =>
    uploadChatRoomFileDirectMock(...args),
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
    expect(uploadChatRoomFileDirectMock).not.toHaveBeenCalled();
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
    expect(uploadChatRoomFileDirectMock).not.toHaveBeenCalled();
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

  it("mints via room endpoint when roomId is provided", async () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    const roomId = "550e8400-e29b-41d4-a716-446655440000";
    uploadChatRoomFileDirectMock.mockResolvedValue({
      publicUrl: "https://blob.example/users/u1/chats/room/note.txt",
    });

    const results = await uploadComposeAttachments([file], {
      labels: {
        uploadingFile: "Uploading {fileName}",
        uploadingFiles: "Uploading {count} files",
        uploadError: "Failed",
      },
      roomId,
    });

    expect(uploadChatRoomFileDirectMock).toHaveBeenCalledWith(
      roomId,
      file,
      expect.objectContaining({
        onUploadProgress: expect.any(Function),
      }),
    );
    expect(uploadUserFileDirectMock).not.toHaveBeenCalled();
    expect(results[0]?.publicUrl).toBe(
      "https://blob.example/users/u1/chats/room/note.txt",
    );
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
