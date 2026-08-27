import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountDeleteProjectDesignMd from "./delete";
import mountPutProjectDesignMd from "./put";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  projectFindFirstMock,
  projectUpdateManyMock,
  projectUpdateMock,
  uploadDesignMdContentMock,
} = vi.hoisted(() => ({
  projectFindFirstMock: vi.fn(),
  projectUpdateManyMock: vi.fn(),
  projectUpdateMock: vi.fn(),
  uploadDesignMdContentMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      findFirst: projectFindFirstMock,
      update: projectUpdateMock,
      updateMany: projectUpdateManyMock,
    },
  },
}));

vi.mock("@/lib/design-md-blob", () => ({
  uploadDesignMdContent: uploadDesignMdContentMock,
}));

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const DESIGN_MD_URL =
  "https://store.public.blob.vercel-storage.com/design-md/projects/brand.md";

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: null },
};

const WORKSPACE_CONTEXT = {
  workspaceId: WORKSPACE_ID,
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

function buildProject(
  designMdUrl: string | null = null,
  designMdExtractionId: string | null = null,
) {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    name: "Project",
    websiteUrl: "https://example.com",
    logo: null,
    designMdUrl,
    designMdExtractionId,
    briefing: null,
    briefingUrl: null,
    contextMd: null,
    contextMdUrl: null,
    contextMdUpdatedAt: null,
    contextMdModel: null,
    contextMdUpdatingSince: null,
    contextMdVersion: 0,
    createdAt: new Date("2026-08-16T12:00:00.000Z"),
    updatedAt: new Date("2026-08-16T12:00:00.000Z"),
  };
}

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);
    return await next();
  });

  mountPutProjectDesignMd(app);
  mountDeleteProjectDesignMd(app);
  return app;
}

describe("project DESIGN.md routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    uploadDesignMdContentMock.mockResolvedValue(DESIGN_MD_URL);
    projectUpdateMock.mockResolvedValue(
      buildProject(DESIGN_MD_URL, "extract_123"),
    );
    projectUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("uploads and assigns a project-owned DESIGN.md", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/design-md`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "# Brand",
          extractionId: "extract_123",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      select: { id: true },
    });
    expect(uploadDesignMdContentMock).toHaveBeenCalledWith({
      content: "# Brand",
      owner: { kind: "project", id: PROJECT_ID },
      extractionId: "extract_123",
    });
    expect(projectUpdateMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: {
        designMdUrl: DESIGN_MD_URL,
        designMdExtractionId: "extract_123",
      },
    });
  });

  it("does not upload when project is outside active workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/design-md`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# Brand" }),
      },
    );

    expect(response.status).toBe(404);
    expect(uploadDesignMdContentMock).not.toHaveBeenCalled();
  });

  it("returns 503 when blob upload fails", async () => {
    uploadDesignMdContentMock.mockResolvedValue(null);

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/design-md`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# Brand" }),
      },
    );

    expect(response.status).toBe(503);
    expect(projectUpdateMock).not.toHaveBeenCalled();
  });

  it("clears both project DESIGN.md fields", async () => {
    projectFindFirstMock.mockResolvedValue(buildProject());

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/design-md`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(projectUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      data: { designMdUrl: null, designMdExtractionId: null },
    });
    expect((await response.json()).data.designMd).toBeNull();
  });

  it("rejects coworker owner mutations", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      `http://localhost/${PROJECT_ID}/design-md`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(403);
    expect(projectUpdateManyMock).not.toHaveBeenCalled();
  });
});
