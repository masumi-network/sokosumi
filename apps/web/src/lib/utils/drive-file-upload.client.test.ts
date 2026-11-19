import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postDriveFilesMock = vi.fn();
const finalizeDriveFileMock = vi.fn();
const getBrowserCoreClientMock = vi.fn(() => ({ id: "browser-core-client" }));

vi.mock("@sokosumi/core-client", () => ({
  postDriveFiles: (...args: unknown[]) => postDriveFilesMock(...args),
  postDriveFilesFinalize: (...args: unknown[]) =>
    finalizeDriveFileMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => getBrowserCoreClientMock(),
}));

import { uploadDriveFile } from "@/lib/utils/drive-file-upload.client";

function grantSession(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      data: {
        uploadUrl: "https://blob.example/upload?sig=1",
        pathname: "drive/users/user_123/report.pdf",
        access: "public",
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        expiresAt: "2026-08-18T12:00:00.000Z",
        maxSizeBytes: 104_857_600,
        addRandomSuffix: false,
        ...overrides,
      },
    },
  };
}

const ATTEMPT = "0f9d2c1e-8b7a-4c3d-9e1f-2a3b4c5d6e7f";

function mockXHR(status: number, responseText = "") {
  let lastInstance: Record<string, unknown> | null = null;

  const constructor = function XMLHttpRequestMock(
    this: Record<string, unknown>,
  ) {
    lastInstance = this;
    this.open = vi.fn();
    this.send = vi.fn();
    this.setRequestHeader = vi.fn();
    this.status = status;
    this.responseText = responseText;
    this.upload = {
      addEventListener: vi.fn(),
    };
    this.addEventListener = vi.fn(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === "load") {
          setTimeout(() => {
            handler();
          }, 0);
        }
      },
    );
  } as unknown as typeof XMLHttpRequest;

  return { constructor, getInstance: () => lastInstance };
}

