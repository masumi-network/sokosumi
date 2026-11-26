import { beforeEach, describe, expect, it, vi } from "vitest";

import { readSeoTaskActionImpact } from "./seo-task-action-impact";

const boundary = vi.hoisted(() => ({
  taskContext: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (tx: unknown) => unknown) => run({}),
}));
vi.mock("./seo-task-search-console-context", async (original) => ({
  ...(await original<typeof import("./seo-task-search-console-context")>()),
  requireSeoTaskSearchConsoleContext: boundary.taskContext,
}));
vi.mock("./project-seo.service", () => ({
  getProjectSeoWorkspace: boundary.workspace,
}));

const actor = {
  userId: "owner",
  workspaceId: "workspace",
  organizationId: null,
  owner: { kind: "audit" as const, id: "audit" },
};
const pageA = "https://example.test/a";
const pageB = "https://example.test/b";

beforeEach(() => vi.resetAllMocks());

describe("readSeoTaskActionImpact", () => {
  const auth = {} as Parameters<typeof readSeoTaskActionImpact>[0];
  const impact = { state: "measured" };

  it("gives the worker only measured actions on the audit's own pages, for its window", async () => {
    boundary.taskContext.mockResolvedValue({
      actor,
      pageUrls: [pageA],
      status: "CONNECTED",
      integration: { composioAccountId: "account" },
      access: { propertyId: "sc-domain:example.test" },
    });
    boundary.workspace.mockResolvedValue({
      actions: [
        { id: "a", pageUrl: pageA, title: "Fix the title", why: "x", impact },
        { id: "b", pageUrl: pageB, title: "Other page", impact },
        { id: "c", pageUrl: pageA, title: "Still open" },
      ],
    });
    expect(await readSeoTaskActionImpact(auth, "task", 14)).toEqual({
      actions: [{ id: "a", pageUrl: pageA, title: "Fix the title", impact }],
    });
    expect(boundary.workspace).toHaveBeenCalledWith(
      actor,
      {},
      { actionImpact: { days: 14 } },
    );
  });

  it("reads nothing for an audit the owner approved without Search Console", async () => {
    boundary.taskContext.mockResolvedValue({
      actor,
      pageUrls: [pageA],
      status: "NOT_CONNECTED",
      reason: "limited_audit",
      integration: null,
      access: null,
    });
    await expect(readSeoTaskActionImpact(auth, "task")).rejects.toThrow(
      "This audit was not approved with Search Console.",
    );
    expect(boundary.workspace).not.toHaveBeenCalled();
  });
});
