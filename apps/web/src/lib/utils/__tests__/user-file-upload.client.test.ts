import { beforeEach, describe, expect, it, vi } from "vitest";

const createMyFileUploadSessionMock = vi.fn();
const putMock = vi.fn();

vi.mock("@/lib/clients/core.browser.client", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/clients/core.browser.client")
  >("@/lib/clients/core.browser.client");

  return {
    ...actual,
    coreClient: {
      createMyFileUploadSession: (...args: unknown[]) =>
        createMyFileUploadSessionMock(...args),
    },
  };
});

vi.mock("@vercel/blob/client", () => ({
  put: (...args: unknown[]) => putMock(...args),
}));

import { CoreApiRequestError } from "@/lib/clients/core.browser.client";
import {
  getUserFileUploadErrorMessage,
  UserFileUploadError,
  uploadInputDataFiles,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

describe("user-file-upload.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an upload session and uploads the file to Blob", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    createMyFileUploadSessionMock.mockResolvedValue({
      data: {
        clientToken: "upload-token",
        access: "public",
        pathname: "users/user_123/report.pdf",
        addRandomSuffix: true,
        maxSizeBytes: 1073741824,
      },
    });
    putMock.mockResolvedValue({
      url: "https://blob.example/users/user_123/report.pdf",
      pathname: "users/user_123/report.pdf",
      downloadUrl: "https://blob.example/download/report.pdf",
      etag: '"etag-123"',
    });

    await expect(uploadUserFileDirect(file)).resolves.toEqual({
      publicUrl: "https://blob.example/users/user_123/report.pdf",
      metadata: {
        pathname: "users/user_123/report.pdf",
        downloadUrl: "https://blob.example/download/report.pdf",
        size: 5,
        uploadedAt: expect.any(Date),
        etag: '"etag-123"',
      },
    });

    expect(createMyFileUploadSessionMock).toHaveBeenCalledWith({
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 5,
    });
    expect(putMock).toHaveBeenCalledWith(
      "users/user_123/report.pdf",
      file,
      expect.objectContaining({
        access: "public",
        token: "upload-token",
        contentType: "application/pdf",
        multipart: false,
      }),
    );
  });

  it("forwards upload progress updates to the caller", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const onUploadProgress = vi.fn();

    createMyFileUploadSessionMock.mockResolvedValue({
      data: {
        clientToken: "upload-token",
        access: "public",
        pathname: "users/user_123/report.pdf",
        addRandomSuffix: true,
        maxSizeBytes: 1073741824,
      },
    });
    putMock.mockImplementation(
      async (
        _pathname: string,
        _file: File,
        options: {
          onUploadProgress?: (progress: {
            loaded: number;
            total: number;
            percentage: number;
          }) => void;
        },
      ) => {
        options.onUploadProgress?.({
          loaded: 2,
          total: 5,
          percentage: 40,
        });

        return {
          url: "https://blob.example/users/user_123/report.pdf",
          pathname: "users/user_123/report.pdf",
          downloadUrl: "https://blob.example/download/report.pdf",
          etag: '"etag-progress"',
        };
      },
    );

    await uploadUserFileDirect(file, { onUploadProgress });

    expect(onUploadProgress).toHaveBeenCalledWith({
      loaded: 2,
      total: 5,
      percentage: 40,
    });
    expect(putMock).toHaveBeenCalledWith(
      "users/user_123/report.pdf",
      file,
      expect.objectContaining({
        onUploadProgress: expect.any(Function),
      }),
    );
  });

  it("forwards abort signals to Blob uploads", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const abortController = new AbortController();

    createMyFileUploadSessionMock.mockResolvedValue({
      data: {
        clientToken: "upload-token",
        access: "public",
        pathname: "users/user_123/report.pdf",
        addRandomSuffix: true,
        maxSizeBytes: 1073741824,
      },
    });
    putMock.mockResolvedValue({
      url: "https://blob.example/users/user_123/report.pdf",
      pathname: "users/user_123/report.pdf",
      downloadUrl: "https://blob.example/download/report.pdf",
      etag: '"etag-abort"',
    });

    await uploadUserFileDirect(file, {
      abortSignal: abortController.signal,
    });

    expect(putMock).toHaveBeenCalledWith(
      "users/user_123/report.pdf",
      file,
      expect.objectContaining({
        abortSignal: abortController.signal,
      }),
    );
  });

  it("enables multipart uploads for files larger than 5 MB", async () => {
    const file = new File(["video"], "video.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(file, "size", {
      value: 6 * 1024 * 1024,
      configurable: true,
    });

    createMyFileUploadSessionMock.mockResolvedValue({
      data: {
        clientToken: "upload-token",
        access: "public",
        pathname: "users/user_123/video.mp4",
        addRandomSuffix: true,
        maxSizeBytes: 1073741824,
      },
    });
    const onUploadProgress = vi.fn();
    putMock.mockImplementation(
      async (
        _pathname: string,
        _file: File,
        options: {
          onUploadProgress?: (progress: {
            loaded: number;
            total: number;
            percentage: number;
          }) => void;
        },
      ) => {
        options.onUploadProgress?.({
          loaded: file.size,
          total: file.size,
          percentage: 100,
        });

        return {
          url: "https://blob.example/users/user_123/video.mp4",
          pathname: "users/user_123/video.mp4",
          downloadUrl: "https://blob.example/download/video.mp4",
          etag: '"etag-456"',
        };
      },
    );

    await uploadUserFileDirect(file, { onUploadProgress });

    expect(putMock).toHaveBeenCalledWith(
      "users/user_123/video.mp4",
      file,
      expect.objectContaining({
        multipart: true,
        onUploadProgress: expect.any(Function),
      }),
    );
    expect(onUploadProgress).toHaveBeenCalledWith({
      loaded: file.size,
      total: file.size,
      percentage: 100,
    });
  });

  it("maps oversize Core errors to user-friendly messages", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    createMyFileUploadSessionMock.mockRejectedValue(
      new CoreApiRequestError("File exceeds maximum size of 1073741824 bytes", {
        status: 422,
      }),
    );

    await expect(uploadUserFileDirect(file)).rejects.toBeInstanceOf(
      UserFileUploadError,
    );

    await uploadUserFileDirect(file).catch((error: unknown) => {
      expect(error).toMatchObject({
        name: "UserFileUploadError",
        code: "too_large",
      } satisfies Partial<UserFileUploadError>);
      expect(error).toBeInstanceOf(UserFileUploadError);
      expect((error as Error).message).toContain("File is too large.");
      expect((error as Error).message).toContain("Maximum size is");
    });
  });

  it("replaces file inputs with uploaded URLs while preserving array order", async () => {
    const firstFile = new File(["first"], "first.pdf", {
      type: "application/pdf",
    });
    const secondFile = new File(["second"], "second.pdf", {
      type: "application/pdf",
    });
    const inputData = {
      document: firstFile,
      attachments: [firstFile, secondFile],
      prompt: "hello",
    };

    createMyFileUploadSessionMock
      .mockResolvedValueOnce({
        data: {
          clientToken: "token-1",
          access: "public",
          pathname: "users/user_123/first.pdf",
          addRandomSuffix: true,
          maxSizeBytes: 1073741824,
        },
      })
      .mockResolvedValueOnce({
        data: {
          clientToken: "token-2",
          access: "public",
          pathname: "users/user_123/first-array.pdf",
          addRandomSuffix: true,
          maxSizeBytes: 1073741824,
        },
      })
      .mockResolvedValueOnce({
        data: {
          clientToken: "token-3",
          access: "public",
          pathname: "users/user_123/second.pdf",
          addRandomSuffix: true,
          maxSizeBytes: 1073741824,
        },
      });
    putMock
      .mockResolvedValueOnce({
        url: "https://blob.example/users/user_123/first.pdf",
        pathname: "users/user_123/first.pdf",
        downloadUrl: "https://blob.example/download/first.pdf",
        etag: '"etag-1"',
      })
      .mockResolvedValueOnce({
        url: "https://blob.example/users/user_123/first-array.pdf",
        pathname: "users/user_123/first-array.pdf",
        downloadUrl: "https://blob.example/download/first-array.pdf",
        etag: '"etag-2"',
      })
      .mockResolvedValueOnce({
        url: "https://blob.example/users/user_123/second.pdf",
        pathname: "users/user_123/second.pdf",
        downloadUrl: "https://blob.example/download/second.pdf",
        etag: '"etag-3"',
      });

    await uploadInputDataFiles(inputData);

    expect(inputData).toEqual({
      document: "https://blob.example/users/user_123/first.pdf",
      attachments: [
        "https://blob.example/users/user_123/first-array.pdf",
        "https://blob.example/users/user_123/second.pdf",
      ],
      prompt: "hello",
    });
  });

  it("surfaces upload-specific fallback messages", () => {
    expect(
      getUserFileUploadErrorMessage(
        new Error("Blob upload broke"),
        "Custom fallback",
      ),
    ).toBe("Blob upload broke");
  });

  it("maps Vercel abort messages to the custom canceled message", () => {
    expect(
      getUserFileUploadErrorMessage(
        new Error("Vercel Blob: The request was aborted."),
      ),
    ).toBe("Upload canceled.");
  });
});
