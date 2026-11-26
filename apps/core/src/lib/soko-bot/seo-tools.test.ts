import { beforeEach, describe, expect, it, vi } from "vitest";

import { runSeoTool } from "./seo-tools";

const workspace = vi.hoisted(() => vi.fn());

vi.mock("@/services/project-seo.service", () => ({
  getProjectSeoWorkspace: workspace,
}));
vi.mock("@/services/project-seo-import.service", () => ({}));
vi.mock("@/services/project-seo-operations.service", () => ({}));
vi.mock("@/services/project-seo-page-changes.service", () => ({}));
vi.mock("@/services/project-seo-statistics.service", () => ({}));
vi.mock("@/lib/evals/eval-guard", () => ({}));

const projectId = "11111111-1111-4111-8111-111111111111";
const actor = {
  userId: "owner",
  workspaceId: "workspace",
  organizationId: null,
  owner: { kind: "project" as const, id: projectId },
};

beforeEach(() => workspace.mockReset().mockResolvedValue({ actions: [] }));

describe("runSeoTool get_seo_workspace", () => {
  it("passes the bot's window length to the impact and keeps it out of the page query", async () => {
    await runSeoTool(
      "get_seo_workspace",
      { projectId, channel: "organic", impactDays: 7 },
      actor,
      {},
    );
    expect(workspace).toHaveBeenCalledWith(
      actor,
      { channel: "organic" },
      { actionImpact: { days: 7 } },
    );
  });

  it("refuses a window shorter than a week or longer than a quarter", async () => {
    for (const impactDays of [6, 92, 7.5])
      await expect(
        runSeoTool("get_seo_workspace", { projectId, impactDays }, actor, {}),
      ).rejects.toThrow();
    expect(workspace).not.toHaveBeenCalled();
  });
});
