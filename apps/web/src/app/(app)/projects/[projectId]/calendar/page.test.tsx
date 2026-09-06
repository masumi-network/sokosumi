import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getProjectByIdMock = vi.fn();
const getProjectCalendarMock = vi.fn();
const listCoworkersMock = vi.fn();
const workspaceCalendarMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/app/calendar/components/workspace-calendar", () => ({
  WorkspaceCalendar: (props: unknown) => {
    workspaceCalendarMock(props);
    return null;
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: () => listCoworkersMock(),
  },
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    getProjectById: (projectId: string) => getProjectByIdMock(projectId),
    getProjectCalendar: (projectId: string, query: unknown) =>
      getProjectCalendarMock(projectId, query),
  },
}));

import ProjectCalendarPage from "./page";

const PROJECT = {
  id: "project-1",
  name: "Launch plan",
  logo: null,
  websiteUrl: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-02T00:00:00.000Z"),
};

describe("ProjectCalendarPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });
    getProjectByIdMock.mockResolvedValue(PROJECT);
    getProjectCalendarMock.mockResolvedValue({
      items: [],
      pagination: null,
    });
    listCoworkersMock.mockResolvedValue([]);
  });

  it("does not load Project data for non-NMKR users", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@example.com" } });

    await expect(
      ProjectCalendarPage({
        params: Promise.resolve({ projectId: PROJECT.id }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getProjectByIdMock).not.toHaveBeenCalled();
    expect(getProjectCalendarMock).not.toHaveBeenCalled();
  });

  it("loads only the route Project Calendar", async () => {
    render(
      await ProjectCalendarPage({
        params: Promise.resolve({ projectId: PROJECT.id }),
        searchParams: Promise.resolve({
          assigneeId: "coworker-1",
          date: "2026-06-18",
          scope: "owned",
          status: "READY",
        }),
      }),
    );

    expect(getProjectByIdMock).toHaveBeenCalledWith(PROJECT.id);
    expect(getProjectCalendarMock).toHaveBeenCalledWith(
      PROJECT.id,
      expect.objectContaining({
        from: expect.any(Date),
        to: expect.any(Date),
        limit: 100,
        assigneeId: "coworker-1",
        scope: "owned",
        status: "READY",
      }),
    );
    expect(screen.getByRole("link", { name: "backToProject" })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
    expect(
      screen.getByRole("link", { name: "backToProject" }).className,
    ).not.toContain("hidden");
    expect(workspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT.id,
        sources: [
          expect.objectContaining({
            sourceId: "project:project-1",
            sourceType: "PROJECT",
          }),
        ],
      }),
    );
  });
});
