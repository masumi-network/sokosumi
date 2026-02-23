import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";

import { AutoContextSwitch } from "@/app/components/auto-context-switch";
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

describe("AutoContextSwitch", () => {
  beforeEach(() => {
    pathnameMock = "/";
    replaceMock.mockClear();
    refreshMock.mockClear();
    jest.mocked(authClient.organization.setActive).mockReset();
  });

  it("switches workspace once when active context is mismatched", async () => {
    jest.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
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
  });

  it("does not re-trigger on rerender after first switch", async () => {
    jest.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
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
    });
  });
});
