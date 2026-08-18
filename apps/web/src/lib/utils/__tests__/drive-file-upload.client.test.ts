import { beforeEach, describe, expect, it, vi } from "vitest";

const postDriveFilesMock = vi.fn();
const getBrowserCoreClientMock = vi.fn(() => ({ id: "browser-core-client" }));

vi.mock("@/lib/clients/generated/core", () => ({
  postDriveFiles: (...args: unknown[]) => postDriveFilesMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => getBrowserCoreClientMock(),
}));

import {
  DriveFileUploadError,
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";

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

describe("uploadDriveFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("mints a session and PUTs the file to the presigned URL", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    postDriveFilesMock.mockResolvedValue(grantSession());
    const onUploadProgress = vi.fn();

    await uploadDriveFile(file, {
      scope: "me",
      onUploadProgress,
    });

    expect(postDriveFilesMock).toHaveBeenCalledWith({
      client: { id: "browser-core-client" },
      body: {
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 5,
        scope: "me",
      },
      throwOnError: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://blob.example/upload?sig=1",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
        },
        body: file,
      },
    );
    expect(onUploadProgress).toHaveBeenCalledWith({ percentage: 100 });
  });

  it("rejects with duplicate error when Blob PUT returns 409", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 });
    vi.stubGlobal("fetch", fetchMock);
    postDriveFilesMock.mockResolvedValue(grantSession());
    const onUploadProgress = vi.fn();

    await expect(
      uploadDriveFile(file, { scope: "me", onUploadProgress }),
    ).rejects.toThrow(DriveFileUploadError);

    try {
      await uploadDriveFile(file, { scope: "me", onUploadProgress });
    } catch (err) {
      expect(isDriveFileUploadDuplicate(err)).toBe(true);
    }

    expect(onUploadProgress).not.toHaveBeenCalled();
  });

  it("rejects with internal error when Blob PUT returns 500", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    postDriveFilesMock.mockResolvedValue(grantSession());
    const onUploadProgress = vi.fn();

    await expect(
      uploadDriveFile(file, { scope: "me", onUploadProgress }),
    ).rejects.toThrow(DriveFileUploadError);

    try {
      await uploadDriveFile(file, { scope: "me", onUploadProgress });
    } catch (err) {
      expect(isDriveFileUploadDuplicate(err)).toBe(false);
    }

    expect(onUploadProgress).not.toHaveBeenCalled();
  });

  it("includes organizationId when minting an org-scope upload", async () => {
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
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
      },
      throwOnError: true,
    });
  });

  it("throws before PUT when the mint response has no uploadUrl", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    postDriveFilesMock.mockResolvedValue(grantSession({ uploadUrl: "" }));

    await expect(uploadDriveFile(file, { scope: "me" })).rejects.toThrow(
      DriveFileUploadError,
    );

    try {
      await uploadDriveFile(file, { scope: "me" });
    } catch (err) {
      expect(isDriveFileUploadDuplicate(err)).toBe(false);
      expect(err).toBeInstanceOf(DriveFileUploadError);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("detects duplicate from mint 409", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    postDriveFilesMock.mockRejectedValue({
      status: 409,
      message: "Conflict",
    });

    try {
      await uploadDriveFile(file, { scope: "me" });
    } catch (err) {
      expect(isDriveFileUploadDuplicate(err)).toBe(true);
    }
  });

  it("detects duplicate from Blob PUT 400 with 'already exists' body", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "BlobAlreadyExists: The blob already exists.",
    });
    vi.stubGlobal("fetch", fetchMock);
    postDriveFilesMock.mockResolvedValue(grantSession());

    try {
      await uploadDriveFile(file, { scope: "me" });
    } catch (err) {
      expect(isDriveFileUploadDuplicate(err)).toBe(true);
    }
  });
});
