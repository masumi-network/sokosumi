import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProjectMock, listSharedMock, headerActionsMock, sharedBotsMock } =
  vi.hoisted(() => ({
    getProjectMock: vi.fn(),
    listSharedMock: vi.fn(),
    headerActionsMock: vi.fn(),
    sharedBotsMock: vi.fn(),
  }));

vi.mock("next-intl/server", () => ({
  getFormatter: async () => ({ dateTime: () => "Oct 20, 2026" }),
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: getProjectMock },
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { listShared: listSharedMock },
}));
vi.mock("@/app/projects/components/project-header-actions", () => ({
  ProjectHeaderActions: (props: object) => {
    headerActionsMock(props);
    return null;
  },
}));
vi.mock("@/app/projects/components/project-workspace-shell", () => ({
  getProjectWorkspaceLabels: async () => ({ bots: "Bots" }),
  ProjectWorkspaceShell: ({
    actions,
    children,
  }: {
    actions: ReactNode;
    children: ReactNode;
  }) => (
    <>
      {actions}
      {children}
    </>
  ),
}));
vi.mock("@/app/soko-bots/components/shared-bots-section", () => ({
  SharedBotsSection: (props: object) => {
    sharedBotsMock(props);
    return null;
  },
}));

describe("ProjectBotsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    listSharedMock.mockResolvedValue([
      { id: "bot-1", projectId: "project-1" },
      { id: "bot-2", projectId: "project-2" },
    ]);
  });

  it.each([0, 3])(
    "passes %i scheduled posts to the close dialog",
    async (scheduledSocialPostCount) => {
      getProjectMock.mockResolvedValue({
        id: "project-1",
        name: "Launch",
        projectRevision: 4,
        closingAt: null,
        closedAt: null,
        scheduledSocialPostCount,
      });
      const { default: ProjectBotsPage } = await import("./page");

      render(
        await ProjectBotsPage({
          params: Promise.resolve({ projectId: "project-1" }),
        }),
      );

      expect(headerActionsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          projectRevision: 4,
          scheduledSocialPostCount,
        }),
      );
      expect(sharedBotsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          bots: [{ id: "bot-1", projectId: "project-1" }],
        }),
      );
    },
  );

  it("returns not found for a missing Project", async () => {
    getProjectMock.mockResolvedValue(null);
    const { default: ProjectBotsPage } = await import("./page");

    await expect(
      ProjectBotsPage({ params: Promise.resolve({ projectId: "missing" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(headerActionsMock).not.toHaveBeenCalled();
  });
});
