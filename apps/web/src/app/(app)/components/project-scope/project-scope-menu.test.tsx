import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  loadPinned: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
vi.mock("@/lib/project-scope-list.client", () => ({
  // The two Route Handler reads, as the old action calls the tests assert.
  fetchScopeList: (
    path: string,
    expectedScope: { userId: string; organizationId: string | null },
  ) => {
    if (path.startsWith("/api/project-scope/pinned")) {
      return mocks.loadPinned({ expectedScope });
    }
    const query = new URL(path, "http://test").searchParams.get("q");
    return mocks.load({
      cursor: null,
      query: query ?? undefined,
      expectedScope,
    });
  },
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));

import { recordProjectVisit } from "@/hooks/use-recent-projects";

import { ProjectScopeMenu } from "./project-scope-menu";

function project(id: string, name: string, closedAt: string | null = null) {
  return { id, name, logo: null, closedAt };
}

function setup(
  props: Partial<Parameters<typeof ProjectScopeMenu>[0]> = {},
  host: (menu: ReactNode) => ReactNode = (menu) => menu,
) {
  const onSelect = vi.fn();
  const onCreate = vi.fn();
  const onDone = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      {host(
        <ProjectScopeMenu
          selectedProjectId={null}
          onSelect={onSelect}
          onCreate={onCreate}
          onDone={onDone}
          {...props}
        />,
      )}
    </QueryClientProvider>,
  );
  return { onSelect, onCreate, onDone };
}

const DEBOUNCE_WAIT = { timeout: 3000 };

/** The project rows, top to bottom. */
function rowIds() {
  return screen
    .queryAllByTestId(/^project-scope-item-/)
    .map((row) => row.dataset.testid?.replace("project-scope-item-", ""));
}

/** Whether a row carries the pin mark, by its words for assistive tech. */
function isPinnedRow(id: string) {
  return (
    within(screen.getByTestId(`project-scope-item-${id}`)).queryByText(
      "pinned",
    ) !== null
  );
}

