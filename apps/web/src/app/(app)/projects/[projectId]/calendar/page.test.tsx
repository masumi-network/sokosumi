import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

/**
 * A project is not a place that contains a calendar any more: `/calendar` takes
 * a project scope like every other workspace page. The old route survives only
 * so that links and bookmarks still arrive at the right project's weeks.
 */
describe("the old /projects/:id/calendar link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the reader to the calendar scoped to that project", async () => {
    const { default: LegacyProjectCalendarPage } = await import("./page");

    await expect(
      LegacyProjectCalendarPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    ).rejects.toThrow("REDIRECT:/calendar?projectId=project-1");
  });

  it("escapes an id that needs it", async () => {
    const { default: LegacyProjectCalendarPage } = await import("./page");

    await expect(
      LegacyProjectCalendarPage({
        params: Promise.resolve({ projectId: "a b&c" }),
      }),
    ).rejects.toThrow("REDIRECT:/calendar?projectId=a%20b%26c");
  });
});
