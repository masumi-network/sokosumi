import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();
const loadWorkspaceCalendarPageMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("./load-calendar-page", () => ({
  loadWorkspaceCalendarPage: (query: unknown) =>
    loadWorkspaceCalendarPageMock(query),
}));

vi.mock("@/app/social/components/social-calendar-preview", () => ({
  SocialCalendarPreviewProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-testid="social-calendar-preview-provider">{children}</div>,
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  CreateTaskModalProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="create-task-modal-provider">{children}</div>
  ),
}));

vi.mock("@/app/calendar/components/workspace-calendar", () => ({
  WorkspaceCalendar: (props: { newsletterEnabled: boolean }) => (
    <div
      data-newsletter={String(props.newsletterEnabled)}
      data-testid="workspace-calendar"
    />
  ),
}));

vi.mock("@/app/calendar/components/calendar-create-task-modal", () => ({
  CalendarCreateTaskModal: () => <div data-testid="create-task-modal" />,
}));

import CalendarPage from "./page";

const PAGE = {
  activeOrganizationId: "org",
  currentUserId: "user",
  workspaceId: "ws",
  calendarKey: "key",
  coworkerOptions: [],
  initialDate: "2026-10-12",
  items: [],
  latestDate: "2026-10-12",
  newsletterEnabled: true,
  pagination: { nextCursor: null },
  project: null,
  projectOptions: [],
  range: {
    from: new Date("2026-10-01T00:00:00Z"),
    to: new Date("2026-10-31T00:00:00Z"),
  },
  sources: [],
};

describe("CalendarPage", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    loadWorkspaceCalendarPageMock.mockReset();
    loadWorkspaceCalendarPageMock.mockResolvedValue(PAGE);
  });

  it("renders the Calendar instead of redirecting to the Tasks tab", async () => {
    render(
      await CalendarPage({
        searchParams: Promise.resolve({
          projectId: "project-1",
          types: "social,contacts",
        }),
      }),
    );

    expect(redirectMock).not.toHaveBeenCalled();
    expect(loadWorkspaceCalendarPageMock).toHaveBeenCalledOnce();
    const query =
      await loadWorkspaceCalendarPageMock.mock.calls[0][0].searchParams;
    expect(query).toEqual({ projectId: "project-1", types: "social,contacts" });
    expect(screen.getByTestId("workspace-calendar")).toHaveAttribute(
      "data-newsletter",
      "true",
    );
  });

  it("gives the Calendar the create-task modal it opens from an empty slot", async () => {
    render(await CalendarPage({ searchParams: Promise.resolve({}) }));

    const modal = screen.getByTestId("create-task-modal");
    expect(modal.closest("[data-testid=create-task-modal-provider]")).toBe(
      screen
        .getByTestId("workspace-calendar")
        .closest("[data-testid=create-task-modal-provider]"),
    );
    // Social posts open in place, without the modal's provider reaching them.
    expect(
      screen
        .getByTestId("workspace-calendar")
        .closest("[data-testid=social-calendar-preview-provider]"),
    ).toBeTruthy();
    expect(
      modal.closest("[data-testid=social-calendar-preview-provider]"),
    ).toBeNull();
  });

  it("turns the old Social posts only switch into the Social filter", async () => {
    await expect(
      CalendarPage({
        searchParams: Promise.resolve({
          socialOnly: "true",
          projectId: "project-1",
          date: "2026-06-01",
          view: "week",
          timezone: "Europe/Berlin",
          assigneeId: "coworker-1",
          status: "READY",
          scope: "owned",
          postStatus: "FAILED",
          provider: "x",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    const url = redirectMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith("/calendar?")).toBe(true);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("types")).toBe("social");
    expect(params.has("socialOnly")).toBe(false);
    expect(Object.fromEntries(params)).toMatchObject({
      projectId: "project-1",
      date: "2026-06-01",
      view: "week",
      timezone: "Europe/Berlin",
      assigneeId: "coworker-1",
      status: "READY",
      scope: "owned",
      postStatus: "FAILED",
      provider: "x",
    });
    expect(loadWorkspaceCalendarPageMock).not.toHaveBeenCalled();
  });

  it("drops a retired socialOnly=false without adding a filter", async () => {
    await expect(
      CalendarPage({
        searchParams: Promise.resolve({ socialOnly: "false", view: "week" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith("/calendar?view=week");
  });
});
