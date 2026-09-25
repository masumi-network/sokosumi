import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSwitcher } from "./variant-combined-parts";

const mocks = vi.hoisted(() => ({
  pathname: { current: "/tasks" },
  activate: vi.fn(),
  isSwitching: { current: false },
  isPending: { current: false },
  active: {
    current: { id: "org-1", name: "Acme", organization: null } as {
      id: string;
      name: string;
      organization: null;
    } | null,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname.current,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
// The real `useWorkspaceSwitcher` runs; only the activation call is faked.
vi.mock("@/lib/activate-organization-workspace", () => ({
  activateOrganizationWorkspace: mocks.activate,
  isUserNotMemberOfOrganizationError: () => false,
}));
vi.mock("@/lib/auth/auth.client", () => ({ useSession: vi.fn() }));
vi.mock("./variant-combined-actions", () => ({
  loadCombinedWorkspaces: vi.fn(),
}));
vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: vi.fn(),
  loadPinnedProjects: vi.fn(),
}));
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: () => null,
}));
vi.mock("@/app/components/header/header-workspace-avatar", () => ({
  default: () => null,
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => null,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
// The panes are real. The workspaces read Core, so a fixed list stands in,
// but its switch goes through the `switcher` the chip passes down.
vi.mock("./variant-combined-parts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./variant-combined-parts")>()),
  useCombinedScope: () => ({
    projectId: null,
    name: "All projects",
    mark: null,
    select: vi.fn(),
    openCreate: vi.fn(),
    createDialog: null,
  }),
  useCombinedWorkspaces: (switcher: WorkspaceSwitcher) => ({
    sessionUser: null,
    rows: [
      { id: "org-1", name: "Acme", organization: null },
      { id: "org-2", name: "Globex", organization: null },
    ],
    activeId: "org-1",
    active: mocks.active.current,
    isPending: mocks.isPending.current,
    isError: false,
    refetch: vi.fn(),
    isSwitching: mocks.isSwitching.current || switcher.isPending,
    select: (id: string | null) => switcher.handleSelectWorkspace(id),
  }),
}));
vi.mock("@/app/components/project-scope/project-scope-menu", () => ({
  ProjectScopeMenu: () => (
    <>
      <p>project menu</p>
      <input data-slot="command-input" aria-label="search" />
    </>
  ),
}));

import {
  CombinedMobileChip,
  setCombinedSheetOpen,
  useCombinedSheetOpen,
} from "./variant-combined-sheet";

beforeEach(() => {
  mocks.activate.mockResolvedValue(undefined);
});

afterEach(() => {
  // The flag is module state, so it outlives each test's render.
  act(() => setCombinedSheetOpen(false));
  mocks.pathname.current = "/tasks";
  mocks.isSwitching.current = false;
  mocks.isPending.current = false;
  mocks.active.current = { id: "org-1", name: "Acme", organization: null };
});

function chip() {
  return screen.getByTestId("project-scope-combined-chip");
}

function workspaceList() {
  return screen.queryByRole("list", { name: "switchWorkspace" });
}

describe("combined sheet store", () => {
  it("tells every reader when the sheet opens and closes", () => {
    const first = renderHook(() => useCombinedSheetOpen());
    const second = renderHook(() => useCombinedSheetOpen());
    expect(first.result.current).toBe(false);

    act(() => setCombinedSheetOpen(true));
    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);

    act(() => setCombinedSheetOpen(false));
    expect(first.result.current).toBe(false);
    expect(second.result.current).toBe(false);
  });
});

