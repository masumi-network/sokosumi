import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  uploadProjectBriefingFile,
  uploadProjectContextMdFile,
} from "./project-files-blob";

const { putMock, getEnvMock, captureExceptionMock } = vi.hoisted(() => ({
  putMock: vi.fn(),
  getEnvMock: vi.fn((): { BLOB_READ_WRITE_TOKEN: string | undefined } => ({
    BLOB_READ_WRITE_TOKEN: "blob_token",
  })),
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

describe("project markdown blob uploads", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "blob_token" });
  });

  it("uploads BRIEFING.md to its stable project path", async () => {
    putMock.mockResolvedValueOnce({ url: "https://blob.example/BRIEFING.md" });

    const url = await uploadProjectBriefingFile("project_123", "# Briefing");

    expect(putMock).toHaveBeenCalledWith(
      "projects/project_123/BRIEFING.md",
      "# Briefing",
      {
        access: "public",
        contentType: "text/markdown; charset=utf-8",
        token: "blob_token",
        allowOverwrite: true,
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      },
    );
    expect(url).toBe("https://blob.example/BRIEFING.md");
  });

  it("uploads CONTEXT.md to its stable project path", async () => {
    putMock.mockResolvedValueOnce({ url: "https://blob.example/CONTEXT.md" });

    const url = await uploadProjectContextMdFile("project_123", "# Context");

    expect(putMock).toHaveBeenCalledWith(
      "projects/project_123/CONTEXT.md",
      "# Context",
      expect.objectContaining({ cacheControlMaxAge: 60 }),
    );
    expect(url).toBe("https://blob.example/CONTEXT.md");
  });

  it("returns null and reports Blob failures", async () => {
    putMock.mockRejectedValueOnce(new Error("blob down"));

    await expect(
      uploadProjectBriefingFile("project_123", "# Briefing"),
    ).resolves.toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });

  it("returns null when Blob storage is not configured", async () => {
    getEnvMock.mockReturnValueOnce({ BLOB_READ_WRITE_TOKEN: undefined });

    await expect(
      uploadProjectContextMdFile("project_123", "# Context"),
    ).resolves.toBeNull();
    expect(putMock).not.toHaveBeenCalled();
  });
});
