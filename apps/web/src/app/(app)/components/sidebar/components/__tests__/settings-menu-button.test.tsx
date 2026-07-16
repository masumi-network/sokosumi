import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openSubmenuMock = vi.fn();
const setOpenMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/agents",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuButton: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  useSidebar: () => ({
    state: "collapsed",
    setOpen: setOpenMock,
  }),
}));

vi.mock("@/app/components/sidebar/components/sidebar-submenu", () => ({
  SIDEBAR_SUBMENU_SLIDE_DURATION_MS: 200,
  useSidebarSubmenu: () => ({
    openSubmenu: openSubmenuMock,
  }),
}));

import SettingsMenuButton from "@/app/components/sidebar/components/settings-menu-button.client";

describe("SettingsMenuButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for sidebar expansion before opening settings from collapsed state", () => {
    render(<SettingsMenuButton />);

    fireEvent.click(screen.getByRole("button", { name: "settings" }));

    expect(setOpenMock).toHaveBeenCalledWith(true);
    expect(openSubmenuMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(openSubmenuMock).toHaveBeenCalledWith("settings");
  });
});
