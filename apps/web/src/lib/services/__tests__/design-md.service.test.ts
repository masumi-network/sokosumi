import { MemberRole } from "@sokosumi/database";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@/lib/auth/auth";

export {};

vi.mock("server-only", () => ({}));

const submitMock = vi.fn();
const pollJobMock = vi.fn();

vi.mock("@sokosumi/masumi/tools", () => ({
  buildDesignMdPreviewUrl: (baseUrl: string, extractionId: string | number) =>
    `${baseUrl.replace(/\/$/, "")}/tools/design-md?cached=${extractionId}`,
  createDesignMdClient: () => ({
    pollJob: (...args: unknown[]) => pollJobMock(...args),
    submit: (...args: unknown[]) => submitMock(...args),
  }),
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_MASUMI_URL: "https://masumi.example",
  }),
}));

interface EnvSecretsMock {
  BETTER_AUTH_SECRET: string;
  MASUMI_DESIGN_MD_API_KEY?: string;
  MASUMI_DESIGN_MD_API_URL: string;
}

const getEnvSecretsMock = vi.fn<() => EnvSecretsMock>(() => ({
  BETTER_AUTH_SECRET: "test-secret",
  MASUMI_DESIGN_MD_API_KEY: "api-key",
  MASUMI_DESIGN_MD_API_URL: "https://masumi.example/api/v1",
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

const getMyMemberInOrganizationMock = vi.fn();
const getOrganizationDesignMdMock = vi.fn();
const getMyDesignMdMock = vi.fn();
const patchMyDesignMdMock = vi.fn();
const patchOrganizationDesignMdMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getMyDesignMd: (...args: unknown[]) => getMyDesignMdMock(...args),
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
    getOrganizationDesignMd: (...args: unknown[]) =>
      getOrganizationDesignMdMock(...args),
    patchMyDesignMd: (...args: unknown[]) => patchMyDesignMdMock(...args),
    patchOrganizationDesignMd: (...args: unknown[]) =>
      patchOrganizationDesignMdMock(...args),
  },
}));

const uploadDesignMdToBlobMock = vi.fn();

vi.mock("@/lib/blob/design-md", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob/design-md")>();
  return {
    ...actual,
    uploadDesignMdToBlob: (...args: unknown[]) =>
      uploadDesignMdToBlobMock(...args),
  };
});

const session = {
  session: {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    id: "session-1",
    token: "session-token",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    userId: "user-1",
  },
  user: {
    id: "user-1",
  },
} as Session;

