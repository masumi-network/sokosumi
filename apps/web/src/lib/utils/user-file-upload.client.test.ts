import { beforeEach, describe, expect, it, vi } from "vitest";

const createMyFileUploadSessionMock = vi.fn();

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

import { CoreApiRequestError } from "@/lib/clients/core.browser.client";
import {
  getUserFileUploadErrorMessage,
  UserFileUploadError,
  uploadInputDataFiles,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

interface MockXhrHandlers {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  upload: {
    onprogress: ((event: ProgressEvent) => void) | null;
  };
  status: number;
  responseText: string;
  open: ReturnType<typeof vi.fn>;
  setRequestHeader: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  getResponseHeader: ReturnType<typeof vi.fn>;
}

function stubSuccessfulXhr(body: Record<string, string>) {
  const instances: MockXhrHandlers[] = [];

  class MockXHR {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
    status = 200;
    responseText = JSON.stringify(body);
    responseType = "";
    open = vi.fn();
    setRequestHeader = vi.fn();
    abort = vi.fn();
    getResponseHeader = vi.fn().mockReturnValue(null);
    send = vi.fn(() => {
      queueMicrotask(() => {
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 2,
          total: 5,
        } as ProgressEvent);
        this.onload?.();
      });
    });

    constructor() {
      instances.push(this);
    }
  }

  vi.stubGlobal("XMLHttpRequest", MockXHR);
  return instances;
}

function grantSession(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      uploadUrl: "https://blob.example/upload?sig=1",
      access: "public",
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      pathname: "users/user_123/report.pdf",
      addRandomSuffix: true,
      maxSizeBytes: 1073741824,
      expiresAt: "2026-07-30T12:15:00.000Z",
      ...overrides,
    },
  };
}

