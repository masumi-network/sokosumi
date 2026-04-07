import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getJobByIdMock = vi.fn();
const { resolveWorkspaceForContextMock } = vi.hoisted(() => ({
  resolveWorkspaceForContextMock: vi.fn(),
}));

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  jobRepository: {
    getJobById: (...args: unknown[]) => getJobByIdMock(...args),
  },
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    resolveWorkspaceForContext: resolveWorkspaceForContextMock,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

function createRequest(jobId: string) {
  return {
    nextUrl: new URL(`http://localhost/api/internal/jobs/${jobId}`),
  } as never;
}

describe("GET /api/internal/jobs/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: "workspace-1",
    });
  });

  it("returns the job when it is inside the active workspace scope", async () => {
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      workspaceId: "workspace-1",
    });

    const { GET } = await import("./route");
    const response = await GET(createRequest("job-1"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: expect.any(String),
    });
  });

  it("returns 404 when the owned job is outside the active workspace", async () => {
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      workspaceId: "workspace-2",
    });

    const { GET } = await import("./route");
    const response = await GET(createRequest("job-1"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(404);
  });
});
