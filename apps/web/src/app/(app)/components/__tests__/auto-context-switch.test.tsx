import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";

import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { updatePreferredOrganization } from "@/lib/actions/organization";
import { authClient } from "@/lib/auth/auth.client";

const replaceMock = jest.fn();
const refreshMock = jest.fn();
let pathnameMock = "/";

jest.mock("next/navigation", () => ({
  usePathname: () => pathnameMock,
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
}));

jest.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      setActive: jest.fn(),
    },
  },
}));

jest.mock("@/lib/actions/organization", () => ({
  updatePreferredOrganization: jest.fn(),
}));

describe("AutoContextSwitch", () => {
  beforeEach(() => {
    pathnameMock = "/";
    replaceMock.mockClear();
    refreshMock.mockClear();
    jest.mocked(authClient.organization.setActive).mockReset();
    jest.mocked(updatePreferredOrganization).mockReset();
  });

  it("switches workspace once when active context is mismatched", async () => {
    jest.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    jest.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      data: {
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

  it("does not re-trigger on rerender after first switch", async () => {
    jest.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    jest.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      data: {
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
