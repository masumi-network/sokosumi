import { beforeEach, describe, expect, it, vi } from "vitest";

const createOrganizationLogoUploadSessionMock = vi.fn();
const cleanupOrganizationLogoMock = vi.fn();

vi.mock("@/lib/clients/core.browser.client", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/clients/core.browser.client")
  >("@/lib/clients/core.browser.client");

  return {
    ...actual,
    coreClient: {
      createOrganizationLogoUploadSession: (...args: unknown[]) =>
        createOrganizationLogoUploadSessionMock(...args),
      cleanupOrganizationLogo: (...args: unknown[]) =>
        cleanupOrganizationLogoMock(...args),
    },
  };
});

import { CoreApiRequestError } from "@/lib/clients/core.browser.client";
import {
  cleanupOrganizationLogoBestEffort,
  UserFileUploadError,
  uploadOrganizationLogoDirect,
} from "@/lib/utils/organization-logo-upload.client";

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
      headers: { "Content-Type": "image/png" },
      pathname: "organizations/org_123/logos/logo.png",
      addRandomSuffix: true,
      maxSizeBytes: 5_242_880,
      expiresAt: "2026-07-30T12:15:00.000Z",
      ...overrides,
    },
  };
}

describe("organization-logo-upload.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("requires a non-empty organizationId", async () => {
    const file = new File(["x"], "logo.png", { type: "image/png" });

    await expect(uploadOrganizationLogoDirect("", file)).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(
      uploadOrganizationLogoDirect("   ", file),
    ).rejects.toBeInstanceOf(UserFileUploadError);
    expect(createOrganizationLogoUploadSessionMock).not.toHaveBeenCalled();
  });

  it("mints via org files endpoint and PUTs via presigned URL", async () => {
    const file = new File(["logo"], "logo.png", { type: "image/png" });

    createOrganizationLogoUploadSessionMock.mockResolvedValue(grantSession());
    stubSuccessfulXhr({
      url: "https://blob.example/organizations/org_123/logos/logo-abc.png",
      pathname: "organizations/org_123/logos/logo-abc.png",
      downloadUrl: "https://blob.example/download/logo-abc.png",
      etag: '"etag-org"',
    });

    await expect(
      uploadOrganizationLogoDirect("org_123", file, {
        maxSizeBytes: 5_242_880,
      }),
    ).resolves.toEqual({
      publicUrl:
        "https://blob.example/organizations/org_123/logos/logo-abc.png",
      metadata: {
        pathname: "organizations/org_123/logos/logo-abc.png",
        downloadUrl: "https://blob.example/download/logo-abc.png",
        size: 4,
        uploadedAt: expect.any(Date),
        etag: '"etag-org"',
      },
    });

    expect(createOrganizationLogoUploadSessionMock).toHaveBeenCalledWith(
      "org_123",
      {
        filename: "logo.png",
        contentType: "image/png",
        size: 4,
        maxSizeBytes: 5_242_880,
      },
    );
  });

  it("maps Core mint failures to UserFileUploadError", async () => {
    const file = new File(["logo"], "logo.png", { type: "image/png" });
    createOrganizationLogoUploadSessionMock.mockRejectedValue(
      new CoreApiRequestError("Unsupported content type: image/gif", {
        status: 422,
      }),
    );

    await expect(
      uploadOrganizationLogoDirect("org_123", file),
    ).rejects.toMatchObject({
      code: "unsupported_type",
    });
  });

  it("soft-fails cleanup errors", async () => {
    cleanupOrganizationLogoMock.mockRejectedValue(new Error("boom"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      cleanupOrganizationLogoBestEffort(
        "org_123",
        "https://blob.example/organizations/org_123/logos/old.png",
      ),
    ).resolves.toBeUndefined();

    expect(cleanupOrganizationLogoMock).toHaveBeenCalledWith("org_123", {
      url: "https://blob.example/organizations/org_123/logos/old.png",
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("skips cleanup when url or organizationId is empty", async () => {
    await cleanupOrganizationLogoBestEffort("", "https://example.com/a.png");
    await cleanupOrganizationLogoBestEffort("org_123", "");
    await cleanupOrganizationLogoBestEffort("org_123", null);
    expect(cleanupOrganizationLogoMock).not.toHaveBeenCalled();
  });
});
