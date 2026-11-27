import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostProjectDesignMdFromOrganization from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  organizationFindUniqueMock,
  projectFindFirstMock,
  projectUpdateMock,
  readDesignMdContentMock,
  uploadDesignMdContentMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  projectUpdateMock: vi.fn(),
  readDesignMdContentMock: vi.fn(),
  uploadDesignMdContentMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: { findUnique: organizationFindUniqueMock },
    project: { findFirst: projectFindFirstMock, update: projectUpdateMock },
  },
}));

vi.mock("@/lib/design-md-blob", () => ({
  readDesignMdContent: readDesignMdContentMock,
  uploadDesignMdContent: uploadDesignMdContentMock,
}));

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORGANIZATION_URL =
  "https://store.public.blob.vercel-storage.com/design-md/organizations/org.md";
const PROJECT_URL =
  "https://store.public.blob.vercel-storage.com/design-md/projects/copy.md";

const ORGANIZATION_WORKSPACE = {
  workspaceId: WORKSPACE_ID,
  userId: "user_123",
  organizationId: ORGANIZATION_ID,
} satisfies WorkspaceVariables["workspaceContext"];

const USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: ORGANIZATION_ID,
  role: "user",
};

function buildProject(designMdUrl: string | null) {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    name: "Project",
    websiteUrl: null,
    identifier: null,
    logo: null,
    designMdUrl,
    designMdExtractionId: null,
    briefing: null,
    briefingUrl: null,
    contextMd: null,
    contextMdUrl: null,
    contextMdUpdatedAt: null,
    contextMdModel: null,
    contextMdUpdatingSince: null,
    contextMdVersion: 0,
    latestUpdateMd: null,
    latestUpdateMdUpdatedAt: null,
    createdAt: new Date("2026-11-27T12:00:00.000Z"),
    updatedAt: new Date("2026-11-27T12:00:00.000Z"),
  };
}

function copy(
  workspaceContext: WorkspaceVariables["workspaceContext"] = ORGANIZATION_WORKSPACE,
  authContext: AuthenticationContext = USER,
) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    return await next();
  });
  mountPostProjectDesignMdFromOrganization(app);
  return app.request(
    `http://localhost/${PROJECT_ID}/design-md/from-organization`,
    { method: "POST" },
  );
}

describe("POST /projects/{id}/design-md/from-organization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      designMdUrl: null,
    });
    organizationFindUniqueMock.mockResolvedValue({
      metadata: { designMdUrl: ORGANIZATION_URL },
    });
    readDesignMdContentMock.mockResolvedValue("# Org brand");
    uploadDesignMdContentMock.mockResolvedValue(PROJECT_URL);
    projectUpdateMock.mockResolvedValue(buildProject(PROJECT_URL));
  });

  it("copies the organization's DESIGN.md into an empty Project brand", async () => {
    const response = await copy();

    expect(response.status).toBe(200);
    expect(organizationFindUniqueMock).toHaveBeenCalledWith({
      where: { id: ORGANIZATION_ID },
      select: { metadata: true },
    });
    expect(readDesignMdContentMock).toHaveBeenCalledWith(ORGANIZATION_URL);
    expect(uploadDesignMdContentMock).toHaveBeenCalledWith({
      content: "# Org brand",
      owner: { kind: "project", id: PROJECT_ID },
    });
    // The empty check is part of the write: a brand saved since wins.
    expect(projectUpdateMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, designMdUrl: null },
      data: { designMdUrl: PROJECT_URL, designMdExtractionId: null },
    });
    expect((await response.json()).data.designMd.url).toBe(PROJECT_URL);
  });

  it("refuses a Project that already has a brand, before copying", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      designMdUrl: "https://store.public.blob.vercel-storage.com/x.md",
    });

    const response = await copy();

    expect(response.status).toBe(409);
    expect((await response.json()).kind).toBe(
      CORE_API_ERROR_KINDS.PROJECT_DESIGN_MD_EXISTS,
    );
    expect(uploadDesignMdContentMock).not.toHaveBeenCalled();
  });

  it("refuses when another save fills the brand during the copy", async () => {
    projectUpdateMock.mockRejectedValue(
      Object.assign(new Error("Record to update not found."), {
        code: "P2025",
      }),
    );

    const response = await copy();

    expect(response.status).toBe(409);
    expect((await response.json()).kind).toBe(
      CORE_API_ERROR_KINDS.PROJECT_DESIGN_MD_EXISTS,
    );
  });

  it("answers 404 when the workspace's organization has no DESIGN.md", async () => {
    organizationFindUniqueMock.mockResolvedValue({ metadata: {} });

    const response = await copy();

    expect(response.status).toBe(404);
    expect((await response.json()).kind).toBe(
      CORE_API_ERROR_KINDS.ORGANIZATION_DESIGN_MD_MISSING,
    );
    expect(projectUpdateMock).not.toHaveBeenCalled();
  });

  it("answers 404 in a personal workspace", async () => {
    const response = await copy({
      ...ORGANIZATION_WORKSPACE,
      organizationId: null,
    });

    expect(response.status).toBe(404);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
  });

  it("answers 503 when the organization file does not load", async () => {
    readDesignMdContentMock.mockResolvedValue(null);

    const response = await copy();

    expect(response.status).toBe(503);
    expect(projectUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects coworkers", async () => {
    const response = await copy(ORGANIZATION_WORKSPACE, {
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_123", organizationId: ORGANIZATION_ID },
    });

    expect(response.status).toBe(403);
    expect(projectUpdateMock).not.toHaveBeenCalled();
  });
});
