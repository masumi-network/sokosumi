import { MemberRole, type MemberWithOrganization } from "@sokosumi/database";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProfileSwitchClient from "@/app/components/sidebar/components/profile-switch.client";
import type { SessionUser } from "@/lib/auth/auth";

const pushMock = vi.fn();
const showCreateOrganizationModalMock = vi.fn();
const handleSelectWorkspaceMock = vi.fn();

const translations: Record<string, string> = {
  "Components.UserAvatar.settings": "Settings",
  "Components.UserAvatar.account": "Account",
  "Components.UserAvatar.billing": "Billing",
  "Components.UserAvatar.connections": "Connections",
  "Components.UserAvatar.logout": "Log out",
  "Components.UserAvatar.help": "Help",
  "Components.UserAvatar.legal": "Legal",
  "Components.UserAvatar.documentation": "Documentation",
  "Components.UserAvatar.support": "Support",
  "Components.UserAvatar.termsOfService": "Terms of Service",
  "Components.UserAvatar.privacyPolicy": "Privacy Policy",
  "Components.UserAvatar.imprint": "Imprint",
  "Components.UserAvatar.acceptableUse": "Acceptable Use",
  "Components.UserAvatar.serviceplanAiCoworker": "Serviceplan AI Coworker",
  "Components.UserAvatar.expandSidebar": "Expand sidebar",
  "Components.OrganizationSwitcher.switchWorkspace": "Switch workspace",
  "Components.OrganizationSwitcher.addOrganization": "Add organization",
  "Components.OrganizationSwitcher.organizationsHeading": "Organizations",
  "Components.OrganizationSwitcher.personalAccount": "Personal account",
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    translations[namespace ? `${namespace}.${key}` : key] ??
    (namespace ? `${namespace}.${key}` : key),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuButton: ({
    children,
    ...props
  }: {
    children: ReactNode;
    "aria-label"?: string;
    onClick?: () => void;
  }) => (
    <button
      type="button"
      aria-label={props["aria-label"]}
      onClick={props.onClick}
    >
      {children}
    </button>
  ),
  useSidebar: () => ({
    isMobile: false,
    state: "expanded",
    toggleSidebar: vi.fn(),
  }),
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    isPending: false,
    handleSelectWorkspace: handleSelectWorkspaceMock,
  }),
}));

vi.mock("@/hooks/use-modal", () => ({
  default: () => ({
    Component: null,
    showModal: showCreateOrganizationModalMock,
  }),
}));

vi.mock("@/components/modals/global-modals-context", () => ({
  useGlobalModalsContext: () => ({
    showLogoutModal: vi.fn(),
  }),
}));

vi.mock("@/app/components/user-avatar/user-avatar-content", () => ({
  default: () => <div data-testid="user-avatar-content" />,
}));

vi.mock("@/components/organizations", () => ({
  OrganizationInformationModal: () => null,
  OrganizationLogo: () => <div data-testid="organization-logo" />,
}));

vi.mock("@/components/ui/dropdown-menu", () => {
  interface DropdownMenuContextValue {
    open: boolean;
    setOpen: (open: boolean) => void;
  }

  interface DropdownMenuSubContextValue {
    open: boolean;
    setOpen: (open: boolean) => void;
  }

  const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(
    null,
  );
  const DropdownMenuSubContext =
    createContext<DropdownMenuSubContextValue | null>(null);

  function DropdownMenu({
    children,
    open: openProp,
    onOpenChange,
  }: {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const open = openProp ?? uncontrolledOpen;

    const setOpen = (nextOpen: boolean) => {
      if (typeof openProp === "undefined") {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    };

    return (
      <DropdownMenuContext.Provider value={{ open, setOpen }}>
        <div>{children}</div>
      </DropdownMenuContext.Provider>
    );
  }

  function DropdownMenuTrigger({
    children,
    asChild,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) {
    const context = useContext(DropdownMenuContext);
    if (!context) return null;

    const handleClick = () => {
      context.setOpen(!context.open);
    };

    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<{ onClick?: () => void }>, {
        onClick: handleClick,
      });
    }

    return (
      <button type="button" onClick={handleClick}>
        {children}
      </button>
    );
  }

  function DropdownMenuContent({ children }: { children: ReactNode }) {
    const context = useContext(DropdownMenuContext);

    if (!context?.open) {
      return null;
    }

    return <div>{children}</div>;
  }

  function DropdownMenuItem({
    children,
    onClick,
    onSelect,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    onSelect?: (event: { preventDefault: () => void }) => void;
    disabled?: boolean;
  }) {
    const context = useContext(DropdownMenuContext);

    const handleClick = () => {
      if (!context || disabled) return;

      let defaultPrevented = false;
      onSelect?.({
        preventDefault: () => {
          defaultPrevented = true;
        },
      });

      if (!defaultPrevented) {
        onClick?.();
        context.setOpen(false);
      }
    };

    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={handleClick}
      >
        {children}
      </button>
    );
  }

  function DropdownMenuSeparator() {
    return <div role="separator" />;
  }

  function DropdownMenuGroup({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  }

  function DropdownMenuLabel({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  }

  function DropdownMenuSub({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);

    return (
      <DropdownMenuSubContext.Provider value={{ open, setOpen }}>
        <div>{children}</div>
      </DropdownMenuSubContext.Provider>
    );
  }

  function DropdownMenuSubTrigger({
    children,
    disabled,
  }: {
    children: ReactNode;
    disabled?: boolean;
  }) {
    const context = useContext(DropdownMenuSubContext);

    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={() => context?.setOpen(!context.open)}
      >
        {children}
      </button>
    );
  }

  function DropdownMenuSubContent({ children }: { children: ReactNode }) {
    const context = useContext(DropdownMenuSubContext);

    if (!context?.open) {
      return null;
    }

    return <div>{children}</div>;
  }

  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
  };
});

const sessionUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Test User",
  image: null,
} as SessionUser;

function createMember(
  overrides: Partial<MemberWithOrganization> = {},
): MemberWithOrganization {
  return {
    id: "member-1",
    organizationId: "org-1",
    userId: "user-1",
    role: MemberRole.OWNER,
    createdAt: new Date(),
    organization: {
      id: "org-1",
      name: "Acme Corp",
      slug: "acme-corp",
      logo: null,
      metadata: null,
      stripeCustomerId: null,
      createdAt: new Date(),
    },
    ...overrides,
  } as MemberWithOrganization;
}

async function openProfileMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Settings" }));
}

describe("ProfileSwitchClient", () => {
  beforeEach(() => {
    pushMock.mockReset();
    showCreateOrganizationModalMock.mockReset();
    handleSelectWorkspaceMock.mockReset();
  });

  it("hides the organization menu item in personal workspace", async () => {
    const user = userEvent.setup();

    render(
      <ProfileSwitchClient
        adminMenuEnabled={false}
        sessionUser={sessionUser}
        members={[createMember()]}
        activeOrganizationId={null}
      />,
    );

    await openProfileMenu(user);

    expect(
      screen.queryByRole("menuitem", { name: "Organizations" }),
    ).not.toBeInTheDocument();
  });

  it("links the organization menu item to the active organization slug", async () => {
    const user = userEvent.setup();

    render(
      <ProfileSwitchClient
        adminMenuEnabled={false}
        sessionUser={sessionUser}
        members={[createMember()]}
        activeOrganizationId="org-1"
      />,
    );

    await openProfileMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Organizations" }));

    expect(pushMock).toHaveBeenCalledWith("/organizations/acme-corp");
  });

  it("separates personal and organization workspaces in the switcher", async () => {
    const user = userEvent.setup();

    render(
      <ProfileSwitchClient
        adminMenuEnabled={false}
        sessionUser={sessionUser}
        members={[
          createMember(),
          createMember({
            id: "member-2",
            organizationId: "org-2",
            organization: {
              id: "org-2",
              name: "Beta Inc",
              slug: "beta-inc",
              logo: null,
              metadata: null,
              stripeCustomerId: null,
              createdAt: new Date(),
            },
          }),
        ]}
        activeOrganizationId="org-1"
      />,
    );

    await openProfileMenu(user);
    await user.click(
      screen.getByRole("menuitem", { name: "Switch workspace" }),
    );

    const personalItem = screen.getByRole("menuitem", { name: /Test User/i });
    const acmeItem = screen.getByRole("menuitem", { name: /Acme Corp/i });
    const betaItem = screen.getByRole("menuitem", { name: /Beta Inc/i });
    const organizationsHeading = screen.getAllByText("Organizations")[0];

    expect(personalItem.compareDocumentPosition(acmeItem)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(organizationsHeading.compareDocumentPosition(acmeItem)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(acmeItem.compareDocumentPosition(betaItem)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getAllByRole("separator").length).toBeGreaterThanOrEqual(2);
  });

  it("opens the create organization modal from add organization", async () => {
    const user = userEvent.setup();

    render(
      <ProfileSwitchClient
        adminMenuEnabled={false}
        sessionUser={sessionUser}
        members={[createMember()]}
        activeOrganizationId={null}
      />,
    );

    await openProfileMenu(user);
    await user.click(
      screen.getByRole("menuitem", { name: "Switch workspace" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Add organization" }),
    );

    expect(showCreateOrganizationModalMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalledWith("/organizations");
  });
});
