import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getWorkspaceCalendarMock = vi.fn();
const getWorkspaceCalendarSourcesMock = vi.fn();
const listCoworkersMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("@/app/calendar/components/workspace-calendar", () => ({
  WorkspaceCalendar: () => null,
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: () => listCoworkersMock(),
  },
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getWorkspaceCalendar: (query: unknown) => getWorkspaceCalendarMock(query),
    getWorkspaceCalendarSources: () => getWorkspaceCalendarSourcesMock(),
  },
}));

import CalendarPage from "./page";

describe("CalendarPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue(null);
    getWorkspaceCalendarMock.mockResolvedValue({
      items: [],
      pagination: {
        cursor: null,
        limit: 100,
        nextCursor: null,
        total: 0,
      },
    });
    getWorkspaceCalendarSourcesMock.mockResolvedValue([]);
    listCoworkersMock.mockResolvedValue([]);
  });

  it("does not load Calendar data for non-NMKR users", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@example.com" } });

    await expect(
      CalendarPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getWorkspaceCalendarMock).not.toHaveBeenCalled();
    expect(getWorkspaceCalendarSourcesMock).not.toHaveBeenCalled();
  });

  it("loads Calendar data for NMKR users", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });

    await CalendarPage({ searchParams: Promise.resolve({}) });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledOnce();
    expect(getWorkspaceCalendarSourcesMock).toHaveBeenCalledOnce();
  });

  it("passes the Calendar status filter to the initial read", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });

    await CalendarPage({
      searchParams: Promise.resolve({ status: "READY" }),
    });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "READY" }),
    );
  });
});
