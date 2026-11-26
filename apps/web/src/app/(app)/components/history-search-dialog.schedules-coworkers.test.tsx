import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  pushMock,
  openNewTaskWizardMock,
  listTaskSchedulesMock,
  getAssigneesMock,
  CoreApiRequestError,
} = vi.hoisted(() => ({
  CoreApiRequestError: class extends Error {
    constructor(readonly status: number) {
      super(`Core ${status}`);
    }
  },
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
  CoreApiRequestError,
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
  tasksSeeAll: (query: string) => `Search tasks and results for ${query}`,
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
};

function coworker(id: string, name: string) {
  return { id, name, slug: id, image: null };
}

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
    },
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
      screen.getByRole("option", { name: "SEO Writer New task" }),
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

  it("says the read failed, not No results, when Schedules fail to load", async () => {
    listTaskSchedulesMock.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "weekly");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Failed"),
    );
    expect(screen.queryByText("No results found")).not.toBeInTheDocument();
  });

  it("says the read failed when Coworkers fail to load", async () => {
    getAssigneesMock.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "seo");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Failed"),
    );
  });

  it("reads a member without a seat as no Schedules, not a failure", async () => {
    listTaskSchedulesMock.mockRejectedValue(new CoreApiRequestError(403));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "weekly");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("No results found"),
    );
  });

  it("never opens the previous query's Schedule with Enter while the new query waits", async () => {
    listTaskSchedulesMock.mockImplementation(async ({ q }: { q: string }) => ({
      data: q === "weekly" ? [{ id: "s-1", name: "Weekly report" }] : [],
    }));
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByPlaceholderText("Search...");

    await user.type(input, "weekly");
    const option = await screen.findByRole("option", {
      name: "Weekly report",
    });
    expect(option).toHaveAttribute("aria-disabled", "false");

    await user.type(input, " sync{Enter}");

    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(pushMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "Weekly report" }),
      ).not.toBeInTheDocument(),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
