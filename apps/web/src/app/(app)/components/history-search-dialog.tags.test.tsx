import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getHistory: getHistoryMock, getTasks: getTasksMock },
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
  tagsGroup: "Tags",
  tagTasksGroup: (name: string) => `Tasks tagged ${name}`,
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

function renderDialog(ui: ReactNode = null) {
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

    const task = await screen.findByRole("option", { name: /Draw the logo/ });
    expect(screen.getByText("Tasks tagged Design")).toBeInTheDocument();
    expect(getTasksMock).toHaveBeenCalledWith({
      workspaceTagId: "tag-design",
      scope: "workspace",
      sort: "updatedAt",
      limit: 5,
    });

    await user.click(task);
    expect(pushMock).toHaveBeenCalledWith("/tasks/SOK-7-draw-the-logo");
  });

  it("shows no tags before anything is typed", async () => {
    renderDialog();

    await waitFor(() => expect(getHistoryMock).toHaveBeenCalled());
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
    expect(getTasksMock).not.toHaveBeenCalled();
  });
});
