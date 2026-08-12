import type { SessionUser } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";

import HeaderWorkspaceSwitch from "../header-workspace-switch.client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-modal", () => ({
  default: () => ({
    Component: null,
    showModal: vi.fn(),
  }),
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

const orgMember: MemberWithOrganization = {
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
};

describe("HeaderWorkspaceSwitch last-known members", () => {
  it("skeletons the chip when active org is missing from cached members", () => {
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[]}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

    expect(screen.queryByText("Test User")).not.toBeInTheDocument();
    expect(screen.queryByText("Org A")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("workspace-switcher-skeleton"),
    ).toBeInTheDocument();
  });

  it("shows personal workspace from session when no org is active", () => {
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[]}
        activeOrganizationId={null}
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-switcher-skeleton"),
    ).not.toBeInTheDocument();
  });

  it("shows the matching last-known org when members include it", () => {
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByText("Org A")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-switcher-skeleton"),
    ).not.toBeInTheDocument();
  });
});
