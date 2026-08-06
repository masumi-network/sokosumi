import type { SessionUser } from "@sokosumi/utils";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HeaderProfileSectionClient, {
  type HeaderAccountSummary,
} from "@/app/components/header/header-profile-section.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";

const useSessionMock = vi.fn();
const headerWorkspaceSwitchMock = vi.fn();
const useWorkspaceSwitcherMock = vi.fn();
const headerAccountControlMock = vi.fn();

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

vi.mock("@/app/components/header/header-notification-bell.client", () => ({
  HeaderNotificationBell: () => null,
}));

vi.mock("@/app/components/header/header-account-control.client", () => ({
  HeaderAccountControl: (props: unknown) => {
    headerAccountControlMock(props);
    return null;
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

const accountSummary: HeaderAccountSummary = {
  planName: "Pro",
  totalCredits: 1000,
  extraCredits: 0,
  creditUsage: null,
  subscriptionPeriodEndMs: null,
  currentTimestampMs: 1_700_000_000_000,
  lowCreditsThreshold: 100,
  buyCreditsLabel: "getMoreCredits",
  buyCreditsPath: "/billing?tab=credits",
  adminMenuEnabled: true,
  showDeveloperVendors: false,
};

async function renderProfileSection(props: {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  accountSummaryPromise?: Promise<HeaderAccountSummary>;
}) {
  const { accountSummaryPromise, ...rest } = props;
  await act(async () => {
    render(
      <HeaderProfileSectionClient
        {...rest}
        accountSummaryPromise={
          accountSummaryPromise ?? Promise.resolve(accountSummary)
        }
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
    headerAccountControlMock.mockClear();
    headerWorkspaceSwitchMock.mockClear();
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
      members,
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
      members,
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
      members,
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
      members,
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
      members,
      activeOrganizationId: "org-a",
    });

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-a",
        isPending: true,
      }),
    );
  });

  it("mounts the mobile account control after the bell with admin settings", async () => {
    useSessionMock.mockReturnValue({
      data: {
        session: {
          activeOrganizationId: "org-a",
        },
      },
    });

    await renderProfileSection({
      sessionUser,
      members,
      activeOrganizationId: "org-a",
    });

    expect(headerAccountControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        className: "ml-0.5 md:hidden",
        planName: "Pro",
        mobileAdminSettings: expect.objectContaining({
          adminMenuEnabled: true,
          activeOrganizationId: "org-a",
          members,
        }),
      }),
    );
  });

  it("shows workspace switch while account summary is still pending", async () => {
    useSessionMock.mockReturnValue({
      data: {
        session: {
          activeOrganizationId: "org-a",
        },
      },
    });

    await act(async () => {
      render(
        <HeaderProfileSectionClient
          sessionUser={sessionUser}
          members={members}
          activeOrganizationId="org-a"
          accountSummaryPromise={new Promise<HeaderAccountSummary>(() => {})}
        />,
      );
    });

    expect(headerWorkspaceSwitchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOrganizationId: "org-a",
      }),
    );
    expect(headerAccountControlMock).not.toHaveBeenCalled();
  });
});
