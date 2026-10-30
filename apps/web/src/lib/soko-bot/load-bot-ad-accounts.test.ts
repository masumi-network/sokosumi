import { ProjectAdProvider } from "@sokosumi/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hasBetaMock = vi.fn();
const listProjectsMock = vi.fn();
const getProjectByIdMock = vi.fn();
const listAccountsMock = vi.fn();

vi.mock("@/lib/social-beta-access.server", () => ({
  hasCurrentUserSocialBetaAccess: () => hasBetaMock(),
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    listProjects: (...a: unknown[]) => listProjectsMock(...a),
    getProjectById: (...a: unknown[]) => getProjectByIdMock(...a),
  },
}));
vi.mock("@/lib/services/ads.service", () => ({
  adsService: { listAccounts: (...a: unknown[]) => listAccountsMock(...a) },
}));

import { loadBotAdAccounts } from "./load-bot-ad-accounts";

function account(id: string, name: string) {
  return { id, name, provider: ProjectAdProvider.GOOGLE_ADS };
}

describe("loadBotAdAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasBetaMock.mockResolvedValue(true);
    listProjectsMock.mockResolvedValue({
      projects: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
        { id: "p3", name: "Gamma" },
      ],
      pagination: null,
    });
    listAccountsMock.mockImplementation(async (projectId: string) => {
      if (projectId === "p3") throw new Error("boom");
      return [account(`a-${projectId}`, `Account ${projectId}`)];
    });
  });

  it("returns null without the Social beta and loads nothing", async () => {
    hasBetaMock.mockResolvedValue(false);
    await expect(loadBotAdAccounts({ projectId: null })).resolves.toBeNull();
    expect(listProjectsMock).not.toHaveBeenCalled();
    expect(listAccountsMock).not.toHaveBeenCalled();
  });

  it("gathers the accounts of every Project for a personal bot and drops one that fails", async () => {
    const result = await loadBotAdAccounts({ projectId: null });
    expect(result).toEqual([
      {
        projectId: "p1",
        projectName: "Alpha",
        account: account("a-p1", "Account p1"),
      },
      {
        projectId: "p2",
        projectName: "Beta",
        account: account("a-p2", "Account p2"),
      },
    ]);
  });

  it("reads only its own Project for a shared bot", async () => {
    getProjectByIdMock.mockResolvedValue({ id: "p2", name: "Beta" });
    const result = await loadBotAdAccounts({ projectId: "p2" });
    expect(result).toEqual([
      {
        projectId: "p2",
        projectName: "Beta",
        account: account("a-p2", "Account p2"),
      },
    ]);
    expect(listProjectsMock).not.toHaveBeenCalled();
    expect(listAccountsMock).toHaveBeenCalledTimes(1);
  });

  it("returns no accounts when the shared bot's Project is gone", async () => {
    getProjectByIdMock.mockResolvedValue(null);
    await expect(loadBotAdAccounts({ projectId: "p2" })).resolves.toEqual([]);
  });
});
