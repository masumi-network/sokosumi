import type { UserWorkspace } from "@sokosumi/core-client";
import type { SessionUser } from "@sokosumi/utils";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HeaderProfileSectionClient from "@/app/components/header/header-profile-section.client";

const useSessionMock = vi.fn();
const headerWorkspaceSwitchMock = vi.fn();
const useWorkspaceSwitcherMock = vi.fn();

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: (...args: unknown[]) => useSessionMock(...args),
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: (...args: unknown[]) =>
    useWorkspaceSwitcherMock(...args),
}));

vi.mock("@/app/components/header/header-workspace-switch.client", () => ({
  default: (props: unknown) => {
    headerWorkspaceSwitchMock(props);
    return <div data-testid="header-workspace-switch-mock" />;
  },
}));

const sessionUser: SessionUser = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  emailVerified: true,
  image: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  termsAccepted: true,
  marketingOptIn: false,
};

const workspaces: UserWorkspace[] = [
  {
    id: "ws-a",
    kind: "organization",
    name: "Org A",
    organizationId: "org-a",
    slug: "org-a",
    logo: null,
    websiteUrl: null,
    preferred: false,
  },
  {
    id: "ws-b",
    kind: "organization",
    name: "Org B",
    organizationId: "org-b",
    slug: "org-b",
    logo: null,
    websiteUrl: null,
    preferred: false,
  },
];

async function renderProfileSection(props: {
  sessionUser: SessionUser;
  workspaces: UserWorkspace[];
  hasPersonalWorkspace?: boolean;
  activeOrganizationId: string | null;
}) {
  await act(async () => {
    render(
      <HeaderProfileSectionClient
        {...props}
        hasPersonalWorkspace={props.hasPersonalWorkspace ?? true}
      />,
    );
  });
}

describe("HeaderProfileSectionClient", () => {
  beforeEach(() => {
    useWorkspaceSwitcherMock.mockReturnValue({
      isPending: false,
      handleSelectWorkspace: vi.fn(),
    });
    headerWorkspaceSwitchMock.mockClear();
  });

  it("shows Workspace switch on mobile and desktop", async () => {
    useSessionMock.mockReturnValue({
      data: {
        session: {
          activeOrganizationId: "org-a",
        },
      },
    });

    await renderProfileSection({
      sessionUser,
      workspaces,
      activeOrganizationId: "org-a",
    });

    const chrome = screen.getByTestId("header-workspace-chrome");
    expect(chrome.className).toContain("flex");
    expect(chrome.className).not.toContain("hidden");
    expect(chrome.className).not.toContain("md:flex");
    expect(screen.getByTestId("header-workspace-switch-mock")).toBeTruthy();
  });

  it("prefers the client session active organization when it matches the server", async () => {
    useSessionMock.mockReturnValue({
      data: {
        session: {
          activeOrganizationId: "org-b",
        },
      },
    });

    await renderProfileSection({
      sessionUser,
      workspaces,
      activeOrganizationId: "org-b",
    });

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-b",
      }),
    );
  });

  it("prefers the client session active organization when client and server differ", async () => {
    useSessionMock.mockReturnValue({
      data: {
        session: {
          activeOrganizationId: "org-b",
        },
      },
    });

    await renderProfileSection({
      sessionUser,
      workspaces,
      activeOrganizationId: "org-a",
    });

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-b",
        isPending: false,
      }),
    );
  });

  it("falls back to the server active organization when client session is unavailable", async () => {
    useSessionMock.mockReturnValue({
      data: null,
    });

    await renderProfileSection({
      sessionUser,
      workspaces,
      activeOrganizationId: "org-a",
    });

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-a",
      }),
    );
  });

  it("shows personal account from client session when active organization is null", async () => {
    useSessionMock.mockReturnValue({
      data: {
        session: {
          activeOrganizationId: null,
        },
      },
    });

    await renderProfileSection({
      sessionUser,
      workspaces,
      activeOrganizationId: "org-a",
    });

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: null,
        isPending: false,
      }),
    );
  });

  it("keeps the server active organization visible while a switch is pending", async () => {
    useSessionMock.mockReturnValue({
      data: {
        session: {
          activeOrganizationId: "org-b",
        },
      },
    });
    useWorkspaceSwitcherMock.mockReturnValue({
      isPending: true,
      handleSelectWorkspace: vi.fn(),
    });

    await renderProfileSection({
      sessionUser,
      workspaces,
      activeOrganizationId: "org-a",
    });

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-a",
        isPending: true,
      }),
    );
  });
});
