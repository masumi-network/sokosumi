import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getUsersByIdOrganizationsMock } = vi.hoisted(() => ({
  getUsersByIdOrganizationsMock: vi.fn(),
}));

vi.mock("@sokosumi/core-client", () => ({
  getUsersByIdOrganizations: (...args: unknown[]) =>
    getUsersByIdOrganizationsMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({}),
}));

import { useDriveOrganizationName } from "./use-drive-organization-name";

describe("useDriveOrganizationName", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns null without org or user, resolves matching organization name, and resets on error", async () => {
    getUsersByIdOrganizationsMock
      .mockResolvedValueOnce({
        data: {
          data: [
            { id: "org-1", name: "Acme" },
            { id: "org-2", name: "Beta" },
          ],
        },
      })
      .mockRejectedValueOnce(new Error("network"));

    const { result, rerender } = renderHook(
      ({ orgId, userId }) => useDriveOrganizationName(orgId, userId),
      {
        initialProps: {
          orgId: null as string | null,
          userId: "user-1" as string | undefined,
        },
      },
    );

    expect(result.current).toBeNull();
    expect(getUsersByIdOrganizationsMock).not.toHaveBeenCalled();

    rerender({ orgId: "org-2", userId: "user-1" });
    await waitFor(() => expect(result.current).toBe("Beta"));

    rerender({ orgId: "org-1", userId: "user-1" });
    await waitFor(() => expect(result.current).toBeNull());
  });
});
