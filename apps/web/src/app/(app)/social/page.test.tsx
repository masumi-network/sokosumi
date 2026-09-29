import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hasSocialBetaAccessMock,
  loadWorkspaceCalendarPageMock,
  notFoundMock,
  projectServiceMock,
} = vi.hoisted(() => ({
  hasSocialBetaAccessMock: vi.fn(),
  loadWorkspaceCalendarPageMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  projectServiceMock: {
    getProjectById: vi.fn(),
    getSocialPost: vi.fn(),
    listSocialConnections: vi.fn(),
    listSocialPosts: vi.fn(),
  },
}));

vi.mock("next/server", () => ({ connection: async () => undefined }));

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

vi.mock("@/lib/social-beta-access.server", () => ({
  hasCurrentUserSocialBetaAccess: hasSocialBetaAccessMock,
}));

vi.mock("@/app/calendar/load-calendar-page", () => ({
  loadWorkspaceCalendarPage: loadWorkspaceCalendarPageMock,
}));

vi.mock("@/app/calendar/components/workspace-calendar", () => ({
  WorkspaceCalendar: (props: {
    includeSocialPosts?: boolean;
    lockedProjectId?: string;
    socialPostsOnly?: boolean;
  }) => (
    <div
      data-testid="social-calendar"
      data-include-social={String(props.includeSocialPosts)}
      data-locked-project={props.lockedProjectId ?? ""}
      data-social-only={String(props.socialPostsOnly)}
    />
  ),
}));

vi.mock("@/app/projects/components/social-posts/project-social-posts", () => ({
  ProjectSocialPosts: (props: {
    posts: { id: string }[];
    projectId: string;
    selectedPostId?: string;
  }) => (
    <div
      data-testid="social-posts"
      data-order={props.posts.map((post) => post.id).join(",")}
      data-project={props.projectId}
      data-selected={props.selectedPostId}
    />
  ),
}));

vi.mock("@/app/projects/components/project-social-accounts", () => ({
  ProjectSocialAccounts: (props: {
    connections: { id: string }[];
    projectId: string;
  }) => (
    <div
      data-testid="social-accounts"
      data-connections={props.connections.length}
      data-project={props.projectId}
    />
  ),
}));

// The picker reaches for the sidebar switcher's list, which reads the session
// through react-query. This file is about which state the page chooses.
vi.mock("./components/social-project-picker", () => ({
  SocialProjectPicker: ({ notice }: { notice?: string }) => (
    <div data-testid="social-no-project">{notice ?? "pick a project"}</div>
  ),
}));

const PROJECT = {
  id: "project-1",
  name: "Launch plan",
  logo: null,
  workspaceId: "workspace-1",
  updatedAt: new Date("2026-05-27T10:00:00.000Z"),
  createdAt: new Date("2026-05-01T10:00:00.000Z"),
};

const CALENDAR = {
  activeOrganizationId: "org-1",
  calendarKey: "key-1",
  coworkerOptions: [],
  currentUserId: "user-1",
  includeSocialPosts: true,
  initialDate: "2026-06-01",
  items: [],
  latestDate: "2026-08-30",
  pagination: null,
  project: PROJECT,
  projectOptions: [],
  range: { from: new Date("2026-06-01"), to: new Date("2026-06-08") },
  sources: [],
  workspaceId: "workspace-1",
};

function page(cursor: string | null = null) {
  return { posts: [], nextCursor: cursor };
}

