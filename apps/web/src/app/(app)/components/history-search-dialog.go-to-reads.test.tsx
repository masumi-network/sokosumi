import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real Projects and Channels reads: only the Route Handler answers and
// the rooms collection read are stubbed, as the browser sees them.
const { roomsReadMock } = vi.hoisted(() => ({ roomsReadMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => null,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    },
    isPending: false,
    error: null,
  }),
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

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: roomsReadMock,
}));

vi.mock("@/lib/ably/ably-connection-health-store", () => ({
  useAblyConnectionHealthy: () => false,
}));

import { HistorySearchDialog } from "@/app/components/history-search-dialog";

const labels = {
  dialogTitle: "Search",
  dialogDescription: "Search everything",
  searchPlaceholder: "Search...",
  empty: "No results found",
  loading: "Loading...",
  error: "Failed to load results",
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

const SCOPE = { userId: "user-1", organizationId: "org-1" };

function json(data: unknown) {
  return new Response(JSON.stringify({ scope: SCOPE, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The project switcher's Route Handlers. A first page that is not the whole
 * list sends a typed search to Core; `search` answers it.
 */
function projectRouteHandlers(options: {
  firstPageComplete: boolean;
  search: () => Response;
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://test");
    if (url.pathname === "/api/project-scope/pinned") return json([]);
    if (url.searchParams.get("q")) return options.search();
    return json({
      projects: [],
      nextCursor: options.firstPageComplete ? null : "cursor-2",
    });
  });
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

describe("HistorySearchDialog Projects and Channels reads", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // A phone: Search reads the rooms itself, with no sidebar to mirror.
    vi.stubGlobal("innerWidth", 390);
    roomsReadMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("says the read failed, not Loading, when Core's project search fails", async () => {
    vi.stubGlobal(
      "fetch",
      projectRouteHandlers({
        firstPageComplete: false,
        search: () => new Response(null, { status: 502 }),
      }),
    );
    roomsReadMock.mockResolvedValue({ rooms: [], nextCursor: null });
    vi.useRealTimers();
    const user = userEvent.setup();
    renderDialog();
    const status = screen.getByRole("status");

    await user.type(screen.getByPlaceholderText("Search..."), "zzz");

    await waitFor(() =>
      expect(status).toHaveTextContent("Failed to load results"),
    );
    expect(screen.getByRole("status")).toBe(status);
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("says the rooms read failed, then lists the channel once a retry answers", async () => {
    vi.stubGlobal(
      "fetch",
      projectRouteHandlers({
        firstPageComplete: true,
        search: () => json({ projects: [], nextCursor: null }),
      }),
    );
    roomsReadMock.mockResolvedValueOnce(null).mockResolvedValue({
      rooms: [
        {
          id: "room-1",
          name: "harbor-crew",
          kind: "channel",
          discoverability: "public",
        },
      ],
      nextCursor: null,
    });
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    renderDialog();
    const status = screen.getByRole("status");

    await user.type(screen.getByPlaceholderText("Search..."), "harbor");
    await waitFor(() =>
      expect(status).toHaveTextContent("Failed to load results"),
    );

    // The rooms reader's own retry, while Ably is down.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(
      await screen.findByRole("option", { name: "harbor-crew" }),
    ).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
    expect(roomsReadMock).toHaveBeenCalledTimes(2);
  });
});