describe("user-file-upload.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates an upload session and PUTs via presigned uploadUrl", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    createMyFileUploadSessionMock.mockResolvedValue(grantSession());
    const instances = stubSuccessfulXhr({
      url: "https://blob.example/users/user_123/report-abc.pdf",
      pathname: "users/user_123/report-abc.pdf",
      downloadUrl: "https://blob.example/download/report-abc.pdf",
      etag: '"etag-123"',
    });

    await expect(uploadUserFileDirect(file)).resolves.toEqual({
      publicUrl: "https://blob.example/users/user_123/report-abc.pdf",
      metadata: {
        pathname: "users/user_123/report-abc.pdf",
        downloadUrl: "https://blob.example/download/report-abc.pdf",
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
    expect(instances[0]?.open).toHaveBeenCalledWith(
      "PUT",
      "https://blob.example/upload?sig=1",
    );
    expect(instances[0]?.setRequestHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/pdf",
    );
    expect(instances[0]?.send).toHaveBeenCalledWith(file);
  });

  it("reports upload progress from XHR while using the same PUT path", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const onUploadProgress = vi.fn();

    createMyFileUploadSessionMock.mockResolvedValue(grantSession());
    stubSuccessfulXhr({
      url: "https://blob.example/users/user_123/report.pdf",
      pathname: "users/user_123/report.pdf",
      downloadUrl: "https://blob.example/download/report.pdf",
      etag: '"etag-123"',
    });

    await uploadUserFileDirect(file, { onUploadProgress });

    expect(onUploadProgress).toHaveBeenCalledWith({
      loaded: 2,
      total: 5,
      percentage: 40,
    });
    expect(onUploadProgress).toHaveBeenCalledWith({
      loaded: 5,
      total: 5,
      percentage: 100,
    });
  });

  it("infers content type from the file name when the browser leaves file.type empty", async () => {
    const file = new File(["hello"], "report.pdf", { type: "" });

    createMyFileUploadSessionMock.mockResolvedValue(grantSession());
    stubSuccessfulXhr({
      url: "https://blob.example/users/user_123/report.pdf",
      pathname: "users/user_123/report.pdf",
      downloadUrl: "https://blob.example/download/report.pdf",
      etag: '"etag-123"',
    });

    await uploadUserFileDirect(file);

    expect(createMyFileUploadSessionMock).toHaveBeenCalledWith({
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 5,
    });
  });

  it("includes custom upload constraints in the session request", async () => {
    const file = new File(["x"], "logo.png", { type: "image/png" });

    createMyFileUploadSessionMock.mockResolvedValue(
      grantSession({
        uploadUrl: "https://blob.example/upload?sig=logo",
        headers: { "Content-Type": "image/png" },
        pathname: "users/user_123/logo.png",
        maxSizeBytes: 2_097_152,
      }),
    );
    stubSuccessfulXhr({
      url: "https://blob.example/users/user_123/logo.png",
      pathname: "users/user_123/logo.png",
      downloadUrl: "https://blob.example/download/logo.png",
      etag: '"etag-456"',
    });

    await uploadUserFileDirect(file, {
      allowedContentTypes: ["image/png", "image/jpeg"],
      maxSizeBytes: 2_097_152,
    });

    expect(createMyFileUploadSessionMock).toHaveBeenCalledWith({
      filename: "logo.png",
      contentType: "image/png",
      size: 1,
      allowedContentTypes: ["image/png", "image/jpeg"],
      maxSizeBytes: 2_097_152,
    });
  });

  it("aborts the XHR when the abort signal fires", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const abortController = new AbortController();
    const instances: MockXhrHandlers[] = [];

    class MockXHR {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
      status = 200;
      responseText = "";
      responseType = "";
      open = vi.fn();
      setRequestHeader = vi.fn();
      getResponseHeader = vi.fn();
      abort = vi.fn(() => {
        this.onabort?.();
      });
      send = vi.fn(() => {
        abortController.abort();
      });

      constructor() {
        instances.push(this);
      }
    }

    createMyFileUploadSessionMock.mockResolvedValue(grantSession());
    vi.stubGlobal("XMLHttpRequest", MockXHR);

    await expect(
      uploadUserFileDirect(file, { abortSignal: abortController.signal }),
    ).rejects.toMatchObject({
      name: "UserFileUploadError",
      code: "aborted",
    });
    expect(instances[0]?.abort).toHaveBeenCalled();
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

    const responses = [
      {
        url: "https://blob.example/users/user_123/first.pdf",
        pathname: "users/user_123/first.pdf",
        downloadUrl: "https://blob.example/download/first.pdf",
        etag: '"etag-1"',
      },
      {
        url: "https://blob.example/users/user_123/first-array.pdf",
        pathname: "users/user_123/first-array.pdf",
        downloadUrl: "https://blob.example/download/first-array.pdf",
        etag: '"etag-2"',
      },
      {
        url: "https://blob.example/users/user_123/second.pdf",
        pathname: "users/user_123/second.pdf",
        downloadUrl: "https://blob.example/download/second.pdf",
        etag: '"etag-3"',
      },
    ];
    let responseIndex = 0;

    createMyFileUploadSessionMock
      .mockResolvedValueOnce(
        grantSession({ pathname: "users/user_123/first.pdf" }),
      )
      .mockResolvedValueOnce(
        grantSession({ pathname: "users/user_123/first-array.pdf" }),
      )
      .mockResolvedValueOnce(
        grantSession({ pathname: "users/user_123/second.pdf" }),
      );

    class MockXHR {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
      status = 200;
      responseText = "";
      responseType = "";
      open = vi.fn();
      setRequestHeader = vi.fn();
      abort = vi.fn();
      getResponseHeader = vi.fn().mockReturnValue(null);
      send = vi.fn(() => {
        const body = responses[responseIndex++];
        this.responseText = JSON.stringify(body);
        queueMicrotask(() => this.onload?.());
      });
    }

    vi.stubGlobal("XMLHttpRequest", MockXHR);

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

  it("maps AbortError to the canceled message", () => {
    const error = new Error("Aborted");
    error.name = "AbortError";
    expect(getUserFileUploadErrorMessage(error)).toBe("Upload canceled.");
  });
});
