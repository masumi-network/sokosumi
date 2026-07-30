import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlobUploadGrant } from "./blob-upload-grant";

const {
  issueSignedTokenMock,
  presignUrlMock,
  generateClientTokenFromReadWriteTokenMock,
} = vi.hoisted(() => ({
  issueSignedTokenMock: vi.fn(),
  presignUrlMock: vi.fn(),
  generateClientTokenFromReadWriteTokenMock: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  issueSignedToken: issueSignedTokenMock,
  presignUrl: presignUrlMock,
}));

vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken:
    generateClientTokenFromReadWriteTokenMock,
}));

describe("createBlobUploadGrant", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns a presigned PUT grant scoped to pathname and content type", async () => {
    issueSignedTokenMock.mockResolvedValue({
      delegationToken: "delegation",
      clientSigningToken: "signing",
      validUntil: Date.now() + 60_000,
    });
    presignUrlMock.mockResolvedValue({
      presignedUrl: "https://blob.example/upload?sig=1",
    });

    const before = Date.now();
    const result = await createBlobUploadGrant({
      pathname: "users/user_123/report.pdf",
      contentType: "application/pdf",
      maximumSizeInBytes: 2_048_000,
      maxSizeBytes: 52_428_800,
      access: "public",
      addRandomSuffix: true,
      token: "rw-token",
    });
    const after = Date.now();

    expect(issueSignedTokenMock).toHaveBeenCalledWith({
      token: "rw-token",
      pathname: "users/user_123/report.pdf",
      operations: ["put"],
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: 2_048_000,
      validUntil: expect.any(Number),
    });
    expect(presignUrlMock).toHaveBeenCalledWith(
      {
        delegationToken: "delegation",
        clientSigningToken: "signing",
        validUntil: expect.any(Number),
      },
      {
        operation: "put",
        pathname: "users/user_123/report.pdf",
        access: "public",
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: 2_048_000,
        addRandomSuffix: true,
        validUntil: expect.any(Number),
      },
    );
    expect(generateClientTokenFromReadWriteTokenMock).not.toHaveBeenCalled();

    expect(result).toEqual({
      uploadUrl: "https://blob.example/upload?sig=1",
      pathname: "users/user_123/report.pdf",
      access: "public",
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      expiresAt: expect.any(String),
      maxSizeBytes: 52_428_800,
      addRandomSuffix: true,
    });
    const expiresAtMs = Date.parse(result.expiresAt);
    expect(expiresAtMs).toBeGreaterThanOrEqual(before);
    expect(expiresAtMs).toBeLessThanOrEqual(after + 10 * 60 * 1000 + 50);
  });

  it("passes onUploadCompleted through to presignUrl", async () => {
    issueSignedTokenMock.mockResolvedValue({
      delegationToken: "delegation",
      clientSigningToken: "signing",
      validUntil: Date.now() + 60_000,
    });
    presignUrlMock.mockResolvedValue({
      presignedUrl: "https://blob.example/upload?sig=1",
    });

    await createBlobUploadGrant({
      pathname: "tasks/tsk_1/out.pdf",
      contentType: "application/pdf",
      maximumSizeInBytes: 100,
      maxSizeBytes: 50_000_000,
      access: "public",
      addRandomSuffix: true,
      token: "rw-token",
      onUploadCompleted: {
        callbackUrl: "https://core.example/v1/webhooks/tasks/files/uploaded",
        tokenPayload: JSON.stringify({ taskId: "tsk_1" }),
      },
    });

    expect(presignUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        onUploadCompleted: {
          callbackUrl: "https://core.example/v1/webhooks/tasks/files/uploaded",
          tokenPayload: JSON.stringify({ taskId: "tsk_1" }),
        },
      }),
    );
  });

  it("includes a legacy client token when requested", async () => {
    issueSignedTokenMock.mockResolvedValue({
      delegationToken: "delegation",
      clientSigningToken: "signing",
      validUntil: Date.now() + 60_000,
    });
    presignUrlMock.mockResolvedValue({
      presignedUrl: "https://blob.example/upload?sig=1",
    });
    generateClientTokenFromReadWriteTokenMock.mockResolvedValue(
      "client-token-123",
    );

    const result = await createBlobUploadGrant({
      pathname: "tasks/tsk_1/out.pdf",
      contentType: "application/pdf",
      maximumSizeInBytes: 100,
      maxSizeBytes: 50_000_000,
      access: "public",
      addRandomSuffix: true,
      token: "rw-token",
      allowedContentTypes: ["application/pdf", "text/plain"],
      includeClientToken: true,
    });

    expect(generateClientTokenFromReadWriteTokenMock).toHaveBeenCalledWith({
      token: "rw-token",
      pathname: "tasks/tsk_1/out.pdf",
      allowedContentTypes: ["application/pdf", "text/plain"],
      maximumSizeInBytes: 100,
      validUntil: expect.any(Number),
      addRandomSuffix: true,
    });
    expect(result.clientToken).toBe("client-token-123");
  });
});
