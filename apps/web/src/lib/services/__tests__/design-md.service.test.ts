import type { Session } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRole } from "@/lib/clients/generated/core";

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
  APP_SIGNING_SECRET: string;
  MASUMI_DESIGN_MD_API_KEY?: string;
  MASUMI_DESIGN_MD_API_URL: string;
}

const getEnvSecretsMock = vi.fn<() => EnvSecretsMock>(() => ({
  APP_SIGNING_SECRET: "test-secret",
  MASUMI_DESIGN_MD_API_KEY: "api-key",
  MASUMI_DESIGN_MD_API_URL: "https://masumi.example/api/v1",
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

const getWorkspaceDesignMdMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
const getProjectsByIdMock = vi.fn();
const setMyDesignMdMock = vi.fn();
const setOrganizationDesignMdMock = vi.fn();
const storeAdHocDesignMdMock = vi.fn();
const putProjectsByIdDesignMdMock = vi.fn();
const deleteProjectsByIdDesignMdMock = vi.fn();

const { CoreApiRequestError } = vi.hoisted(() => {
  class CoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  }

  return { CoreApiRequestError };
});

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError,
  coreClient: {
    getWorkspaceDesignMd: (...args: unknown[]) =>
      getWorkspaceDesignMdMock(...args),
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
    getProjectsById: (...args: unknown[]) => getProjectsByIdMock(...args),
    setMyDesignMd: (...args: unknown[]) => setMyDesignMdMock(...args),
    setOrganizationDesignMd: (...args: unknown[]) =>
      setOrganizationDesignMdMock(...args),
    storeAdHocDesignMd: (...args: unknown[]) => storeAdHocDesignMdMock(...args),
    putProjectsByIdDesignMd: (...args: unknown[]) =>
      putProjectsByIdDesignMdMock(...args),
    deleteProjectsByIdDesignMd: (...args: unknown[]) =>
      deleteProjectsByIdDesignMdMock(...args),
  },
}));

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
    getMyMemberInOrganizationMock.mockResolvedValue({
      data: { role: MemberRole.ADMIN },
    });
    setMyDesignMdMock.mockResolvedValue({
      data: {
        designMd: {
          url: "https://blob.example/design-md/42-hash.md",
          extractionId: "42",
        },
      },
    });
    setOrganizationDesignMdMock.mockResolvedValue({
      data: {
        designMd: {
          url: "https://blob.example/design-md/42-hash.md",
          extractionId: "42",
        },
      },
    });
    storeAdHocDesignMdMock.mockResolvedValue({
      data: {
        designMd: {
          url: "https://blob.example/design-md/adhoc/user-1/42-hash.md",
          extractionId: "42",
        },
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

    expect(setMyDesignMdMock).toHaveBeenCalledWith({
      content: "# Brand",
      extractionId: "42",
    });
    expect(persisted).toEqual({
      extractionId: "42",
      previewUrl: "https://www.masumi.example/tools/design-md?cached=42",
      url: "https://blob.example/design-md/42-hash.md",
    });
  });

  it("stores ad hoc generation on the adhoc blob path, never a profile write", async () => {
    submitMock.mockResolvedValue(
      ok({
        designMd: "# Competitor brand",
        extractionId: 99,
        status: "done",
      }),
    );

    const { designMdService } = await import("../design-md.service");
    const started = await designMdService.startDesignMdGeneration(
      session,
      { type: "adhoc" },
      "https://competitor.example",
    );

    expect(started).toEqual({
      kind: "completed",
      data: {
        extractionId: "42",
        previewUrl: "https://www.masumi.example/tools/design-md?cached=42",
        url: "https://blob.example/design-md/adhoc/user-1/42-hash.md",
      },
    });
    expect(storeAdHocDesignMdMock).toHaveBeenCalledWith({
      content: "# Competitor brand",
      extractionId: "99",
    });
    expect(setMyDesignMdMock).not.toHaveBeenCalled();
    expect(setOrganizationDesignMdMock).not.toHaveBeenCalled();
    expect(getMyMemberInOrganizationMock).not.toHaveBeenCalled();
  });

  it("finalizes queued ad hoc jobs via storeAdHocDesignMd", async () => {
    submitMock.mockResolvedValue(
      ok({
        jobId: "job_adhoc",
        status: "queued",
      }),
    );
    pollJobMock.mockResolvedValue(
      ok({
        designMd: "# Ad hoc brand",
        extractionId: 7,
        status: "done",
      }),
    );

    const { designMdService } = await import("../design-md.service");
    const started = await designMdService.startDesignMdGeneration(
      session,
      { type: "adhoc" },
      "https://competitor.example",
    );

    if (started.kind !== "queued") {
      throw new Error("Expected queued job");
    }

    const persisted = await designMdService.finalizeAndPersistDesignMd(
      session,
      { type: "adhoc" },
      started.jobId,
      started.jobToken,
    );

    expect(storeAdHocDesignMdMock).toHaveBeenCalledWith({
      content: "# Ad hoc brand",
      extractionId: "7",
    });
    expect(setMyDesignMdMock).not.toHaveBeenCalled();
    expect(setOrganizationDesignMdMock).not.toHaveBeenCalled();
    expect(persisted.url).toBe(
      "https://blob.example/design-md/adhoc/user-1/42-hash.md",
    );
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

  it("sends uploaded markdown content to core and returns the stored URL", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      data: { role: MemberRole.ADMIN },
    });
    const uploadedUrl =
      "https://store.public.blob.vercel-storage.com/design-md/manual-design.md";
    setOrganizationDesignMdMock.mockResolvedValue({
      data: { designMd: { url: uploadedUrl, extractionId: null } },
    });

    const { designMdService } = await import("../design-md.service");
    const persisted = await designMdService.persistUploadedDesignMd(
      { type: "organization", organizationId: "org-1" },
      "# Uploaded brand",
    );

    expect(setOrganizationDesignMdMock).toHaveBeenCalledWith("org-1", {
      content: "# Uploaded brand",
      extractionId: null,
    });
    expect(persisted.url).toBe(uploadedUrl);
    expect(persisted.extractionId).toBeNull();
  });

  it("persists and removes project DESIGN.md via Core", async () => {
    getProjectsByIdMock.mockResolvedValue({
      data: { id: "project-1" },
    });
    putProjectsByIdDesignMdMock.mockResolvedValue({
      data: {
        designMd: {
          url: "https://blob.example/design-md/projects/project-1/DESIGN.md",
          extractionId: "9",
        },
      },
    });

    const { designMdService } = await import("../design-md.service");
    const persisted = await designMdService.persistUploadedDesignMd(
      { type: "project", projectId: "project-1" },
      "# Project brand",
    );

    expect(putProjectsByIdDesignMdMock).toHaveBeenCalledWith("project-1", {
      content: "# Project brand",
      extractionId: null,
    });
    expect(persisted.url).toBe(
      "https://blob.example/design-md/projects/project-1/DESIGN.md",
    );

    await designMdService.removeDesignMd({
      type: "project",
      projectId: "project-1",
    });
    expect(deleteProjectsByIdDesignMdMock).toHaveBeenCalledWith("project-1");
  });

  it("maps project 403/404 to unauthorized and other Core failures to external", async () => {
    const { designMdService } = await import("../design-md.service");

    getProjectsByIdMock.mockRejectedValueOnce(
      new CoreApiRequestError("missing", { status: 404 }),
    );
    await expect(
      designMdService.persistUploadedDesignMd(
        { type: "project", projectId: "project-1" },
        "# Brand",
      ),
    ).rejects.toMatchObject({ code: "unauthorized" });

    getProjectsByIdMock.mockRejectedValueOnce(
      new CoreApiRequestError("upstream", { status: 500 }),
    );
    await expect(
      designMdService.persistUploadedDesignMd(
        { type: "project", projectId: "project-1" },
        "# Brand",
      ),
    ).rejects.toMatchObject({ code: "external" });
  });

  it("throws unconfigured when the Masumi API key is missing", async () => {
    getEnvSecretsMock.mockReturnValueOnce({
      APP_SIGNING_SECRET: "test-secret",
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

  it("delegates effective design.md resolution to core", async () => {
    getWorkspaceDesignMdMock.mockResolvedValue({
      data: {
        designMd: {
          label: "DESIGN.md",
          url: "https://blob.example/org-design.md",
          owner: { type: "organization", name: "Acme Inc", logo: null },
        },
      },
    });

    const { designMdService } = await import("../design-md.service");
    const designMd = await designMdService.resolveEffectiveDesignMd();

    expect(getWorkspaceDesignMdMock).toHaveBeenCalledWith();
    expect(designMd).toEqual({
      label: "DESIGN.md",
      url: "https://blob.example/org-design.md",
      owner: { type: "organization", name: "Acme Inc", logo: null },
    });
  });

  it("returns null when core reports no effective design.md", async () => {
    getWorkspaceDesignMdMock.mockResolvedValue({
      data: { designMd: null },
    });

    const { designMdService } = await import("../design-md.service");
    const designMd = await designMdService.resolveEffectiveDesignMd();

    expect(designMd).toBeNull();
  });
});
