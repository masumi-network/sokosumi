import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listContactsMock, pushMock, openNewTaskWizardMock, toastSuccessMock } =
  vi.hoisted(() => ({
    listContactsMock: vi.fn(),
    pushMock: vi.fn(),
    openNewTaskWizardMock: vi.fn(),
    toastSuccessMock: vi.fn(),
  }));

vi.mock("sonner", () => ({ toast: { success: toastSuccessMock } }));

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => ({
    openNewTaskWizard: openNewTaskWizardMock,
  }),
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
  copyEmail: (email: string) => `Copy ${email}`,
  emailCopied: "Email copied",
  mentionInTask: (name: string) => `Mention ${name} in a new Task`,
  tagsGroup: "Tags",
  tagTasksGroup: (name: string) => `Tasks tagged ${name}`,
  tagsError: "Couldn't load tags",
  tagTasksError: "Couldn't load these tasks",
};

function contact(
  id: string,
  name: string,
  organization: string | null,
  email?: string,
) {
  return {
    id,
    name,
    organization,
    role: null,
    kind: "PERSON",
    avatarUrl: null,
    channels: email
      ? [{ id: `${id}-e`, type: "EMAIL", value: email, isPrimary: true }]
      : [],
  };
}

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HistorySearchDialog
        open
        onOpenChange={onOpenChange}
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

  it("copies the contact's email and keeps search open", async () => {
    listContactsMock.mockResolvedValue({
      contacts: [contact("c-1", "Nina Berg", "Acme", "nina@acme.test")],
    });
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);

    await user.type(screen.getByPlaceholderText("Search..."), "nina");
    await user.click(
      await screen.findByRole("option", { name: "Copy nina@acme.test" }),
    );

    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith("Email copied"),
    );
    expect(await navigator.clipboard.readText()).toBe("nina@acme.test");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("offers no Copy email for a contact without email", async () => {
    listContactsMock.mockResolvedValue({
      contacts: [contact("c-1", "Nina Berg", "Acme")],
    });
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search..."), "nina");

    expect(
      await screen.findByRole("option", {
        name: "Mention Nina Berg in a new Task",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /^Copy / }),
    ).not.toBeInTheDocument();
  });

  it("opens a new Task draft that mentions the contact", async () => {
    listContactsMock.mockResolvedValue({
      contacts: [contact("c-1", "Nina [QA] Berg", "Acme")],
    });
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);

    await user.type(screen.getByPlaceholderText("Search..."), "nina");
    await user.click(
      await screen.findByRole("option", {
        name: "Mention Nina [QA] Berg in a new Task",
      }),
    );

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(openNewTaskWizardMock).toHaveBeenCalledWith({
      prompt: `[Nina \\[QA\\] Berg](${window.location.origin}/contacts?contact=c-1) `,
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("disables the actions while the results are for an older query", async () => {
    listContactsMock.mockResolvedValue({
      contacts: [contact("c-1", "Nina Berg", "Acme", "nina@acme.test")],
    });
    const user = userEvent.setup();
    renderDialog();

    const input = screen.getByPlaceholderText("Search...");
    await user.type(input, "nina");
    const mention = await screen.findByRole("option", {
      name: "Mention Nina Berg in a new Task",
    });
    expect(mention).toHaveAttribute("aria-disabled", "false");

    await user.type(input, "x");

    // Still Nina's row from "nina": opening stays, actions wait.
    expect(mention).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("option", { name: "Copy nina@acme.test" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Nina Berg").closest("[role=option]"),
    ).toHaveAttribute("aria-disabled", "false");
    await waitFor(() =>
      expect(listContactsMock).toHaveBeenLastCalledWith({
        search: "ninax",
        limit: 5,
      }),
    );
  });
});
