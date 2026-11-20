import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, useScopeProjectsMock, useLiveChatRoomsMock } = vi.hoisted(
  () => ({
    pushMock: vi.fn(),
    useScopeProjectsMock: vi.fn(),
    useLiveChatRoomsMock: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => null,
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getHistory: async () => ({ data: [], meta: { nextCursor: null } }),
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
  useScopeProjects: useScopeProjectsMock,
}));

vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRooms: useLiveChatRoomsMock,
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
};

function room(id: string, name: string, kind = "channel") {
  return { id, name, kind, discoverability: "public" };
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HistorySearchDialog
        open
        onOpenChange={vi.fn()}
        activeOrganizationId="org-1"
        labels={labels}
      />
    </QueryClientProvider>,
  );
}

describe("HistorySearchDialog Projects and Channels groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useScopeProjectsMock.mockReturnValue({ rows: [] });
    useLiveChatRoomsMock.mockReturnValue([]);
  });

  it("lists the projects Core matches for the query and opens the picked one", async () => {
    useScopeProjectsMock.mockImplementation(
      ({ search }: { search: string }) => ({
        rows: search.includes("launch")
          ? [{ id: "p-1", name: "Spring launch", logo: null }]
          : [],
      }),
    );
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "launch");

    expect(await screen.findByText("Projects")).toBeInTheDocument();
    await user.click(screen.getByText("Spring launch"));
    expect(pushMock).toHaveBeenCalledWith("/projects/p-1");
  });

  it("lists the reader's channels whose name matches, never Directs", async () => {
    useLiveChatRoomsMock.mockReturnValue([
      room("r-1", "marketing"),
      room("r-2", "Marketing team", "direct"),
      room("r-3", "sales"),
    ]);
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "MARK");

    expect(await screen.findByText("Channels")).toBeInTheDocument();
    expect(screen.getByText("marketing")).toBeInTheDocument();
    expect(screen.queryByText("Marketing team")).not.toBeInTheDocument();
    expect(screen.queryByText("sales")).not.toBeInTheDocument();
    expect(screen.queryByText("No results found")).not.toBeInTheDocument();

    await user.click(screen.getByText("marketing"));
    expect(pushMock).toHaveBeenCalledWith("/chat/rooms/r-1");
  });

  it("shows at most five of each", async () => {
    useLiveChatRoomsMock.mockReturnValue(
      Array.from({ length: 7 }, (_, index) =>
        room(`r-${index}`, `ops-${index}`),
      ),
    );
    useScopeProjectsMock.mockReturnValue({
      rows: Array.from({ length: 7 }, (_, index) => ({
        id: `p-${index}`,
        name: `ops project ${index}`,
        logo: null,
      })),
    });
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "ops");

    expect(await screen.findAllByText(/^ops-\d$/)).toHaveLength(5);
    expect(screen.getAllByText(/^ops project \d$/)).toHaveLength(5);
  });

  it("reads no projects or rooms before anything is typed", () => {
    renderDialog();

    expect(useScopeProjectsMock).not.toHaveBeenCalled();
    expect(useLiveChatRoomsMock).not.toHaveBeenCalled();
  });
});
