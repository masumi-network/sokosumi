import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvVariables } from "@/lib/hono";

const m = vi.hoisted(() => ({ resolveTableActor: vi.fn() }));
vi.mock("@/helpers/data-table", () => ({
  resolveTableActor: m.resolveTableActor,
}));

import { tableActor } from "./context";

function context(
  workspace: { organizationId: string | null },
  headers: Record<string, string> = {},
) {
  return {
    var: {
      authContext: {},
      workspaceContext: {
        workspaceId: "ws-1",
        userId: "user-1",
        ...workspace,
      },
    },
    req: { header: (name: string) => headers[name] },
  } as unknown as Context<EnvVariables>;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.resolveTableActor.mockResolvedValue({ workspaceId: "ws-1" });
});

describe("tableActor", () => {
  it("refuses a request bound to another workspace before it resolves the actor", async () => {
    // The page confirmed the copy in organization A; the session has since switched to B.
    await expect(
      tableActor(
        context({ organizationId: "org-b" }, { "X-Table-Workspace": "org-a" }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      tableActor(
        context({ organizationId: null }, { "X-Table-Workspace": "org-a" }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      tableActor(
        context(
          { organizationId: "org-b" },
          { "X-Table-Workspace": "personal" },
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.resolveTableActor).not.toHaveBeenCalled();
  });

  it("accepts a request bound to the active workspace, or not bound at all", async () => {
    await expect(
      tableActor(
        context({ organizationId: "org-a" }, { "X-Table-Workspace": "org-a" }),
      ),
    ).resolves.toMatchObject({ workspaceId: "ws-1" });
    await expect(
      tableActor(
        context({ organizationId: null }, { "X-Table-Workspace": "personal" }),
      ),
    ).resolves.toMatchObject({ workspaceId: "ws-1" });
    await expect(
      tableActor(context({ organizationId: "org-a" })),
    ).resolves.toMatchObject({ workspaceId: "ws-1" });
  });
});
