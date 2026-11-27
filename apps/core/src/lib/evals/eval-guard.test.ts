import { describe, expect, it, vi } from "vitest";

const { coworkerCount, laneFindMany, laneFindUnique, laneFindFirst } =
  vi.hoisted(() => ({
    coworkerCount: vi.fn(),
    laneFindMany: vi.fn(),
    laneFindUnique: vi.fn(),
    laneFindFirst: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: { count: coworkerCount },
    evalLane: {
      findMany: laneFindMany,
      findUnique: laneFindUnique,
      findFirst: laneFindFirst,
    },
  },
}));

import {
  evalCoworkerRefusal,
  forgetEvalWorkspaces,
  isEvalOrganizationNow,
  isEvalWorkspace,
  isEvalWorkspaceNow,
  simulatedEvalTool,
} from "./eval-guard";

describe("isEvalWorkspaceNow", () => {
  it("fails closed: a lane another worker registered after this cache filled still counts", async () => {
    forgetEvalWorkspaces();
    // This process cached the lanes before lane 2 existed.
    laneFindMany.mockResolvedValue([
      {
        workspaceId: "ws-lane-1",
        organizationId: "org-lane-1",
        cusoProjectId: null,
      },
    ]);
    await expect(isEvalWorkspace("ws-lane-2")).resolves.toBe(false);
    laneFindUnique.mockResolvedValueOnce({ lane: 2 });
    await expect(isEvalWorkspaceNow("ws-lane-2")).resolves.toBe(true);
    expect(laneFindUnique).toHaveBeenCalledWith({
      where: { workspaceId: "ws-lane-2" },
      select: { lane: true },
    });
    laneFindFirst.mockResolvedValueOnce({ lane: 2 });
    await expect(isEvalOrganizationNow("org-lane-2")).resolves.toBe(true);
  });

  it("answers a cached lane without a lookup, and a real workspace with one", async () => {
    forgetEvalWorkspaces();
    laneFindMany.mockResolvedValue([
      {
        workspaceId: "ws-lane-1",
        organizationId: "org-lane-1",
        cusoProjectId: null,
      },
    ]);
    laneFindUnique.mockClear();
    await expect(isEvalWorkspaceNow("ws-lane-1")).resolves.toBe(true);
    expect(laneFindUnique).not.toHaveBeenCalled();
    laneFindUnique.mockResolvedValueOnce(null);
    await expect(isEvalWorkspaceNow("ws-customer")).resolves.toBe(false);
  });
});

describe("evalCoworkerRefusal", () => {
  it("refuses a Task Schedule for a Coworker the lane was never granted", async () => {
    coworkerCount.mockResolvedValue(0);
    await expect(
      evalCoworkerRefusal("eval-ws-1", {
        name: "Daily research",
        assigneeCoworkerId: "global-paid-coworker",
        cron: "0 9 * * 1-5",
      }),
    ).resolves.toMatch(/not available in this workspace/);
    expect(coworkerCount).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { in: ["global-paid-coworker"] } }),
    });
  });
});

describe("simulatedEvalTool", () => {
  it("answers tools that reach money or people outside Sokosumi without running them", () => {
    for (const tool of [
      "hire_agent",
      "provide_job_input",
      "add_newsletter_subscriber",
      "import_newsletter_subscribers",
      "add_newsletter_subscribers_from_contacts",
      "publish_social_post",
      "create_ad_campaign",
      "update_ad_campaign",
      "edit_ad_campaign",
      "delete_ad_campaign",
      "handle_social_comment",
    ])
      expect(simulatedEvalTool(tool, {}), tool).not.toBeNull();
  });

  it("runs everything that stays inside the eval organization", () => {
    for (const tool of [
      "create_task",
      "assign_task",
      "post_chat",
      "create_social_post",
      "schedule_social_post",
      "update_memory",
      "submit_newsletter_issue",
      "upsert_contact",
    ])
      expect(simulatedEvalTool(tool, {}), tool).toBeNull();
  });

  it("says a hire was accepted, as the real one does", () => {
    expect(simulatedEvalTool("hire_agent", {})).toMatchObject({
      executed: true,
      status: "ACCEPTED",
    });
  });
});
