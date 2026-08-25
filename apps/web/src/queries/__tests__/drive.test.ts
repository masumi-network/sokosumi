import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDriveItemsQueryKey,
  getDriveItemsQueryOptions,
} from "@/queries/drive";

const listDriveItemsMock = vi.fn();

vi.mock("@/lib/utils/drive-file-list.client", () => ({
  listDriveItems: (...args: unknown[]) => listDriveItemsMock(...args),
}));

describe("getDriveItemsQueryOptions", () => {
  beforeEach(() => {
    listDriveItemsMock.mockReset();
  });

  it("keys the list by store, folder, and search", () => {
    const store = { scope: "org" as const, organizationId: "org_b" };

    expect(
      getDriveItemsQueryKey({
        store,
        folder: "Reports",
        search: "q",
      }),
    ).toEqual(["drive", "items", store, "Reports", "q"]);
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
