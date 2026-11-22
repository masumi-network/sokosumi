import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  pushMock,
  openNewTaskWizardMock,
  listTaskSchedulesMock,
  getAssigneesMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  openNewTaskWizardMock: vi.fn(),
  listTaskSchedulesMock: vi.fn(),
  getAssigneesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => ({
    openNewTaskWizard: openNewTaskWizardMock,
  }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getHistory: async () => ({ data: [], meta: { nextCursor: null } }),
    listTaskSchedules: listTaskSchedulesMock,
    getTaskScheduleAssignees: getAssigneesMock,
  },
}));

vi.mock("@/lib/utils/file-search.client", () => ({
  EMPTY_FILE_FILTERS: {},
  fetchFileSearchPage: async () => ({ items: [] }),
  fetchWorkspaceLabels: async () => [],
}));

vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { list: async () => ({ contacts: [] }) },
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({ formatDateWithYear: () => "2026-01-01" }),
}));

vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  useScopeProjects: () => ({ rows: [] }),
}));

vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRoomsRead: () => ({ rooms: [], failed: false }),
}));

vi.mock("use-debounce", async (importOriginal) => ({
  ...(await importOriginal<typeof import("use-debounce")>()),
  useDebounce: (value: unknown) => [value],
}));

import { HistorySearchDialog } from "@/app/components/history-search-dialog";

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

function coworker(id: string, name: string) {
  return { id, name, slug: id, image: null };
}

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <HistorySearchDialog
        open
        onOpenChange={onOpenChange}
        activeOrganizationId="org-1"
        labels={labels}
      />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe("HistorySearchDialog Schedules and Coworkers groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTaskSchedulesMock.mockResolvedValue({ data: [] });
    getAssigneesMock.mockResolvedValue({
      data: { coworkers: [], sokoBot: null },
    });
  });

  it("asks Core for schedules by name and opens the picked one", async () => {
    listTaskSchedulesMock.mockImplementation(async ({ q }: { q: string }) => ({
      data: q === "weekly" ? [{ id: "s-1", name: "Weekly report" }] : [],
    }));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "weekly");

    expect(await screen.findByText("Schedules")).toBeInTheDocument();
    expect(listTaskSchedulesMock).toHaveBeenLastCalledWith({
      q: "weekly",
      limit: 5,
    });
    await user.click(screen.getByRole("option", { name: "Weekly report" }));
    expect(pushMock).toHaveBeenCalledWith("/schedules/s-1");
  });

  it("lists matching Coworkers, never the Soko Bot, and starts a Task with the picked one", async () => {
    getAssigneesMock.mockResolvedValue({
      data: {
        coworkers: [coworker("c-1", "SEO Writer"), coworker("c-2", "Designer")],
        sokoBot: { id: "b-1", name: "Seo Bot", avatarSeed: null },
      },
    });
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "seo");

    expect(await screen.findByText("Coworkers")).toBeInTheDocument();
    expect(screen.queryByText("Designer")).not.toBeInTheDocument();
    expect(screen.queryByText("Seo Bot")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("option", { name: "New task with SEO Writer" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(openNewTaskWizardMock).toHaveBeenCalledWith({ assigneeId: "c-1" });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not say No results while Schedules are still loading", async () => {
    listTaskSchedulesMock.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "weekly");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Loading..."),
    );
  });

  it("hides the groups when their reads fail, without blocking No results", async () => {
    listTaskSchedulesMock.mockRejectedValue(new Error("down"));
    getAssigneesMock.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "weekly");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("No results found"),
    );
    expect(screen.queryByText("Schedules")).not.toBeInTheDocument();
  });
});
