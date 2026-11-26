import { HTTPException } from "hono/http-exception";
import { beforeEach, expect, it, vi } from "vitest";

import { listAdminSeoActionImpact } from "./admin-seo-action-impact";

const boundary = vi.hoisted(() => ({
  groupBy: vi.fn(),
  audit: vi.fn(),
  project: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSeoObservation: { groupBy: boundary.groupBy },
    seoAudit: { findUnique: boundary.audit },
    project: { findUnique: boundary.project },
  },
}));
vi.mock("./project-seo.service", () => ({
  getProjectSeoWorkspace: boundary.workspace,
}));

const AUDIT = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const WORKSPACE = "33333333-3333-4333-8333-333333333333";
const home = {
  workspace: {
    id: WORKSPACE,
    organizationId: "org",
    userId: null,
    organization: { slug: "acme" },
  },
};
const impact = { state: "measured" };

beforeEach(() => {
  vi.resetAllMocks();
  boundary.audit.mockResolvedValue(home);
  boundary.project.mockResolvedValue(home);
});

it("reads each audit as the person whose rows it holds and lists only measured actions", async () => {
  boundary.groupBy.mockResolvedValue([
    { auditId: AUDIT, projectId: null, ownerId: "ada" },
    { auditId: null, projectId: PROJECT, ownerId: "bob" },
  ]);
  boundary.workspace
    .mockResolvedValueOnce({
      actions: [
        { id: "a", pageUrl: "https://example.test/a", title: "Fix", impact },
        { id: "b", pageUrl: "https://example.test/b", title: "Open" },
      ],
    })
    // Bob left the workspace: he sees nothing, so staff see nothing of his.
    .mockRejectedValueOnce(new HTTPException(404));

  const result = await listAdminSeoActionImpact({ days: 14, page: 1 });

  expect(boundary.workspace).toHaveBeenNthCalledWith(
    1,
    {
      owner: { kind: "audit", id: AUDIT },
      workspaceId: WORKSPACE,
      organizationId: "org",
      userId: "ada",
    },
    {},
    { actionImpact: { days: 14 } },
  );
  expect(boundary.workspace.mock.calls[1][0]).toMatchObject({
    owner: { kind: "project", id: PROJECT },
    userId: "bob",
  });
  expect(result).toEqual({
    total: 2,
    pageSize: 10,
    items: [
      {
        auditId: AUDIT,
        projectId: null,
        workspaceId: WORKSPACE,
        workspaceOrganizationSlug: "acme",
        workspaceUserId: null,
        userId: "ada",
        actions: [
          { id: "a", pageUrl: "https://example.test/a", title: "Fix", impact },
        ],
      },
      expect.objectContaining({
        projectId: PROJECT,
        userId: "bob",
        actions: [],
      }),
    ],
  });
});

it("reads only the asked page and does not hide a failure that is not an access refusal", async () => {
  boundary.groupBy.mockResolvedValue(
    Array.from({ length: 12 }, (_, index) => ({
      auditId: AUDIT,
      projectId: null,
      ownerId: `user-${index}`,
    })),
  );
  boundary.workspace.mockResolvedValue({ actions: [] });
  const second = await listAdminSeoActionImpact({ page: 2 });
  expect(second.total).toBe(12);
  expect(second.items.map((item) => item.userId)).toEqual([
    "user-10",
    "user-11",
  ]);

  boundary.workspace.mockRejectedValue(new Error("database is down"));
  await expect(listAdminSeoActionImpact({ page: 1 })).rejects.toThrow(
    "database is down",
  );
});

it("builds at most 5 workspaces at the same time and keeps the newest-first order", async () => {
  boundary.groupBy.mockResolvedValue(
    Array.from({ length: 7 }, (_, index) => ({
      auditId: AUDIT,
      projectId: null,
      ownerId: `user-${index}`,
    })),
  );
  let running = 0;
  let most = 0;
  boundary.workspace.mockImplementation(async ({ userId }) => {
    most = Math.max(most, ++running);
    // The first read of a group ends last, so a result placed by finish time would be out of order.
    await new Promise((done) => setTimeout(done, userId === "user-0" ? 20 : 1));
    running--;
    return { actions: [] };
  });
  const { items } = await listAdminSeoActionImpact({ page: 1 });
  expect(most).toBe(5);
  expect(items.map((item) => item.userId)).toEqual(
    Array.from({ length: 7 }, (_, index) => `user-${index}`),
  );
});
