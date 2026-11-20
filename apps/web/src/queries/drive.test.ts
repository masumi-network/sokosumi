import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDriveOrganizationName,
  getDriveItemsQueryKey,
  getDriveItemsQueryOptions,
  getDriveStoreScope,
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

describe("getDriveStoreScope", () => {
  it("matches personal and organization store scopes with the viewer id", () => {
    expect(getDriveStoreScope({ scope: "me" }, "user_1")).toEqual([
      "me",
      null,
      "user_1",
    ]);
    expect(
      getDriveStoreScope({ scope: "org", organizationId: "org_b" }, "user_1"),
    ).toEqual(["org", "org_b", "user_1"]);
  });
});

describe("fetchDriveOrganizationName", () => {
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

    await expect(
      fetchDriveOrganizationName({
        userId: "user_1",
        activeOrganizationId: "org_b",
      }),
    ).resolves.toBe("Org B");
  });

  it("returns null without fetching when userId or activeOrganizationId is missing", async () => {
    await expect(
      fetchDriveOrganizationName({
        userId: "user_1",
        activeOrganizationId: null,
      }),
    ).resolves.toBeNull();
    await expect(
      fetchDriveOrganizationName({
        userId: null,
        activeOrganizationId: "org_a",
      }),
    ).resolves.toBeNull();
    expect(getUsersByIdOrganizationsMock).not.toHaveBeenCalled();
  });

  it("throws on error responses instead of resolving null", async () => {
    getUsersByIdOrganizationsMock.mockResolvedValue({
      error: new Error("upstream unavailable"),
    });

    await expect(
      fetchDriveOrganizationName({
        userId: "user_1",
        activeOrganizationId: "org_b",
      }),
    ).rejects.toThrow("upstream unavailable");
  });
});
