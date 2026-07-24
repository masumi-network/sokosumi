import type { SessionUser } from "@sokosumi/utils";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser: SessionUser = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  image: null,
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  termsAccepted: true,
  marketingOptIn: false,
  onboardingCompleted: true,
};

const goBackMock = vi.fn();
const openSubmenuMock = vi.fn();
const pushMock = vi.fn();
const setOpenMobileMock = vi.fn();
const showLogoutModalMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/modals/global-modals-context", () => ({
  useGlobalModalsContext: () => ({
    showLogoutModal: showLogoutModalMock,
  }),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
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
    isMobile: true,
    setOpenMobile: setOpenMobileMock,
  }),
}));

vi.mock("@/app/components/sidebar/components/sidebar-submenu", () => ({
  useSidebarSubmenu: () => ({
    goBack: goBackMock,
    openSubmenu: openSubmenuMock,
  }),
}));

import {
  SettingsPanelHeader,
  SettingsSubmenuContent,
} from "@/app/components/sidebar/components/settings-submenu-content";

describe("SettingsPanelHeader", () => {
  it("truncates long labels within the panel header", () => {
    const longLabel =
      "Enterprise (Very Long Organization Name That Should Not Overflow)";

    render(<SettingsPanelHeader planLabel={longLabel} />);

    const label = screen.getByText(longLabel);
    expect(label).toHaveClass("truncate");
    expect(label).toHaveClass("min-w-0");
    expect(label).toHaveAttribute("title", longLabel);
  });
});

describe("SettingsSubmenuContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates without closing the submenu", () => {
    render(
      <SettingsSubmenuContent
        sessionUser={sessionUser}
        members={[]}
        activeOrganizationId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "account" }));

    expect(goBackMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/account");
    expect(setOpenMobileMock).toHaveBeenCalledWith(false);
  });

  it("closes the submenu when logging out", () => {
    render(
      <SettingsSubmenuContent
        sessionUser={sessionUser}
        members={[]}
        activeOrganizationId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "logout" }));

    expect(goBackMock).toHaveBeenCalled();
    expect(setOpenMobileMock).toHaveBeenCalledWith(false);
    expect(showLogoutModalMock).toHaveBeenCalledWith("user@example.com");
  });

  it("opens the developer submenu instead of navigating", () => {
    render(
      <SettingsSubmenuContent
        sessionUser={sessionUser}
        members={[]}
        activeOrganizationId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "developer" }));

    expect(openSubmenuMock).toHaveBeenCalledWith("developer");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
