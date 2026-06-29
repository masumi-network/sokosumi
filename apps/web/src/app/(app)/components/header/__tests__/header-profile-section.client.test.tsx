import type { SessionUser } from "@sokosumi/utils";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HeaderProfileSectionClient from "@/app/components/header/header-profile-section.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";

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
    return null;
  },
}));

vi.mock("@/app/components/header/header-notification-avatar.client", () => ({
  HeaderNotificationAvatar: () => null,
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
  onboardingCompleted: true,
};

const members: MemberWithOrganization[] = [
  {
    id: "member-1",
    organizationId: "org-a",
    userId: "user-1",
    role: "member",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    seatAssignedAt: null,
    organization: {
      id: "org-a",
      name: "Org A",
      slug: "org-a",
      logo: null,
      metadata: null,
      stripeCustomerId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  },
  {
    id: "member-2",
    organizationId: "org-b",
    userId: "user-1",
    role: "member",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    seatAssignedAt: null,
    organization: {
      id: "org-b",
      name: "Org B",
      slug: "org-b",
      logo: null,
      metadata: null,
      stripeCustomerId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  },
];

describe("HeaderProfileSectionClient", () => {
  beforeEach(() => {
    useWorkspaceSwitcherMock.mockReturnValue({
      isPending: false,
      handleSelectWorkspace: vi.fn(),
    });
  });

  it("prefers the client session active organization when it matches the server", () => {
    useSessionMock.mockReturnValue({
      data: {
        session: {
          activeOrganizationId: "org-b",
        },
      },
    });

    render(
      <HeaderProfileSectionClient
        sessionUser={sessionUser}
        members={members}
        activeOrganizationId="org-b"
      />,
    );

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-b",
      }),
    );
  });

  it("keeps the server active organization visible while client and server are out of sync", () => {
    useSessionMock.mockReturnValue({
      data: {
        session: {
          activeOrganizationId: "org-b",
        },
      },
    });

    render(
      <HeaderProfileSectionClient
        sessionUser={sessionUser}
        members={members}
        activeOrganizationId="org-a"
      />,
    );

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-a",
        isPending: true,
      }),
    );
  });

  it("falls back to the server active organization when client session is unavailable", () => {
    useSessionMock.mockReturnValue({
      data: null,
    });

    render(
      <HeaderProfileSectionClient
        sessionUser={sessionUser}
        members={members}
        activeOrganizationId="org-a"
      />,
    );

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-a",
      }),
    );
  });

  it("keeps the server active organization visible while switching to personal account", () => {
    useSessionMock.mockReturnValue({
      data: {
        session: {
          activeOrganizationId: null,
        },
      },
    });

    render(
      <HeaderProfileSectionClient
        sessionUser={sessionUser}
        members={members}
        activeOrganizationId="org-a"
      />,
    );

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-a",
        isPending: true,
      }),
    );
  });

  it("keeps the server active organization visible while a switch is pending", () => {
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

    render(
      <HeaderProfileSectionClient
        sessionUser={sessionUser}
        members={members}
        activeOrganizationId="org-a"
      />,
    );

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-a",
        isPending: true,
      }),
    );
  });
});