describe("designMdService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    uploadDesignMdToBlobMock.mockResolvedValue(
      "https://blob.example/design-md/42-hash.md",
    );
    patchMyDesignMdMock.mockResolvedValue({
      data: {
        extractionId: "42",
        previewUrl: "https://www.masumi.example/tools/design-md?cached=42",
        url: "https://blob.example/design-md/42-hash.md",
      },
    });
    patchOrganizationDesignMdMock.mockResolvedValue({
      data: {
        extractionId: null,
        previewUrl: null,
        url: "https://store.public.blob.vercel-storage.com/users/user-1/manual-design.md",
      },
    });
  });

  it("returns a queued job token when generation is queued", async () => {
    submitMock.mockResolvedValue(
      ok({
        jobId: "job_1",
        status: "queued",
      }),
    );

    const { designMdService } = await import("../design-md.service");
    const result = await designMdService.startDesignMdGeneration(
      session,
      { type: "user" },
      "https://example.com",
    );

    expect(result).toEqual({
      kind: "queued",
      jobId: "job_1",
      jobToken: expect.any(String),
    });
  });

  it("rejects polling without a valid job token", async () => {
    const { designMdService } = await import("../design-md.service");

    await expect(
      designMdService.pollDesignMdJob(
        session,
        { type: "user" },
        "job_1",
        "invalid-token",
      ),
    ).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(pollJobMock).not.toHaveBeenCalled();
  });

  it("polls a queued job when the token is valid", async () => {
    submitMock.mockResolvedValue(
      ok({
        jobId: "job_1",
        status: "queued",
      }),
    );
    pollJobMock.mockResolvedValue(
      ok({
        designMd: "# Brand",
        extractionId: 42,
        status: "done",
      }),
    );

    const { designMdService } = await import("../design-md.service");
    const started = await designMdService.startDesignMdGeneration(
      session,
      { type: "user" },
      "https://example.com",
    );

    if (started.kind !== "queued") {
      throw new Error("Expected queued job");
    }

    const polled = await designMdService.pollDesignMdJob(
      session,
      { type: "user" },
      started.jobId,
      started.jobToken,
    );

    expect(polled.status).toBe("done");
    expect(pollJobMock).toHaveBeenCalledWith("job_1");
  });

  it("finalizes by polling on the server and persisting uploaded markdown", async () => {
    submitMock.mockResolvedValue(
      ok({
        jobId: "job_1",
        status: "queued",
      }),
    );
    pollJobMock.mockResolvedValue(
      ok({
        designMd: "# Brand",
        extractionId: 42,
        status: "done",
      }),
    );

    const { designMdService } = await import("../design-md.service");
    const started = await designMdService.startDesignMdGeneration(
      session,
      { type: "user" },
      "https://example.com",
    );

    if (started.kind !== "queued") {
      throw new Error("Expected queued job");
    }

    const persisted = await designMdService.finalizeAndPersistDesignMd(
      session,
      { type: "user" },
      started.jobId,
      started.jobToken,
    );

    expect(uploadDesignMdToBlobMock).toHaveBeenCalledWith({
      designMd: "# Brand",
      extractionId: "42",
    });
    expect(patchMyDesignMdMock).toHaveBeenCalledWith({
      extractionId: "42",
      url: "https://blob.example/design-md/42-hash.md",
    });
    expect(persisted).toEqual({
      extractionId: "42",
      previewUrl: "https://www.masumi.example/tools/design-md?cached=42",
      url: "https://blob.example/design-md/42-hash.md",
    });
  });

  it("requires organization admin access for organization owners", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      data: { role: MemberRole.MEMBER },
    });

    const { designMdService } = await import("../design-md.service");

    await expect(
      designMdService.startDesignMdGeneration(
        session,
        { type: "organization", organizationId: "org-1" },
        "https://example.com",
      ),
    ).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("clears extractionId when saving a manual upload URL", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      data: { role: MemberRole.ADMIN },
    });
    const uploadedUrl =
      "https://store.public.blob.vercel-storage.com/users/user-1/manual-design.md";
    patchOrganizationDesignMdMock.mockResolvedValue({
      data: {
        extractionId: null,
        previewUrl: null,
        url: uploadedUrl,
      },
    });

    const { designMdService } = await import("../design-md.service");
    const persisted = await designMdService.persistUploadedDesignMd(
      session,
      { type: "organization", organizationId: "org-1" },
      uploadedUrl,
    );

    expect(patchOrganizationDesignMdMock).toHaveBeenCalledWith("org-1", {
      extractionId: null,
      url: uploadedUrl,
    });
    expect(persisted.url).toBe(uploadedUrl);
    expect(persisted.extractionId).toBeNull();
  });

  it("rejects manual upload URLs outside Sokosumi blob storage", async () => {
    const { designMdService } = await import("../design-md.service");

    await expect(
      designMdService.persistUploadedDesignMd(
        session,
        { type: "user" },
        "https://evil.example/design.md",
      ),
    ).rejects.toMatchObject({
      code: "bad_input",
      message: "DESIGN.md upload URL must come from Sokosumi blob storage",
    });
  });

  it("throws unconfigured when the Masumi API key is missing", async () => {
    getEnvSecretsMock.mockReturnValueOnce({
      BETTER_AUTH_SECRET: "test-secret",
      MASUMI_DESIGN_MD_API_URL: "https://masumi.example/api/v1",
    });

    const { designMdService } = await import("../design-md.service");

    await expect(
      designMdService.startDesignMdGeneration(
        session,
        { type: "user" },
        "https://example.com",
      ),
    ).rejects.toMatchObject({
      code: "unconfigured",
    });
  });

  it("maps external submit failures to service errors", async () => {
    submitMock.mockResolvedValue(
      err({
        message: "upstream failed",
        type: "http_error",
        status: 500,
      }),
    );

    const { designMdService } = await import("../design-md.service");

    await expect(
      designMdService.startDesignMdGeneration(
        session,
        { type: "user" },
        "https://example.com",
      ),
    ).rejects.toMatchObject({
      code: "external",
      message: "upstream failed",
    });
  });

  it("resolves organization design.md before user fallback", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      data: { role: MemberRole.MEMBER },
    });
    getOrganizationDesignMdMock.mockResolvedValue({
      data: {
        extractionId: null,
        previewUrl: null,
        url: "https://blob.example/org-design.md",
      },
    });
    getMyDesignMdMock.mockResolvedValue({
      data: {
        extractionId: null,
        previewUrl: null,
        url: "https://blob.example/user-design.md",
      },
    });

    const { designMdService } = await import("../design-md.service");
    const designMd = await designMdService.resolveEffectiveDesignMd({
      activeOrganizationId: "org-1",
      userId: "user-1",
    });

    expect(designMd).toEqual({
      label: "DESIGN.md",
      url: "https://blob.example/org-design.md",
    });
    expect(getMyDesignMdMock).not.toHaveBeenCalled();
  });

  it("prepends design.md to descriptions without duplicating existing links", async () => {
    getMyDesignMdMock.mockResolvedValue({
      data: {
        extractionId: null,
        previewUrl: null,
        url: "https://blob.example/user-design.md",
      },
    });

    const { designMdService } = await import("../design-md.service");
    const description = await designMdService.appendDesignMdToDescription(
      "Build landing page",
      "user-1",
      null,
    );
    const duplicate = await designMdService.appendDesignMdToDescription(
      description,
      "user-1",
      null,
    );

    expect(description).toBe(
      "[DESIGN.md](https://blob.example/user-design.md)\n\nBuild landing page",
    );
    expect(duplicate).toBe(description);
  });

  it("does not duplicate design.md links when the url needs markdown escaping", async () => {
    const designMdUrl = "https://blob.example/user-design).md";
    getMyDesignMdMock.mockResolvedValue({
      data: {
        extractionId: null,
        previewUrl: null,
        url: designMdUrl,
      },
    });

    const { designMdService } = await import("../design-md.service");
    const { formatTaskAttachmentMarkdown } = await import(
      "@/lib/utils/task-attachments"
    );
    const seededDescription = [
      formatTaskAttachmentMarkdown("DESIGN.md", designMdUrl).trimEnd(),
      "",
      "Build landing page",
    ].join("\n");
    const description = await designMdService.appendDesignMdToDescription(
      seededDescription,
      "user-1",
      null,
    );

    expect(description).toBe(seededDescription);
  });
});
