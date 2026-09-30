import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error("NEXT_REDIRECT");
  },
}));

import CalendarPage from "./page";

describe("CalendarPage", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("redirects to the Tasks calendar tab", async () => {
    await expect(
      CalendarPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith("/tasks?tab=calendar");
  });

  it("preserves calendar query params on redirect", async () => {
    await expect(
      CalendarPage({
        searchParams: Promise.resolve({
          projectId: "project-1",
          date: "2026-06-01",
          view: "week",
          timezone: "Europe/Berlin",
          assigneeId: "coworker-1",
          status: "READY",
          scope: "owned",
          sourceId: "workspace:workspace-1",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    const url = redirectMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith("/tasks?")).toBe(true);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("tab")).toBe("calendar");
    expect(params.get("projectId")).toBe("project-1");
    expect(params.get("date")).toBe("2026-06-01");
    expect(params.get("view")).toBe("week");
    expect(params.get("timezone")).toBe("Europe/Berlin");
    expect(params.get("assigneeId")).toBe("coworker-1");
    expect(params.get("status")).toBe("READY");
    expect(params.get("scope")).toBe("owned");
    expect(params.get("sourceId")).toBe("workspace:workspace-1");
  });
});