/** Core's answer per search query; every keystroke is its own query. */
function searchResults(byQuery: Record<string, ReturnType<typeof project>[]>) {
  const firstPage = mocks.load.getMockImplementation();
  mocks.load.mockImplementation((params: { query?: string }) =>
    params.query
      ? Promise.resolve({
          projects: byQuery[params.query] ?? [],
          nextCursor: null,
        })
      : firstPage?.(params),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The trigger's project read; the menu never needs it.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ project: null }))),
  );
  localStorage.clear();
  mocks.loadPinned.mockResolvedValue([
    project("pinned-1", "Pinned One"),
    project("pinned-closed", "Pinned Closed", "2026-09-01T00:00:00Z"),
  ]);
  mocks.load.mockReset();
  mocks.load.mockResolvedValue({
    projects: [
      project("pinned-1", "Pinned One"),
      project("active-1", "Active One"),
      project("closed-1", "Closed One", "2026-09-01T00:00:00Z"),
    ],
    // More projects than the first page: a search has to ask Core.
    nextCursor: "page-2",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectScopeMenu", () => {
  it("lists Pinned projects, then recently visited, then the rest, as one list", async () => {
    mocks.load.mockResolvedValue({
      projects: [
        project("active-1", "Active One"),
        project("visited-1", "Visited One"),
        project("pinned-1", "Pinned One"),
        project("closed-1", "Closed One", "2026-09-01T00:00:00Z"),
      ],
      nextCursor: "page-2",
    });
    recordProjectVisit("visited-1", {
      userId: "user-1",
      organizationId: "org-1",
    });
    setup();

    await screen.findByText("Pinned One");
    expect(rowIds()).toEqual(["pinned-1", "visited-1", "active-1"]);
    expect(isPinnedRow("pinned-1")).toBe(true);
    expect(isPinnedRow("visited-1")).toBe(false);
    expect(isPinnedRow("active-1")).toBe(false);
    // One group of rows: no Pinned, Recent or Projects heading.
    expect(document.querySelector("[cmdk-group-heading]")).toBeNull();
    expect(screen.queryByText("Pinned Closed")).not.toBeInTheDocument();
    expect(screen.queryByText("Closed One")).not.toBeInTheDocument();
  });

  it("ends with Create project and offers no Manage projects row", async () => {
    setup();

    await screen.findByText("Pinned One");
    expect(screen.getByTestId("project-scope-create")).toBeInTheDocument();
    expect(screen.queryByTestId("project-scope-manage")).toBeNull();
    expect(screen.queryByText("manage")).toBeNull();
  });

  it("hands back the chosen project and offers no All projects row", async () => {
    const user = userEvent.setup();
    const { onSelect, onDone } = setup({ selectedProjectId: "active-1" });

    await user.click(await screen.findByText("Active One"));
    expect(onSelect).toHaveBeenLastCalledWith("active-1");
    expect(onDone).toHaveBeenCalledTimes(1);
    // The trigger's × returns to All projects, not a row here.
    expect(screen.queryByTestId("project-scope-workspace")).toBeNull();
    expect(screen.queryByText("allProjects")).toBeNull();
  });

  it("asks Core when searching and keeps the list's order and pins", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Pinned One");
    searchResults({
      one: [
        project("far-1", "Far One"),
        project("pinned-1", "Pinned One"),
        project("closed-1", "Closed One", "2026-09-01T00:00:00Z"),
      ],
    });

    await user.type(screen.getByPlaceholderText("searchPlaceholder"), "one");

    await screen.findByText("Far One");
    expect(mocks.load).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: null, query: "one" }),
    );
    expect(rowIds()).toEqual(["pinned-1", "far-1"]);
    expect(isPinnedRow("pinned-1")).toBe(true);
  });

  it("filters a complete list at once, without asking Core", async () => {
    mocks.load.mockResolvedValue({
      projects: [project("active-1", "Active One"), project("far-1", "Far")],
      nextCursor: null,
    });
    const user = userEvent.setup();
    setup();
    await screen.findByText("Active One");

    await user.type(screen.getByPlaceholderText("searchPlaceholder"), "far");

    expect(screen.getByText("Far")).toBeInTheDocument();
    expect(screen.queryByText("Active One")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("says so when a search finds nothing", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Pinned One");
    searchResults({});

    await user.type(screen.getByPlaceholderText("searchPlaceholder"), "zzz");

    await waitFor(() => expect(screen.getByText("empty")).toBeInTheDocument());
  });

  it("clears an empty search with Enter and returns focus without choosing a command", async () => {
    const user = userEvent.setup();
    const { onSelect, onCreate, onDone } = setup();
    await screen.findByText("Pinned One");
    searchResults({});
    const input = screen.getByRole("combobox");
    await user.type(input, "zzz");

    const clear = await screen.findByRole("button", { name: "clearSearch" });
    await user.tab();
    expect(clear).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    await screen.findByText("Pinned One");
    expect(screen.queryByRole("button", { name: "clearSearch" })).toBeNull();
  });

  it("says it is searching, not that none were found, until Core answers", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Pinned One");
    searchResults({});
    await user.type(screen.getByPlaceholderText("searchPlaceholder"), "zzz");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("empty"),
    );
    expect(screen.getByRole("listbox")).not.toHaveAttribute("aria-busy");

    let resolveSearch: (value: unknown) => void = () => {};
    const earlier = mocks.load.getMockImplementation();
    mocks.load.mockImplementation((params: { query?: string }) =>
      params.query === "zzzf"
        ? new Promise((resolve) => {
            resolveSearch = resolve;
          })
        : earlier?.(params),
    );
    await user.type(screen.getByPlaceholderText("searchPlaceholder"), "f");

    // The pause in typing, then Core's answer: neither is "none found".
    expect(screen.getByRole("status")).toHaveTextContent("searching");
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "true");
    await waitFor(
      () =>
        expect(mocks.load).toHaveBeenLastCalledWith(
          expect.objectContaining({ query: "zzzf" }),
        ),
      DEBOUNCE_WAIT,
    );
    expect(screen.getByRole("status")).toHaveTextContent("searching");
    expect(screen.queryByText("empty")).toBeNull();

    resolveSearch({
      projects: [project("far-1", "Far Away")],
      nextCursor: null,
    });
    await screen.findByText("Far Away");
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByRole("listbox")).not.toHaveAttribute("aria-busy");
  });

  it("names the search input and results list", async () => {
    setup();

    await screen.findByText("Active One");

    expect(screen.getByRole("combobox")).toHaveAccessibleName(
      "searchPlaceholder",
    );
    expect(screen.getByRole("listbox")).toHaveAccessibleName("all");
  });

  it("retries with Enter without choosing a project", async () => {
    const user = userEvent.setup();
    mocks.load.mockRejectedValueOnce(new Error("Core down"));
    const { onSelect, onDone } = setup();

    const retry = await screen.findByRole("button", { name: "retry" });
    expect(screen.getByRole("combobox")).toHaveFocus();
    await user.tab();
    expect(retry).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(onSelect).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toHaveFocus();
    await screen.findByText("Active One");
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.loadPinned).toHaveBeenCalledTimes(2);
  });

  it("says the list failed and asks both reads again on Retry", async () => {
    const user = userEvent.setup();
    mocks.load.mockRejectedValueOnce(new Error("Core down"));
    setup();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("error"),
    );
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.loadPinned).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "retry" }));

    await screen.findByText("Active One");
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.loadPinned).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByRole("button", { name: "retry" })).toBeNull();
  });

  it("says the list failed when only the Pinned read fails", async () => {
    const user = userEvent.setup();
    mocks.loadPinned.mockRejectedValueOnce(new Error("Core down"));
    setup();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("error"),
    );

    await user.click(screen.getByRole("button", { name: "retry" }));

    await screen.findByText("Pinned One");
    expect(mocks.loadPinned).toHaveBeenCalledTimes(2);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("tells assistive tech which choice is current", async () => {
    setup({ selectedProjectId: "active-1" });

    const current = await screen.findByTestId("project-scope-item-active-1");
    expect(within(current).getByText("current")).toHaveClass("sr-only");
    expect(
      within(screen.getByTestId("project-scope-item-pinned-1")).queryByText(
        "current",
      ),
    ).toBeNull();
  });

  it("shows one trailing icon per row, with no hidden check", async () => {
    setup({ selectedProjectId: "active-1" });

    const pinned = await screen.findByTestId("project-scope-item-pinned-1");
    expect(pinned.querySelectorAll("svg")).toHaveLength(1);
    expect(pinned.querySelector(".lucide-pin")).not.toBeNull();

    const current = screen.getByTestId("project-scope-item-active-1");
    expect(current.querySelectorAll("svg")).toHaveLength(1);
    expect(current.querySelector(".lucide-check")).not.toBeNull();
  });

  it("shows only the check on a pinned current row, and still says pinned", async () => {
    setup({ selectedProjectId: "pinned-1" });

    const row = await screen.findByTestId("project-scope-item-pinned-1");
    expect(row.querySelectorAll("svg")).toHaveLength(1);
    expect(row.querySelector(".lucide-check")).not.toBeNull();
    expect(isPinnedRow("pinned-1")).toBe(true);
  });

  it("marks no row current in the workspace view", async () => {
    setup({ selectedProjectId: null });

    await screen.findByText("Pinned One");
    expect(screen.queryByText("current")).toBeNull();
  });

  it("hands Create the control that opened the menu", async () => {
    const user = userEvent.setup();
    const { onCreate } = setup({}, (menu) => (
      <>
        <button type="button" aria-controls="scope-popover">
          Switch
        </button>
        <div role="dialog" id="scope-popover">
          {menu}
        </div>
      </>
    ));

    await user.click(await screen.findByTestId("project-scope-create"));

    expect(onCreate).toHaveBeenCalledWith(
      screen.getByRole("button", { name: "Switch" }),
    );
  });

  it("hands Create no opener outside a dialog", async () => {
    const user = userEvent.setup();
    const { onCreate } = setup();

    await user.click(await screen.findByTestId("project-scope-create"));

    expect(onCreate).toHaveBeenCalledWith(null);
  });

  it("closes itself before opening Create project", async () => {
    const user = userEvent.setup();
    const { onCreate, onDone } = setup();

    await user.click(await screen.findByTestId("project-scope-create"));

    expect(onDone).toHaveBeenCalled();
    expect(onCreate).toHaveBeenCalled();
    expect(onDone.mock.invocationCallOrder[0]).toBeLessThan(
      onCreate.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