describe("uploadDriveFile", () => {
  let originalXHR: typeof XMLHttpRequest;

  beforeEach(() => {
    vi.clearAllMocks();
    finalizeDriveFileMock.mockResolvedValue({
      data: { data: { resourceId: "file-1", fileUrl: null } },
    });
    vi.unstubAllGlobals();
    originalXHR = globalThis.XMLHttpRequest;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR;
  });

  it("mints a staged session and PUTs the file to the presigned URL", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    // The PUT lands on the attempt's staging key; its URL is not the file's.
    const { constructor, getInstance } = mockXHR(
      200,
      JSON.stringify({
        url: "https://store.public.blob.vercel-storage.com/drive-staging/v/report.pdf",
        pathname: "drive-staging/v/report.pdf",
      }),
    );
    vi.stubGlobal("XMLHttpRequest", constructor);
    postDriveFilesMock.mockResolvedValue(grantSession({ attemptId: ATTEMPT }));
    const onUploadProgress = vi.fn();
    finalizeDriveFileMock.mockResolvedValue({
      data: {
        data: {
          resourceId: "file-1",
          fileUrl:
            "https://store.public.blob.vercel-storage.com/drive/users/user_123/report.pdf",
        },
      },
    });

    const uploaded = await uploadDriveFile(file, {
      scope: "me",
      onUploadProgress,
    });

    expect(uploaded).toEqual({
      resourceId: "file-1",
      pathname: "drive/users/user_123/report.pdf",
      fileUrl:
        "https://store.public.blob.vercel-storage.com/drive/users/user_123/report.pdf",
    });
    const xhrInstance = getInstance();
    expect(postDriveFilesMock).toHaveBeenCalledWith({
      client: { id: "browser-core-client" },
      body: {
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 5,
        scope: "me",
        staged: true,
      },
      throwOnError: false,
    });
    expect(finalizeDriveFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          scope: "me",
          pathname: "drive/users/user_123/report.pdf",
          attemptId: ATTEMPT,
        },
      }),
    );
    expect(xhrInstance?.open).toHaveBeenCalledWith(
      "PUT",
      "https://blob.example/upload?sig=1",
    );
    expect(xhrInstance?.setRequestHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/pdf",
    );
    expect(xhrInstance?.send).toHaveBeenCalledWith(file);
    expect(onUploadProgress).toHaveBeenCalledWith({ percentage: 100 });
  });

  it("uploads once more the released way when a staged finalize keeps failing", async () => {
    // A Core rolled back mid-session cannot publish the staged attempt.
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const { constructor } = mockXHR(
      200,
      JSON.stringify({ url: "https://blob.example/drive/users/u/report.pdf" }),
    );
    vi.stubGlobal("XMLHttpRequest", constructor);
    postDriveFilesMock
      .mockResolvedValueOnce(grantSession({ attemptId: ATTEMPT }))
      .mockResolvedValueOnce(grantSession());
    finalizeDriveFileMock
      .mockRejectedValueOnce(new Error("404"))
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: { data: { resourceId: "file-1" } } });

    await expect(uploadDriveFile(file, { scope: "me" })).resolves.toEqual({
      pathname: "drive/users/user_123/report.pdf",
      fileUrl: "https://blob.example/drive/users/u/report.pdf",
      resourceId: "file-1",
    });
    expect(postDriveFilesMock.mock.calls[1][0].body).not.toHaveProperty(
      "staged",
    );
  });

  it("never falls back for a copy: it fails instead", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const { constructor } = mockXHR(200);
    vi.stubGlobal("XMLHttpRequest", constructor);
    postDriveFilesMock.mockResolvedValue(grantSession({ attemptId: ATTEMPT }));
    finalizeDriveFileMock.mockRejectedValue(new Error("503"));

    await expect(
      uploadDriveFile(file, { scope: "me", pinLabelsEmpty: true }),
    ).rejects.toMatchObject({ code: "internal" });
    expect(finalizeDriveFileMock).toHaveBeenCalledTimes(2);
    expect(postDriveFilesMock).toHaveBeenCalledTimes(1);
  });

  it("retries a staged finalize once before failing", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const { constructor } = mockXHR(200);
    vi.stubGlobal("XMLHttpRequest", constructor);
    postDriveFilesMock.mockResolvedValue(grantSession({ attemptId: ATTEMPT }));
    finalizeDriveFileMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        data: { data: { resourceId: "file-1", fileUrl: "https://x/f.pdf" } },
      });

    await expect(uploadDriveFile(file, { scope: "me" })).resolves.toEqual({
      pathname: "drive/users/user_123/report.pdf",
      fileUrl: "https://x/f.pdf",
      resourceId: "file-1",
    });
  });

  describe("against a Core that only knows the released flow", () => {
    it("keeps the PUT URL and treats finalize as best effort", async () => {
      const file = new File(["hello"], "report.pdf", {
        type: "application/pdf",
      });
      const { constructor } = mockXHR(
        200,
        JSON.stringify({
          url: "https://blob.example/drive/users/u/report.pdf",
        }),
      );
      vi.stubGlobal("XMLHttpRequest", constructor);
      postDriveFilesMock.mockResolvedValue(grantSession());
      finalizeDriveFileMock.mockRejectedValue(new Error("503"));

      await expect(uploadDriveFile(file, { scope: "me" })).resolves.toEqual({
        pathname: "drive/users/user_123/report.pdf",
        fileUrl: "https://blob.example/drive/users/u/report.pdf",
      });
      expect(finalizeDriveFileMock.mock.calls[0][0].body).not.toHaveProperty(
        "attemptId",
      );
    });

    it("resolves with a null file URL when the PUT response has none", async () => {
      const file = new File(["hello"], "report.pdf", {
        type: "application/pdf",
      });
      const { constructor } = mockXHR(200);
      vi.stubGlobal("XMLHttpRequest", constructor);
      postDriveFilesMock.mockResolvedValue(grantSession());
      finalizeDriveFileMock.mockResolvedValue({ data: undefined });

      await expect(uploadDriveFile(file, { scope: "me" })).resolves.toEqual({
        pathname: "drive/users/user_123/report.pdf",
        fileUrl: null,
      });
    });

    it("never PUTs a copy, which would be labelled like any upload", async () => {
      const file = new File(["hello"], "report.pdf", {
        type: "application/pdf",
      });
      const { constructor, getInstance } = mockXHR(200);
      vi.stubGlobal("XMLHttpRequest", constructor);
      postDriveFilesMock.mockResolvedValue(grantSession());

      await expect(
        uploadDriveFile(file, { scope: "me", pinLabelsEmpty: true }),
      ).rejects.toMatchObject({ code: "internal" });
      expect(getInstance()).toBeNull();
    });
  });

  it("rejects with duplicate error when Blob PUT returns 409", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const { constructor } = mockXHR(409);
    vi.stubGlobal("XMLHttpRequest", constructor);
    postDriveFilesMock.mockResolvedValue(grantSession());
    const onUploadProgress = vi.fn();

    await expect(
      uploadDriveFile(file, { scope: "me", onUploadProgress }),
    ).rejects.toMatchObject({
      code: "duplicate",
      name: "DriveFileUploadError",
    });

    expect(onUploadProgress).not.toHaveBeenCalled();
  });

  it("rejects with internal error when Blob PUT returns 500", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const { constructor } = mockXHR(500);
    vi.stubGlobal("XMLHttpRequest", constructor);
    postDriveFilesMock.mockResolvedValue(grantSession());
    const onUploadProgress = vi.fn();

    await expect(
      uploadDriveFile(file, { scope: "me", onUploadProgress }),
    ).rejects.toMatchObject({
      code: "internal",
      name: "DriveFileUploadError",
    });

    expect(onUploadProgress).not.toHaveBeenCalled();
  });

  it("includes organizationId when minting an org-scope upload", async () => {
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    const { constructor } = mockXHR(
      200,
      JSON.stringify({
        url: "https://store.public.blob.vercel-storage.com/drive/organizations/org_123/notes.txt",
      }),
    );
    vi.stubGlobal("XMLHttpRequest", constructor);
    postDriveFilesMock.mockResolvedValue(
      grantSession({
        uploadUrl: "https://blob.example/upload?sig=org",
        headers: { "Content-Type": "text/plain" },
      }),
    );

    await uploadDriveFile(file, {
      scope: "org",
      organizationId: "org_123",
    });

    expect(postDriveFilesMock).toHaveBeenCalledWith({
      client: { id: "browser-core-client" },
      body: {
        filename: "notes.txt",
        contentType: "text/plain",
        size: 1,
        scope: "org",
        organizationId: "org_123",
        staged: true,
      },
      throwOnError: false,
    });
  });

  it("throws before PUT when the mint response has no uploadUrl", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const { constructor, getInstance } = mockXHR(200);
    vi.stubGlobal("XMLHttpRequest", constructor);
    postDriveFilesMock.mockResolvedValue(grantSession({ uploadUrl: "" }));

    await expect(uploadDriveFile(file, { scope: "me" })).rejects.toMatchObject({
      code: "internal",
      name: "DriveFileUploadError",
    });

    expect(getInstance()).toBeNull();
  });

  it("detects duplicate from mint 409", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    postDriveFilesMock.mockRejectedValue({
      status: 409,
      message: "Conflict",
    });

    await expect(uploadDriveFile(file, { scope: "me" })).rejects.toMatchObject({
      code: "duplicate",
      name: "DriveFileUploadError",
    });
  });

  it("detects duplicate from Blob PUT 400 with 'already exists' body", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const { constructor } = mockXHR(
      400,
      "BlobAlreadyExists: The blob already exists.",
    );
    vi.stubGlobal("XMLHttpRequest", constructor);
    postDriveFilesMock.mockResolvedValue(grantSession());

    await expect(uploadDriveFile(file, { scope: "me" })).rejects.toMatchObject({
      code: "duplicate",
      name: "DriveFileUploadError",
    });
  });
});
