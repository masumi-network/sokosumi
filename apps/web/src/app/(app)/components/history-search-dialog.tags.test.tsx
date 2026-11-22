import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getHistoryMock, getTasksMock, fetchLabelsMock, pushMock } = vi.hoisted(
  () => ({
    getHistoryMock: vi.fn(),
    getTasksMock: vi.fn(),
    fetchLabelsMock: vi.fn(),
    pushMock: vi.fn(),
  }),
);

// Projects and Channels read the session and rooms; covered in go-to tests.
// Here they answer at once with nothing, so only this file's groups count.
vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  useScopeProjects: () => ({ rows: [] }),
}));
vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRoomsRead: () => ({ rooms: [], failed: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getHistory: getHistoryMock,
    getTasks: getTasksMock,
    listTaskSchedules: async () => ({ data: [] }),
    getTaskScheduleAssignees: async () => ({
      data: { coworkers: [], sokoBot: null },
    }),
  },
}));

vi.mock("@/lib/utils/file-search.client", () => ({
  EMPTY_FILE_FILTERS: {},
  fetchFileSearchPage: async () => ({ items: [] }),
  fetchWorkspaceLabels: fetchLabelsMock,
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({ formatDateWithYear: () => "2026-01-01" }),
}));

import { HistorySearchDialog } from "@/app/components/history-search-dialog";
import { matchWorkspaceTags } from "@/app/components/use-tag-search-group";

const labels = {
  dialogTitle: "Search",
  dialogDescription: "Search everything",
  searchPlaceholder: "Search...",
  empty: "No results found",
  loading: "Loading...",
  error: "Failed",
  created: "Created",
  filesGroup: "Files",
  filesSeeAll: "See all files",
  filesFilenameMatch: "Filename match",
  peopleGroup: "People",
  copyEmail: (email: string) => `Copy ${email}`,
  emailCopied: "Email copied",
  emailCopyFailed: "Failed to copy email",
  mentionInTask: (name: string) => `Mention ${name} in a new task`,
  tagsGroup: "Tags",
  tagTasksGroup: (name: string) => `Tasks tagged ${name}`,
  tagsError: "Couldn't load tags",
  tagTasksError: "Couldn't load these tasks",
  projectsGroup: "Projects",
  channelsGroup: "Channels",
  schedulesGroup: "Schedules",
  coworkersGroup: "Coworkers",
  newTask: "New task",
  newTaskWith: (name: string) => `New task with ${name}`,
};

function tag(id: string, displayName: string, archived = false) {
  return {
    id,
    kind: "TAG" as const,
    displayName,
    description: null,
    archived,
    vocabularyVersion: 1,
  };
}

function renderDialog(
  ui: ReactNode = null,
  activeOrganizationId: string | null = "org-1",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId={activeOrganizationId}
        labels={labels}
      />
      {ui}
    </QueryClientProvider>,
  );
}

describe("HistorySearchDialog workspace tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHistoryMock.mockResolvedValue({ data: [] });
    getTasksMock.mockResolvedValue({ data: [] });
    fetchLabelsMock.mockResolvedValue([
      tag("tag-design", "Design"),
      tag("tag-sales", "Sales"),
      tag("tag-old", "Design archive", true),
    ]);
  });

  it("shows tags matching the typed name and opens the board filtered by one", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "desi");

    const option = await screen.findByRole("option", { name: "#Design" });
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.queryByText("#Sales")).not.toBeInTheDocument();
    expect(screen.queryByText("#Design archive")).not.toBeInTheDocument();
    expect(screen.queryByText("No results found")).not.toBeInTheDocument();

    await user.click(option);
    expect(pushMock).toHaveBeenCalledWith("/tasks?tag=tag-design");
  });

  it("accepts a leading # and lists the best tag's Tasks", async () => {
    getTasksMock.mockResolvedValue({
      data: [{ id: "task-1", identifier: "SOK-7", name: "Draw the logo" }],
    });
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "#design");

    const group = await screen.findByRole("group", {
      name: "Tasks tagged Design",
    });
    const task = await within(group).findByRole("option", {
      name: /Draw the logo/,
    });
    expect(getTasksMock).toHaveBeenCalledWith({
      workspaceTagId: "tag-design",
      scope: "workspace",
      sort: "updatedAt",
      limit: 5,
    });

    await user.click(task);
    expect(pushMock).toHaveBeenCalledWith("/tasks/SOK-7-draw-the-logo");
  });

  it("shows a tagged Task with the same date and status as other results", async () => {
    getTasksMock.mockResolvedValue({
      data: [
        {
          id: "task-1",
          identifier: "SOK-7",
          name: "Draw the logo",
          status: "DRAFT",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          owner: null,
        },
      ],
    });
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "design");

    const task = await screen.findByRole("option", { name: /Draw the logo/ });
    expect(within(task).getByText("2026-01-01")).toBeInTheDocument();
    expect(within(task).getByText("Draft")).toBeInTheDocument();
  });

  it("shows no tags before anything is typed", async () => {
    renderDialog();

    await waitFor(() => expect(getHistoryMock).toHaveBeenCalled());
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
    expect(getTasksMock).not.toHaveBeenCalled();
  });

  it("does not claim no results while tags are still loading", async () => {
    fetchLabelsMock.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "design");

    await waitFor(() =>
      expect(getHistoryMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: "design" }),
      ),
    );
    expect(await screen.findByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("No results found")).not.toBeInTheDocument();
  });

  it("says tags failed to load instead of no results", async () => {
    fetchLabelsMock.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "design");

    expect(await screen.findByText("Couldn't load tags")).toBeInTheDocument();
    expect(screen.queryByText("No results found")).not.toBeInTheDocument();
  });

  it("shows the tag's Tasks loading, then their failure", async () => {
    let fail: (error: Error) => void = () => {};
    getTasksMock.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "design");

    await screen.findByRole("option", { name: "#Design" });
    expect(screen.getByText("Tasks tagged Design")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    fail(new Error("down"));
    expect(
      await screen.findByText("Couldn't load these tasks"),
    ).toBeInTheDocument();
  });

  it("asks for the reader's own Tasks in a personal workspace", async () => {
    const user = userEvent.setup();
    renderDialog(null, null);

    await user.type(screen.getByPlaceholderText("Search..."), "design");

    await waitFor(() =>
      expect(getTasksMock).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "owned" }),
      ),
    );
  });
});

describe("matchWorkspaceTags", () => {
  it("puts an exact name first, then prefixes, then other matches", () => {
    const tags = [
      tag("t1", "Web design"),
      tag("t2", "Design system"),
      tag("t3", "Design"),
    ];

    expect(matchWorkspaceTags(tags, "#DESIGN").map((t) => t.id)).toEqual([
      "t3",
      "t2",
      "t1",
    ]);
  });
});
