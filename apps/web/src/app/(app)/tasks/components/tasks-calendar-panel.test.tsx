import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadWorkspaceCalendarPageMock } = vi.hoisted(() => ({
  loadWorkspaceCalendarPageMock: vi.fn(),
}));

vi.mock("@/app/calendar/load-calendar-page", () => ({
  loadWorkspaceCalendarPage: loadWorkspaceCalendarPageMock,
}));

vi.mock("@/app/social/components/social-calendar-preview", () => ({
  SocialCalendarPreviewProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-testid="social-calendar-preview-provider">{children}</div>,
}));

vi.mock("@/app/calendar/components/workspace-calendar", () => ({
  WorkspaceCalendar: () => <div data-testid="workspace-calendar" />,
}));

vi.mock("@/app/calendar/components/calendar-create-task-modal", () => ({
  CalendarCreateTaskModal: () => <div data-testid="create-task-modal" />,
}));

import { TasksCalendarPanel } from "./tasks-calendar-panel";

const PAGE = {
  activeOrganizationId: "org",
  currentUserId: "user",
  workspaceId: "ws",
  calendarKey: "key",
  includeSocialPosts: true,
  coworkerOptions: [],
  initialDate: "2026-10-12",
  items: [],
  latestDate: "2026-10-12",
  pagination: { nextCursor: null },
  project: null,
  projectOptions: [],
  range: {
    from: new Date("2026-10-01T00:00:00Z"),
    to: new Date("2026-10-31T00:00:00Z"),
  },
  sources: [],
};

describe("TasksCalendarPanel", () => {
  beforeEach(() => {
    loadWorkspaceCalendarPageMock.mockResolvedValue(PAGE);
  });

  it("opens Social posts on the workspace calendar without leaving it", async () => {
    render(await TasksCalendarPanel({ searchParams: Promise.resolve({}) }));

    expect(
      screen
        .getByTestId("workspace-calendar")
        .closest("[data-testid=social-calendar-preview-provider]"),
    ).toBeTruthy();
    expect(screen.getByTestId("create-task-modal")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("create-task-modal")
        .closest("[data-testid=social-calendar-preview-provider]"),
    ).toBeNull();
  });
});
