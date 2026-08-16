import type { Project as DatabaseProject } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  createProjectRequestSchema,
  mapProjectForApi,
  patchProjectRequestSchema,
} from "./project.schema";

function createDatabaseProject(
  overrides: Partial<DatabaseProject> = {},
): DatabaseProject {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    name: "Launch",
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
    createdAt: new Date("2026-08-16T10:00:00.000Z"),
    updatedAt: new Date("2026-08-16T10:00:00.000Z"),
    ...overrides,
  };
}

describe("project schemas", () => {
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

  it("validates project website, logo, and DESIGN.md inputs", () => {
    const logo =
      "https://abc.public.blob.vercel-storage.com/projects/project_123/logos/hash.png";
    const designMdUrl =
      "https://abc.public.blob.vercel-storage.com/design-md/projects/project_123/hash.md";

    expect(
      createProjectRequestSchema.parse({
        name: "Launch",
        websiteUrl: "https://example.com",
        logo,
        designMd: { url: designMdUrl, extractionId: "extract_123" },
      }),
    ).toMatchObject({
      websiteUrl: "https://example.com",
      logo,
      designMd: { url: designMdUrl, extractionId: "extract_123" },
    });
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
      contextMd: {
        version: 3,
        lineCount: 2,
        model: { label: "Mistral Medium", region: "eu" },
      },
      contextMdUpdating: true,
    });
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