describe("CombinedMobileChip", () => {
  it("is the sheet's trigger and takes focus back on Escape", async () => {
    const user = userEvent.setup();
    render(<CombinedMobileChip />);

    await user.click(chip());
    const sheet = await screen.findByRole("dialog");
    // Create project finds its opener through this link.
    expect(chip()).toHaveAttribute("aria-controls", sheet.id);
    expect(chip()).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(chip()).toHaveFocus());
  });

  it("takes focus when an opener outside it has gone", async () => {
    const user = userEvent.setup();
    // The null slot keeps the chip mounted when the opener goes.
    const page = (withOpener: boolean) => (
      <>
        {withOpener ? <button type="button">sidebar opener</button> : null}
        <CombinedMobileChip />
      </>
    );
    const { rerender } = render(page(true));
    screen.getByRole("button", { name: "sidebar opener" }).focus();

    // As the sidebar button does: open the flag, then unmount with the sidebar.
    act(() => setCombinedSheetOpen(true));
    rerender(page(false));
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: "sidebar opener" }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(chip()).toHaveFocus());
  });

  it("sends focus to a visible header control when a chat room hides it", async () => {
    mocks.pathname.current = "/chat/rooms/room-1";
    const user = userEvent.setup();
    render(
      <header>
        <CombinedMobileChip />
        <button type="button">room menu</button>
      </header>,
    );
    // happy-dom lays nothing out, so every element has one rect.
    Object.defineProperty(chip(), "getClientRects", { value: () => [] });

    act(() => setCombinedSheetOpen(true));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "room menu" })).toHaveFocus(),
    );
  });

  it("names the workspace row once a failed load settles", async () => {
    mocks.active.current = null;
    render(<CombinedMobileChip />);
    act(() => setCombinedSheetOpen(true));

    const row = await screen.findByTestId(
      "project-scope-combined-workspace-row",
    );
    expect(row).toHaveAccessibleName("switchWorkspace");
  });

  it("names the workspace row while the workspaces load", async () => {
    mocks.active.current = null;
    mocks.isPending.current = true;
    render(<CombinedMobileChip />);
    act(() => setCombinedSheetOpen(true));

    expect(
      await screen.findByRole("button", { name: "switchWorkspace" }),
    ).toHaveAttribute("data-testid", "project-scope-combined-workspace-row");
  });

  it("names the active workspace, then the action", async () => {
    render(<CombinedMobileChip />);
    act(() => setCombinedSheetOpen(true));

    const row = await screen.findByTestId(
      "project-scope-combined-workspace-row",
    );
    expect(row).toHaveAccessibleName("Acme switchWorkspace");
  });

  it("focuses the search once a switch ends on the project list", async () => {
    mocks.isSwitching.current = true;
    const { rerender } = render(<CombinedMobileChip />);
    act(() => setCombinedSheetOpen(true));
    const sheet = await screen.findByRole("dialog");
    // Where Radix parks focus when the inert pane refuses autofocus.
    act(() => sheet.focus());

    mocks.isSwitching.current = false;
    rerender(<CombinedMobileChip />);

    expect(screen.getByRole("textbox", { name: "search" })).toHaveFocus();
  });

  it("focuses Back once a switch ends on the workspace list", async () => {
    mocks.isSwitching.current = true;
    const user = userEvent.setup();
    const { rerender } = render(<CombinedMobileChip />);
    act(() => setCombinedSheetOpen(true));
    await user.click(
      await screen.findByTestId("project-scope-combined-workspace-row"),
    );
    expect(screen.getByRole("button", { name: "back" })).toBeDisabled();
    act(() => screen.getByRole("dialog").focus());

    mocks.isSwitching.current = false;
    rerender(<CombinedMobileChip />);

    expect(screen.getByRole("button", { name: "back" })).toHaveFocus();
  });

  it("leaves focus where the user moved it when a switch ends", async () => {
    mocks.isSwitching.current = true;
    const { rerender } = render(<CombinedMobileChip />);
    act(() => setCombinedSheetOpen(true));
    const row = await screen.findByTestId(
      "project-scope-combined-workspace-row",
    );
    act(() => row.focus());

    mocks.isSwitching.current = false;
    rerender(<CombinedMobileChip />);

    expect(row).toHaveFocus();
  });

  it("holds the old workspace's projects while a switch runs", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CombinedMobileChip />);
    act(() => setCombinedSheetOpen(true));
    await user.click(
      await screen.findByTestId("project-scope-combined-workspace-row"),
    );
    expect(screen.getByRole("button", { name: "back" })).toBeEnabled();

    mocks.isSwitching.current = true;
    rerender(<CombinedMobileChip />);
    const back = screen.getByRole("button", { name: "back" });
    expect(back).toBeDisabled();
    await user.click(back);
    expect(workspaceList()).toBeInTheDocument();
  });

  it("shuts the project list while a switch runs", async () => {
    mocks.isSwitching.current = true;
    render(<CombinedMobileChip />);
    act(() => setCombinedSheetOpen(true));

    expect(
      await screen.findByTestId("project-scope-combined-project-pane"),
    ).toHaveAttribute("inert");
  });

  it("stays busy when the sheet closes and reopens mid-switch", async () => {
    let finish = () => {};
    mocks.activate.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<CombinedMobileChip />);

    await user.click(chip());
    await user.click(
      await screen.findByTestId("project-scope-combined-workspace-row"),
    );
    await user.click(screen.getByRole("button", { name: "Globex" }));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(chip());

    // The old workspace's projects would 404 once the switch lands.
    const pane = await screen.findByTestId(
      "project-scope-combined-project-pane",
    );
    expect(pane).toHaveAttribute("inert");
    expect(pane).toHaveAttribute("aria-busy", "true");
    await user.click(
      screen.getByTestId("project-scope-combined-workspace-row"),
    );
    for (const name of ["Acme", "Globex"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    await user.click(screen.getByRole("button", { name: "Globex" }));
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith("org-2");

    await act(async () => finish());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "back" })).toBeEnabled(),
    );
  });

  it("starts at the project list on every open", async () => {
    const user = userEvent.setup();
    render(<CombinedMobileChip />);

    await user.click(chip());
    await user.click(
      await screen.findByTestId("project-scope-combined-workspace-row"),
    );
    expect(workspaceList()).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(chip());

    expect(await screen.findByText("project menu")).toBeInTheDocument();
    expect(workspaceList()).not.toBeInTheDocument();
  });
});
