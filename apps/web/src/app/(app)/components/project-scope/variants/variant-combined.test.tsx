import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isMobile: { current: false },
  setOpenMobile: vi.fn(),
  isSwitching: { current: false },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
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
vi.mock("./variant-combined-parts", () => ({
  useCombinedScope: () => ({
    projectId: null,
    name: "All projects",
    mark: null,
    select: vi.fn(),
    openCreate: vi.fn(),
    createDialog: null,
  }),
  useCombinedWorkspaces: () => ({ isSwitching: mocks.isSwitching.current }),
  SwitchingPane: ({
    isSwitching,
    children,
  }: {
    isSwitching: boolean;
    children: ReactNode;
  }) => (
    <div data-testid="project-pane" inert={isSwitching}>
      {children}
    </div>
  ),
  WorkspaceList: () => <p>workspace list</p>,
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
    expect(screen.getByText("workspace list")).toBeInTheDocument();
    expect(screen.getByText("project menu")).toBeInTheDocument();
    expect(screen.getByTestId("project-pane")).not.toHaveAttribute("inert");
  });

  it("shuts the project pane while a workspace switch runs", async () => {
    mocks.isSwitching.current = true;
    const user = userEvent.setup();
    render(<SidebarHeaderTrigger />);

    await user.click(
      screen.getByTestId("project-scope-combined-sidebar-trigger"),
    );

    expect(await screen.findByTestId("project-pane")).toHaveAttribute("inert");
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
    expect(screen.getByText("workspace list")).toBeInTheDocument();
    expect(screen.getByText("project menu")).toBeInTheDocument();
  });

  it("renders nothing on mobile, where the sidebar is a sheet", () => {
    mocks.isMobile.current = true;
    const { container } = render(<RailTrigger />);

    expect(container).toBeEmptyDOMElement();
  });
});
