import { err, ok } from "neverthrow";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn(async () => undefined);
const getSessionResultMock = vi.fn();
const getSessionMock = vi.fn();
const readWorkspaceCalendarPageMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: () => getSessionResultMock(),
  getSession: () => getSessionMock(),
}));
vi.mock("@/app/calendar/load-calendar-page", () => ({
  readWorkspaceCalendarPage: (input: unknown, session: unknown) =>
    readWorkspaceCalendarPageMock(input, session),
  requestCalendarTimezone: async () => "UTC",
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getMine: async () => null },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    listWorkspaceSocialPosts: async () => ({ items: [], hasMore: false }),
  },
}));

const { loadSocialPageData } = await import("./social-page-data");

const SESSION = {
  user: { id: "user-1" },
  session: { activeOrganizationId: "org-1" },
};

describe("loadSocialPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionResultMock.mockReset();
    getSessionMock.mockReset();
    readWorkspaceCalendarPageMock.mockReset();
    readWorkspaceCalendarPageMock.mockImplementation(
      async (_input, session: typeof SESSION | null) => ({
        activeOrganizationId: session?.session.activeOrganizationId ?? null,
      }),
    );
  });

  // connection() would drop the page from every link prefetch.
  it("reads the page without deferring to the request", async () => {
    getSessionResultMock.mockResolvedValue(ok(SESSION));

    const data = await loadSocialPageData({});

    expect(data).toMatchObject({
      kind: "workspace",
      calendar: { activeOrganizationId: "org-1" },
    });
    expect(connectionMock).not.toHaveBeenCalled();
  });

  // The cached read must not keep an outage as "signed out", so the click
  // renders fresh and the page degrades as before.
  it("renders a session outage fresh on the click", async () => {
    getSessionResultMock.mockResolvedValue(err({ reason: "timeout" }));
    getSessionMock.mockResolvedValue(null);

    const data = await loadSocialPageData({});

    expect(connectionMock).toHaveBeenCalledOnce();
    expect(data).toMatchObject({
      kind: "workspace",
      calendar: { activeOrganizationId: null },
    });
  });

  // Any redirect thrown inside the cached read, such as a Core 401 from a
  // service, must reach the prefetch instead of the fresh fallback.
  it("keeps a sign-in redirect from the cached read", async () => {
    getSessionResultMock.mockImplementation(async () => redirect("/signin"));

    await expect(loadSocialPageData({})).rejects.toThrow("NEXT_REDIRECT");

    expect(connectionMock).not.toHaveBeenCalled();
  });
});
