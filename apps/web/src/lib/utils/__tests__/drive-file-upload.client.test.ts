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
  getDriveFileUploadErrorMessage,
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

  it("rejects when the Blob PUT returns a non-2xx status", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 });
    vi.stubGlobal("fetch", fetchMock);
    postDriveFilesMock.mockResolvedValue(grantSession());
    const onUploadProgress = vi.fn();

    await expect(
      uploadDriveFile(file, { scope: "me", onUploadProgress }),
    ).rejects.toThrow("Blob upload failed with status 409.");
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
      "Upload session missing uploadUrl",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getDriveFileUploadErrorMessage", () => {
  it("returns the Error message", () => {
    expect(
      getDriveFileUploadErrorMessage(
        new Error("Blob upload failed with status 413."),
      ),
    ).toBe("Blob upload failed with status 413.");
  });

  it("falls back for unknown values", () => {
    expect(getDriveFileUploadErrorMessage("nope")).toBe(
      "Failed to upload file",
    );
  });
});
