import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadDesignMdContent } from "./design-md-blob";

const { putMock, getEnvMock, captureExceptionMock } = vi.hoisted(() => ({
  putMock: vi.fn(),
  getEnvMock: vi.fn(() => ({ BLOB_READ_WRITE_TOKEN: "blob_token" })),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@vercel/blob", () => ({
  put: putMock,
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

describe("uploadDesignMdContent", () => {
  afterEach(() => {
    vi.resetAllMocks();
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "blob_token" });
  });

  it("puts under design-md/users/{userId}/ with content-hash filename", async () => {
    const content = "# Brand";
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    putMock.mockResolvedValueOnce({
      url: `https://blob.example/design-md/users/user_123/${hash}.md`,
    });

    const url = await uploadDesignMdContent({
      content,
      owner: { kind: "user", id: "user_123" },
    });

    expect(putMock).toHaveBeenCalledWith(
      `design-md/users/user_123/${hash}.md`,
      content,
      expect.objectContaining({
        access: "public",
        contentType: "text/markdown; charset=utf-8",
        allowOverwrite: true,
        addRandomSuffix: false,
        token: "blob_token",
      }),
    );
    expect(url).toBe(
      `https://blob.example/design-md/users/user_123/${hash}.md`,
    );
  });

  it("puts under design-md/organizations/{orgId}/ with extractionId prefix", async () => {
    const content = "# Org Brand";
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    putMock.mockResolvedValueOnce({
      url: `https://blob.example/design-md/organizations/org_99/55-${hash}.md`,
    });

    const url = await uploadDesignMdContent({
      content,
      owner: { kind: "organization", id: "org_99" },
      extractionId: "55",
    });

    expect(putMock).toHaveBeenCalledWith(
      `design-md/organizations/org_99/55-${hash}.md`,
      content,
      expect.objectContaining({
        contentType: "text/markdown; charset=utf-8",
        allowOverwrite: true,
        addRandomSuffix: false,
      }),
    );
    expect(url).toBe(
      `https://blob.example/design-md/organizations/org_99/55-${hash}.md`,
    );
  });

  it("puts under design-md/adhoc/{userId}/ for an ad hoc, non-persisted store", async () => {
    const content = "# Ad hoc Brand";
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    putMock.mockResolvedValueOnce({
      url: `https://blob.example/design-md/adhoc/user_123/${hash}.md`,
    });

    const url = await uploadDesignMdContent({
      content,
      owner: { kind: "adhoc", id: "user_123" },
    });

    expect(putMock).toHaveBeenCalledWith(
      `design-md/adhoc/user_123/${hash}.md`,
      content,
      expect.objectContaining({
        access: "public",
        contentType: "text/markdown; charset=utf-8",
        allowOverwrite: true,
        addRandomSuffix: false,
        token: "blob_token",
      }),
    );
    expect(url).toBe(
      `https://blob.example/design-md/adhoc/user_123/${hash}.md`,
    );
  });

  it("returns null when put fails", async () => {
    putMock.mockRejectedValueOnce(new Error("blob down"));

    const url = await uploadDesignMdContent({
      content: "# Brand",
      owner: { kind: "user", id: "user_123" },
    });

    expect(url).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("throws when blob token is missing", async () => {
    getEnvMock.mockReturnValueOnce({ BLOB_READ_WRITE_TOKEN: "" });

    await expect(
      uploadDesignMdContent({
        content: "# Brand",
        owner: { kind: "user", id: "user_123" },
      }),
    ).rejects.toThrow("BLOB_READ_WRITE_TOKEN is not configured");
  });
});
