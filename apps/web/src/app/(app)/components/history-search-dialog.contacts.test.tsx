import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listContactsMock, pushMock } = vi.hoisted(() => ({
  listContactsMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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
  contactsService: { list: listContactsMock },
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({ formatDateWithYear: () => "2026-01-01" }),
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
  tagsGroup: "Tags",
  tagTasksGroup: (name: string) => `Tasks tagged ${name}`,
  tagsError: "Couldn't load tags",
  tagTasksError: "Couldn't load these tasks",
};

function contact(id: string, name: string, organization: string | null) {
  return {
    id,
    name,
    organization,
    role: null,
    kind: "PERSON",
    avatarUrl: null,
    channels: [],
  };
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

describe("HistorySearchDialog People group", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists matching contacts and opens the picked one's panel", async () => {
    listContactsMock.mockResolvedValue({
      contacts: [contact("c-1", "Nina Berg", "Acme")],
    });
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "nina");

    expect(await screen.findByText("People")).toBeInTheDocument();
    expect(listContactsMock).toHaveBeenLastCalledWith({
      search: "nina",
      limit: 5,
    });
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByText("No results found")).not.toBeInTheDocument();

    await user.click(screen.getByText("Nina Berg"));
    expect(pushMock).toHaveBeenCalledWith("/contacts?contact=c-1");
  });

  it("asks Core once for the final query, not per keystroke", async () => {
    listContactsMock.mockResolvedValue({ contacts: [] });
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "nina");

    await waitFor(() => expect(listContactsMock).toHaveBeenCalled());
    // Past another debounce window: no late calls for "n", "ni", "nin".
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(listContactsMock).toHaveBeenCalledTimes(1);
    expect(listContactsMock).toHaveBeenCalledWith({ search: "nina", limit: 5 });
  });

  it("does not say No results found while contacts are loading", async () => {
    let answer: (value: unknown) => void = () => {};
    listContactsMock.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "nina");
    await waitFor(() => expect(listContactsMock).toHaveBeenCalled());
    // History and Tags have answered empty by now; People has not.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText("No results found")).not.toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    answer({ contacts: [contact("c-1", "Nina Berg", "Acme")] });
    expect(await screen.findByText("Nina Berg")).toBeInTheDocument();
  });

  it("hides the group when the contacts request fails", async () => {
    listContactsMock.mockRejectedValue(new Error("422"));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "nina");

    await waitFor(() => expect(listContactsMock).toHaveBeenCalled());
    expect(await screen.findByText("No results found")).toBeInTheDocument();
    expect(screen.queryByText("People")).not.toBeInTheDocument();
  });
});
