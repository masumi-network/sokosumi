import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const redirectMock = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
const getActiveOrganizationIdMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();
const organizationSettingsContentMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/lib/services", () => ({
  userService: {
    getActiveOrganizationId: (...args: unknown[]) =>
      getActiveOrganizationIdMock(...args),
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
  },
}));

vi.mock("@/app/organization/components/organization-settings-content", () => ({
  OrganizationSettingsContent: (props: { organization: unknown }) => {
    organizationSettingsContentMock(props);
    return null;
  },
}));

import { render } from "@testing-library/react";

import OrganizationPage from "./page";

describe("/organization page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects home when there is no active organization membership", async () => {
    getActiveOrganizationIdMock.mockResolvedValueOnce(null);
    getMyMembersWithOrganizationsMock.mockResolvedValueOnce([]);

    await expect(OrganizationPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(redirectMock).toHaveBeenCalledWith("/");
    expect(organizationSettingsContentMock).not.toHaveBeenCalled();
  });

  it("renders settings for the active organization membership", async () => {
    const organization = {
      id: "org-1",
      name: "Utxo",
      slug: "utxo",
      logo: null,
      metadata: null,
      createdAt: new Date("2024-01-01"),
      stripeCustomerId: null,
    };

    getActiveOrganizationIdMock.mockResolvedValueOnce("org-1");
    getMyMembersWithOrganizationsMock.mockResolvedValueOnce([
      {
        id: "member-1",
        userId: "user-1",
        organizationId: "org-1",
        role: "owner",
        seatAssignedAt: null,
        createdAt: new Date("2024-01-01"),
        organization,
      },
    ]);

    render(await OrganizationPage());

    expect(redirectMock).not.toHaveBeenCalled();
    expect(organizationSettingsContentMock).toHaveBeenCalledWith({
      organization,
    });
  });
});
