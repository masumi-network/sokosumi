import type { Project as DatabaseProject } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProjectRequestSchema,
  mapProjectForApi,
  patchProjectRequestSchema,
} from "./project.schema";

const { getEnvMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

function createDatabaseProject(
  overrides: Partial<DatabaseProject> = {},
): DatabaseProject {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    name: "Launch",
    filesToken: null,
    briefing: "# Briefing",
    briefingUrl: "https://blob.example/projects/project_1/BRIEFING.md",
    contextMd: null,
    contextMdUrl: null,
    contextMdUpdatedAt: null,
    contextMdModel: null,
    contextMdUpdatingSince: null,
    contextMdVersion: 0,
    websiteUrl: null,
    logo: null,
    designMdUrl: null,
    designMdExtractionId: null,
    projectRevision: 0,
    calendarRevision: 0,
    closingAt: null,
    closedAt: null,
    createdAt: new Date("2026-08-16T10:00:00.000Z"),
    updatedAt: new Date("2026-08-16T10:00:00.000Z"),
    ...overrides,
  };
}

describe("project schemas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      AI_GATEWAY_API_KEY: undefined,
      BLOB_READ_WRITE_TOKEN: undefined,
      PROJECT_MEMORY_MODEL: "mistral/mistral-medium-3.5",
    });
  });

  it("accepts briefings up to 20,000 characters", () => {
    expect(
      createProjectRequestSchema.parse({
        name: "Launch",
        briefing: "x".repeat(20_000),
      }),
    ).toBeDefined();
    expect(() =>
      createProjectRequestSchema.parse({
        name: "Launch",
        briefing: "x".repeat(20_001),
      }),
    ).toThrow();
  });

  it("validates website and PATCH logo while stripping create-only legacy brand fields", () => {
    const logo =
      "https://abc.public.blob.vercel-storage.com/projects/project_123/logos/hash.png";
    const designMdUrl =
      "https://abc.public.blob.vercel-storage.com/design-md/projects/project_123/hash.md";

    const created = createProjectRequestSchema.parse({
      name: "Launch",
      websiteUrl: "https://example.com",
      logo,
      designMd: { url: designMdUrl, extractionId: "extract_123" },
    });
    expect(created).toMatchObject({
      websiteUrl: "https://example.com",
    });
    expect(created).not.toHaveProperty("logo");
    expect(created).not.toHaveProperty("designMd");
    expect(
      createProjectRequestSchema.safeParse({
        name: "Launch",
        websiteUrl: "ftp://example.com",
      }).success,
    ).toBe(false);
    expect(
      patchProjectRequestSchema.safeParse({
        logo: "https://example.com/logo.png",
      }).success,
    ).toBe(false);
    expect(
      patchProjectRequestSchema.safeParse({ designMd: null }).success,
    ).toBe(false);
  });

  it("accepts deprecated description as a briefing alias", () => {
    expect(
      createProjectRequestSchema.parse({
        name: "Legacy client",
        description: "Legacy briefing",
      }).briefing,
    ).toBe("Legacy briefing");
    expect(
      patchProjectRequestSchema.parse({ description: "Legacy update" })
        .briefing,
    ).toBe("Legacy update");
    expect(
      patchProjectRequestSchema.parse({
        briefing: "Canonical briefing",
        description: "Legacy update",
      }).briefing,
    ).toBe("Canonical briefing");
    expect(patchProjectRequestSchema.parse({ briefing: null }).briefing).toBe(
      null,
    );
  });

  it("maps nullable project brand metadata", () => {
    const designMdUrl =
      "https://abc.public.blob.vercel-storage.com/design-md/projects/project_123/hash.md";
    const project = createDatabaseProject({
      websiteUrl: "https://example.com",
      logo: "https://abc.public.blob.vercel-storage.com/projects/project_123/logos/hash.png",
      designMdUrl,
      designMdExtractionId: "extract_123",
    });

    expect(mapProjectForApi(project)).toMatchObject({
      websiteUrl: "https://example.com",
      logo: project.logo,
      designMd: { url: designMdUrl, extractionId: "extract_123" },
    });
    expect(mapProjectForApi(createDatabaseProject()).designMd).toBeNull();
  });

  it("maps the Project lifecycle revision and terminal timestamps", () => {
    expect(
      mapProjectForApi(
        createDatabaseProject({
          projectRevision: 4,
          closingAt: new Date("2026-08-26T12:00:00.000Z"),
          closedAt: new Date("2026-08-26T12:05:00.000Z"),
        }),
      ),
    ).toMatchObject({
      projectRevision: 4,
      closingAt: "2026-08-26T12:00:00.000Z",
      closedAt: "2026-08-26T12:05:00.000Z",
    });
  });

  it("maps memory metadata and active update state", () => {
    const project = createDatabaseProject({
      contextMd: "# Context\nDecision",
      contextMdUrl: "https://blob.example/projects/project_1/CONTEXT.md",
      contextMdUpdatedAt: new Date("2026-08-16T10:01:00.000Z"),
      contextMdModel: "mistral/mistral-medium-latest",
      contextMdUpdatingSince: new Date("2026-08-16T10:04:00.000Z"),
      contextMdVersion: 3,
    });

    expect(
      mapProjectForApi(project, new Date("2026-08-16T10:05:00.000Z")),
    ).toMatchObject({
      briefing: "# Briefing",
      memoryEnabled: false,
      memoryModel: {
        id: "mistral/mistral-medium-3.5",
        label: "Mistral Medium",
        region: "eu",
      },
      contextMd: {
        version: 3,
        lineCount: 2,
        model: { label: "Mistral Medium", region: "eu" },
      },
      contextMdUpdating: true,
    });
  });

  it("reports configured memory capability before the first update", () => {
    getEnvMock.mockReturnValue({
      AI_GATEWAY_API_KEY: "gateway_key",
      BLOB_READ_WRITE_TOKEN: "blob_key",
      PROJECT_MEMORY_MODEL: "mistral/custom-eu-model",
    });

    expect(mapProjectForApi(createDatabaseProject())).toMatchObject({
      memoryEnabled: true,
      memoryModel: {
        id: "mistral/custom-eu-model",
        label: "mistral/custom-eu-model",
        region: "eu",
      },
      contextMd: null,
    });
  });

  it("disables memory when Blob storage is missing", () => {
    getEnvMock.mockReturnValue({
      AI_GATEWAY_API_KEY: "gateway_key",
      BLOB_READ_WRITE_TOKEN: undefined,
      PROJECT_MEMORY_MODEL: "mistral/mistral-medium-3.5",
    });

    expect(mapProjectForApi(createDatabaseProject()).memoryEnabled).toBe(false);
  });

  it("treats update markers older than five minutes as stale", () => {
    const project = createDatabaseProject({
      contextMdUpdatingSince: new Date("2026-08-16T09:59:59.000Z"),
    });

    expect(
      mapProjectForApi(project, new Date("2026-08-16T10:05:00.000Z"))
        .contextMdUpdating,
    ).toBe(false);
  });
});
