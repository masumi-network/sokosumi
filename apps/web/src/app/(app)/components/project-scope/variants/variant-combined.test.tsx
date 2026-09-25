import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSwitcher } from "./variant-combined-parts";

const mocks = vi.hoisted(() => ({
  isMobile: { current: false },
  setOpenMobile: vi.fn(),
  isSwitching: { current: false },
  activate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
// The real `useWorkspaceSwitcher` runs; only the activation call is faked.
vi.mock("@/lib/activate-organization-workspace", () => ({
  activateOrganizationWorkspace: mocks.activate,
  isUserNotMemberOfOrganizationError: () => false,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({
    isMobile: mocks.isMobile.current,
    setOpenMobile: mocks.setOpenMobile,
  }),
  SidebarGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarMenuButton: (props: ComponentProps<"button">) => <button {...props} />,
  SidebarRowSlot: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
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
// The panes are real. The workspaces read Core, so a fixed list stands in,
// but its switch goes through the `switcher` the trigger passes down.
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
    active: { id: "org-1", name: "Acme", organization: null },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    isSwitching: mocks.isSwitching.current || switcher.isPending,
    select: (id: string | null) => switcher.handleSelectWorkspace(id),
  }),
}));
vi.mock("@/app/components/project-scope/project-scope-menu", () => ({
  ProjectScopeMenu: () => <p>project menu</p>,
}));

import { combinedSlots } from "./variant-combined";
import {
  setCombinedSheetOpen,
  useCombinedSheetOpen,
} from "./variant-combined-sheet";

function slot(name: keyof typeof combinedSlots) {
  const Slot = combinedSlots[name];
  if (!Slot) throw new Error(`The combined variant has no ${name} slot.`);
  return Slot;
}

const SidebarHeaderTrigger = slot("sidebar-header");
const RailTrigger = slot("sidebar-top");

function workspaceList() {
  return screen.getByRole("list", { name: "switchWorkspace" });
}

function projectPane() {
  return screen.getByTestId("project-scope-combined-project-pane");
}

beforeEach(() => {
  mocks.activate.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => setCombinedSheetOpen(false));
  mocks.isMobile.current = false;
  mocks.isSwitching.current = false;
  vi.clearAllMocks();
});

describe("SidebarHeaderTrigger", () => {
  it("opens both panes in a popover on desktop", async () => {
    const user = userEvent.setup();
    render(<SidebarHeaderTrigger />);

    await user.click(
      screen.getByTestId("project-scope-combined-sidebar-trigger"),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(workspaceList()).toBeInTheDocument();
    expect(screen.getByText("project menu")).toBeInTheDocument();
    expect(projectPane()).not.toHaveAttribute("inert");
  });

  it("shuts the project pane while a workspace switch runs", async () => {
    mocks.isSwitching.current = true;
    const user = userEvent.setup();
    render(<SidebarHeaderTrigger />);

    await user.click(
      screen.getByTestId("project-scope-combined-sidebar-trigger"),
    );

    expect(
      await screen.findByTestId("project-scope-combined-project-pane"),
    ).toHaveAttribute("inert");
  });

  it("stays busy when the popover closes and reopens mid-switch", async () => {
    let finish = () => {};
    mocks.activate.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<SidebarHeaderTrigger />);
    const trigger = screen.getByTestId(
      "project-scope-combined-sidebar-trigger",
    );

    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "Globex" }));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(trigger);

    // The old workspace's projects would 404 once the switch lands.
    const pane = await screen.findByTestId(
      "project-scope-combined-project-pane",
    );
    expect(pane).toHaveAttribute("inert");
    expect(pane).toHaveAttribute("aria-busy", "true");
    for (const name of ["Acme", "Globex"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    await user.click(screen.getByRole("button", { name: "Globex" }));
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith("org-2");

    await act(async () => finish());
    await waitFor(() => expect(pane).not.toHaveAttribute("inert"));
  });

  it("closes the mobile sidebar and opens the bottom sheet", async () => {
    mocks.isMobile.current = true;
    const user = userEvent.setup();
    render(<SidebarHeaderTrigger />);
    const sheetOpen = renderHook(() => useCombinedSheetOpen());
    const trigger = screen.getByTestId(
      "project-scope-combined-sidebar-trigger",
    );
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(mocks.setOpenMobile).toHaveBeenCalledExactlyOnceWith(false);
    expect(sheetOpen.result.current).toBe(true);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // The popover stays shut: the header chip owns the sheet.
    expect(screen.queryByText("project menu")).not.toBeInTheDocument();
  });
});

describe("RailTrigger", () => {
  it("opens both panes from the collapsed rail", async () => {
    const user = userEvent.setup();
    render(<RailTrigger />);

    await user.click(screen.getByTestId("project-scope-combined-rail-trigger"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(workspaceList()).toBeInTheDocument();
    expect(screen.getByText("project menu")).toBeInTheDocument();
  });

  it("stays busy when the popover closes and reopens mid-switch", async () => {
    let finish = () => {};
    mocks.activate.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<RailTrigger />);
    const trigger = screen.getByTestId("project-scope-combined-rail-trigger");

    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "Globex" }));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(trigger);

    const pane = await screen.findByTestId(
      "project-scope-combined-project-pane",
    );
    expect(pane).toHaveAttribute("inert");
    expect(pane).toHaveAttribute("aria-busy", "true");
    for (const name of ["Acme", "Globex"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    await user.click(screen.getByRole("button", { name: "Globex" }));
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith("org-2");

    await act(async () => finish());
    await waitFor(() => expect(pane).not.toHaveAttribute("inert"));
  });

  it("renders nothing on mobile, where the sidebar is a sheet", () => {
    mocks.isMobile.current = true;
    const { container } = render(<RailTrigger />);

    expect(container).toBeEmptyDOMElement();
  });
});
