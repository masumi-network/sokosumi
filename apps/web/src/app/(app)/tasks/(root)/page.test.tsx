import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => new Map() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import TasksPage from "./page";

/** The page's content sits in a Suspense hole; its redirect runs when rendered. */
async function renderTasksPage(searchParams: Record<string, string>) {
  const hole = TasksPage({ searchParams: Promise.resolve(searchParams) });
  const content = (hole.props as { children: { type: unknown; props: object } })
    .children;
  const component = content.type as (props: object) => Promise<unknown>;
  return component(content.props);
}

describe("TasksPage", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("sends the retired Calendar tab to the Calendar with its filters", async () => {
    await expect(
      renderTasksPage({
        tab: "calendar",
        projectId: "project-1",
        date: "2026-06-01",
        view: "week",
        timezone: "Europe/Berlin",
        assigneeId: "coworker-1",
        status: "READY",
        scope: "owned",
        socialOnly: "true",
        create: "true",
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    const url = redirectMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith("/calendar?")).toBe(true);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(Object.fromEntries(params)).toEqual({
      types: "social",
      projectId: "project-1",
      date: "2026-06-01",
      view: "week",
      timezone: "Europe/Berlin",
      assigneeId: "coworker-1",
      status: "READY",
      scope: "owned",
    });
  });
});
