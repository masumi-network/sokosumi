import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDriveItemsQueryKey,
  getDriveItemsQueryOptions,
  getDriveOrganizationNameQueryKey,
  getDriveOrganizationNameQueryOptions,
} from "@/queries/drive";

const listDriveItemsMock = vi.fn();
const getUsersByIdOrganizationsMock = vi.fn();

vi.mock("@/lib/utils/drive-file-list.client", () => ({
  listDriveItems: (...args: unknown[]) => listDriveItemsMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({ id: "browser-core-client" }),
}));

vi.mock("@sokosumi/core-client", () => ({
  getUsersByIdOrganizations: (...args: unknown[]) =>
    getUsersByIdOrganizationsMock(...args),
}));

describe("getDriveItemsQueryOptions", () => {
  beforeEach(() => {
    listDriveItemsMock.mockReset();
  });

  it("keys the list by store, folder, search, and sort", () => {
    const store = { scope: "org" as const, organizationId: "org_b" };

    expect(
      getDriveItemsQueryKey({
        store,
        folder: "Reports",
        search: "q",
      }),
    ).toEqual(["drive", "items", store, "Reports", "q", null, null]);

    expect(
      getDriveItemsQueryKey({
        store,
        folder: "Reports",
        search: "q",
        sortBy: "name",
        sortOrder: "asc",
      }),
    ).toEqual(["drive", "items", store, "Reports", "q", "name", "asc"]);
  });

  it("normalizes search whitespace in the query key", () => {
    const store = { scope: "org" as const, organizationId: "org_b" };

    expect(
      getDriveItemsQueryKey({
        store,
        folder: "Reports",
        search: "  budget  ",
      }),
    ).toEqual(
      getDriveItemsQueryKey({
        store,
        folder: "Reports",
        search: "budget",
      }),
    );
  });

  it("lists the store folder with the search query", async () => {
    const items = [{ type: "folder", name: "Reports" }];
    listDriveItemsMock.mockResolvedValue(items);
    const store = { scope: "org" as const, organizationId: "org_b" };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const options = getDriveItemsQueryOptions({
      store,
      folder: "Reports",
      search: "  budget  ",
    });

    await expect(queryClient.fetchQuery(options)).resolves.toEqual(items);
    expect(listDriveItemsMock).toHaveBeenCalledWith({
      ...store,
      folder: "Reports",
      q: "budget",
      signal: expect.any(AbortSignal),
    });
    expect(options.refetchOnWindowFocus).toBe(false);
  });
});

describe("getDriveOrganizationNameQueryOptions", () => {
  beforeEach(() => {
    getUsersByIdOrganizationsMock.mockReset();
  });

  it("resolves the active organization name from the user's organizations", async () => {
    getUsersByIdOrganizationsMock.mockResolvedValue({
      data: {
        data: [
          { id: "org_a", name: "Org A" },
          { id: "org_b", name: "Org B" },
        ],
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const options = getDriveOrganizationNameQueryOptions({
      userId: "user_1",
      activeOrganizationId: "org_b",
    });

    expect(options.queryKey).toEqual(
      getDriveOrganizationNameQueryKey({
        userId: "user_1",
        activeOrganizationId: "org_b",
      }),
    );
    expect(options.enabled).toBe(true);
    await expect(queryClient.fetchQuery(options)).resolves.toBe("Org B");
  });

  it("disables the query when userId or activeOrganizationId is missing", () => {
    expect(
      getDriveOrganizationNameQueryOptions({
        userId: "user_1",
        activeOrganizationId: null,
      }).enabled,
    ).toBe(false);
    expect(
      getDriveOrganizationNameQueryOptions({
        userId: null,
        activeOrganizationId: "org_a",
      }).enabled,
    ).toBe(false);
  });

  it("throws on error responses instead of caching null", async () => {
    getUsersByIdOrganizationsMock.mockResolvedValue({
      error: new Error("upstream unavailable"),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const options = getDriveOrganizationNameQueryOptions({
      userId: "user_1",
      activeOrganizationId: "org_b",
    });

    await expect(queryClient.fetchQuery(options)).rejects.toThrow(
      "upstream unavailable",
    );
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
  });
});
