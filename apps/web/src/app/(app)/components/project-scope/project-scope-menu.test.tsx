import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  loadPinned: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
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
vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: mocks.load,
  loadPinnedProjects: mocks.loadPinned,
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));

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

function group(heading: string) {
  const node = screen.getByText(heading).closest("[cmdk-group]");
  if (!(node instanceof HTMLElement)) throw new Error(`No group ${heading}`);
  return within(node);
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
    nextCursor: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectScopeMenu", () => {
  it("lists Pinned first and never shows a closed project", async () => {
    setup();

    await screen.findByText("Pinned One");
    expect(group("pinned").getByText("Pinned One")).toBeInTheDocument();
    expect(group("recent").getByText("Active One")).toBeInTheDocument();
    expect(screen.queryByText("Pinned Closed")).not.toBeInTheDocument();
    expect(screen.queryByText("Closed One")).not.toBeInTheDocument();
    // A shortlisted project is not repeated in the full list.
    expect(screen.getAllByText("Pinned One")).toHaveLength(1);
  });

  it("hands back the chosen project, or null for the workspace view", async () => {
    const user = userEvent.setup();
    const { onSelect, onDone } = setup({ selectedProjectId: "active-1" });

    await user.click(await screen.findByText("Active One"));
    expect(onSelect).toHaveBeenLastCalledWith("active-1");

    await user.click(screen.getByTestId("project-scope-workspace"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("asks Core when searching and hides the shortlist", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Pinned One");
    searchResults({ far: [project("far-1", "Far Away")] });

    await user.type(screen.getByPlaceholderText("searchPlaceholder"), "far");

    await screen.findByText("Far Away");
    expect(mocks.load).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: null, query: "far" }),
    );
    expect(screen.queryByTestId("project-scope-workspace")).toBeNull();
    expect(screen.queryByText("pinned")).toBeNull();
  });

  it("says so when a search finds nothing", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Pinned One");
    searchResults({});

    await user.type(screen.getByPlaceholderText("searchPlaceholder"), "zzz");

    await waitFor(() => expect(screen.getByText("empty")).toBeInTheDocument());
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

  it("tells assistive tech which choice is current", async () => {
    setup({ selectedProjectId: "active-1" });

    const current = await screen.findByTestId("project-scope-item-active-1");
    expect(within(current).getByText("current")).toHaveClass("sr-only");
    expect(
      within(screen.getByTestId("project-scope-workspace")).queryByText(
        "current",
      ),
    ).toBeNull();
    expect(
      within(screen.getByTestId("project-scope-item-pinned-1")).queryByText(
        "current",
      ),
    ).toBeNull();
  });

  it("marks the workspace view current when no project is", async () => {
    setup({ selectedProjectId: null });

    await screen.findByText("Pinned One");
    expect(
      within(screen.getByTestId("project-scope-workspace")).getByText(
        "current",
      ),
    ).toBeInTheDocument();
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