async function visit(
  searchParams: Record<string, string | undefined> = {},
): Promise<void> {
  const { default: SocialPage } = await import("./page");
  render(await SocialPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("SocialPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSocialBetaAccessMock.mockResolvedValue(true);
    projectServiceMock.listSocialPosts.mockResolvedValue(page());
    projectServiceMock.listSocialConnections.mockResolvedValue([]);
    loadWorkspaceCalendarPageMock.mockResolvedValue(CALENDAR);
  });

  it("stays hidden outside the beta", async () => {
    hasSocialBetaAccessMock.mockResolvedValue(false);

    const { default: SocialPage } = await import("./page");

    await expect(
      SocialPage({ searchParams: Promise.resolve({ projectId: "project-1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
    // Nothing is read for a reader who may not see any of it.
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
  });

  it("asks which project to post for when no scope is set", async () => {
    await visit();

    expect(screen.getByTestId("social-no-project")).toBeInTheDocument();
    expect(screen.queryByTestId("social-posts")).not.toBeInTheDocument();
    // Accounts belong to a project, so there is nothing to read without one.
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
    expect(projectServiceMock.listSocialPosts).not.toHaveBeenCalled();
  });

  it("treats a blank projectId as no scope rather than as a project", async () => {
    await visit({ projectId: " " });

    expect(screen.getByTestId("social-no-project")).toBeInTheDocument();
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
  });

  it("offers another project instead of 404ing on a scope this workspace lost", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(null);

    await visit({ projectId: "project-gone" });

    // The id came from a switchable scope, not from the path: the repair is to
    // pick another project, not to leave the page.
    expect(screen.getByTestId("social-no-project")).toHaveTextContent(
      "App.Social.pickUnavailable",
    );
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(projectServiceMock.listSocialPosts).not.toHaveBeenCalled();
  });

  it("opens the scoped project's posts, calendar and accounts", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);

    await visit({ projectId: "project-1" });

    expect(screen.getByTestId("social-posts")).toHaveAttribute(
      "data-project",
      "project-1",
    );
    expect(screen.getByTestId("social-accounts")).toHaveAttribute(
      "data-project",
      "project-1",
    );
    // One read per tab: upcoming, drafts and needs attention. Published and
    // canceled posts are left to the calendar.
    expect(projectServiceMock.listSocialPosts).toHaveBeenCalledTimes(3);
  });

  /**
   * Social's calendar is Social's, not the workspace calendar with a filter
   * left over from the last visit. Task runs never appear on it, so the lock
   * is a prop rather than a toggle the reader has to find and keep set.
   */
  it("locks its calendar to this project's Social posts", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);

    await visit({ projectId: "project-1" });

    const calendar = screen.getByTestId("social-calendar");
    expect(calendar).toHaveAttribute("data-social-only", "true");
    expect(calendar).toHaveAttribute("data-locked-project", "project-1");
    // Without the opt-in Core returns no Social posts at all, so a locked
    // Social calendar that forgot it would render empty forever.
    expect(calendar).toHaveAttribute("data-include-social", "true");
    expect(loadWorkspaceCalendarPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );
  });

  it("puts a post named in the URL at the front, and only once", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    projectServiceMock.listSocialPosts.mockResolvedValue({
      posts: [{ id: "post-a" }, { id: "post-deep" }],
      nextCursor: null,
    });
    projectServiceMock.getSocialPost.mockResolvedValue({ id: "post-deep" });

    await visit({ projectId: "project-1", postId: "post-deep" });

    // A link to a post has to open that post even when it is older than the
    // first page of its section — and it must not show up twice for it.
    expect(
      screen.getByTestId("social-posts").getAttribute("data-order"),
    ).toMatch(/^post-deep,/);
    expect(
      screen
        .getByTestId("social-posts")
        .getAttribute("data-order")
        ?.split(",")
        .filter((id) => id === "post-deep"),
    ).toHaveLength(1);
    // Named, too, so the list opens the tab that holds it.
    expect(screen.getByTestId("social-posts")).toHaveAttribute(
      "data-selected",
      "post-deep",
    );
  });

  it("does not fetch a post when the URL names none", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);

    await visit({ projectId: "project-1" });

    expect(projectServiceMock.getSocialPost).not.toHaveBeenCalled();
  });

  /**
   * The page carries no visible headline, so the `sr-only` `h1` is the only
   * thing that places it in the outline. Everything below it is a section *of*
   * Social, and an outline that starts at `h2` leaves a screen-reader reader
   * with nowhere to stand.
   */
  it("keeps one page-level heading, hidden but present", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);

    await visit({ projectId: "project-1" });

    const [heading] = screen.getAllByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("App.Social.title");
    expect(heading).toHaveClass("sr-only");
  });

  it("names the page in the document title", async () => {
    const { generateMetadata } = await import("./page");

    await expect(generateMetadata()).resolves.toEqual({
      title: "App.Social.title",
    });
  });
});
