import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { updatePreferredOrganization } from "@/lib/actions/organization";
import { authClient } from "@/lib/auth/auth.client";

const replaceMock = vi.fn();
const refreshMock = vi.fn();
let pathnameMock = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock,
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      setActive: vi.fn(),
    },
  },
}));

vi.mock("@/lib/actions/organization", () => ({
  updatePreferredOrganization: vi.fn(),
}));

describe("AutoContextSwitch", () => {
  beforeEach(() => {
    pathnameMock = "/";
    replaceMock.mockClear();
    refreshMock.mockClear();
    vi.mocked(authClient.organization.setActive).mockReset();
    vi.mocked(updatePreferredOrganization).mockReset();
  });

  it("switches workspace once when active context is mismatched", async () => {
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      value: {
        organizationId: "org-1",
      },
    });

    render(
      <AutoContextSwitch
        activeOrganizationId={null}
        targetOrganizationId="org-1"
        successMessage="Switched to Org One account"
      />,
    );

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(updatePreferredOrganization).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(replaceMock).not.toHaveBeenCalled();
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("does not switch when context is already aligned", () => {
    render(
      <AutoContextSwitch
        activeOrganizationId="org-1"
        targetOrganizationId="org-1"
        successMessage="Switched to Org One account"
      />,
    );

    expect(authClient.organization.setActive).not.toHaveBeenCalled();
    expect(updatePreferredOrganization).not.toHaveBeenCalled();
  });

  it("does not switch when a later profile switch creates a mismatch", () => {
    const view = render(
      <AutoContextSwitch
        activeOrganizationId="org-1"
        targetOrganizationId="org-1"
        successMessage="Switched to Org One account"
      />,
    );

    view.rerender(
      <AutoContextSwitch
        activeOrganizationId="org-2"
        targetOrganizationId="org-1"
        successMessage="Switched to Org One account"
      />,
    );

    expect(authClient.organization.setActive).not.toHaveBeenCalled();
    expect(updatePreferredOrganization).not.toHaveBeenCalled();
  });

  it("does not re-trigger on rerender after first switch", async () => {
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      value: {
        organizationId: "org-1",
      },
    });

    const view = render(
      <AutoContextSwitch
        activeOrganizationId={null}
        targetOrganizationId="org-1"
        successMessage="Switched to Org One account"
      />,
    );

    view.rerender(
      <AutoContextSwitch
        activeOrganizationId={null}
        targetOrganizationId="org-1"
        successMessage="Switched to Org One account"
      />,
    );

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledTimes(1);
      expect(updatePreferredOrganization).toHaveBeenCalledTimes(1);
    });
  });
});
