import { type InfiniteData, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { EMPTY_FILE_FILTERS } from "@/lib/utils/file-search.client";
import {
  driveQueryKeys,
  invalidateDrive,
  normalizeDriveStore,
  splitDriveQueryKey,
} from "@/queries/drive";
import { buildScopedQueryKey } from "@/queries/scoped-queries";

const orgA = { scope: "org" as const, organizationId: "org_a" };
const orgB = { scope: "org" as const, organizationId: "org_b" };
const personal = { scope: "me" as const };

interface TestFileRow {
  id: string;
  pathname: string;
  displayName: string;
}

function fileRow(id: string, pathname: string): TestFileRow {
  return { id, pathname, displayName: `${id}.pdf` };
}

describe("driveQueryKeys", () => {
  it("normalizes personal and org stores and shares one prefix per store", () => {
    expect(
      normalizeDriveStore({ scope: "me", organizationId: undefined }),
    ).toEqual(personal);
    expect(
      driveQueryKeys.dataRooms({ scope: "me", organizationId: undefined }),
    ).toEqual(driveQueryKeys.dataRooms(personal));

    expect(driveQueryKeys.prefix(orgA)).toEqual([orgA, "drive"]);
    const catalogParams = {
      query: "invoice",
      filters: EMPTY_FILE_FILTERS,
      directOnly: false,
      sortBy: "relevance" as const,
      sortOrder: "desc" as const,
    };
    expect(driveQueryKeys.catalog(orgA, catalogParams)).toEqual([
      orgA,
      "drive",
      "catalog",
      catalogParams,
    ]);
    expect(driveQueryKeys.collections(orgA)).toEqual([
      orgA,
      "drive",
      "collections",
    ]);
    expect(driveQueryKeys.folders(orgA)).toEqual([orgA, "drive", "folders"]);
    expect(driveQueryKeys.labels(orgA)).toEqual([orgA, "drive", "labels"]);
    expect(driveQueryKeys.dataRooms(orgA)).toEqual([
      orgA,
      "drive",
      "data-rooms",
    ]);
    expect(driveQueryKeys.dataRoom(orgA, "room_1")).toEqual([
      orgA,
      "drive",
      "data-room",
      "room_1",
    ]);
    expect(driveQueryKeys.dataRoomEvents(orgA, "room_1", "everyone")).toEqual([
      orgA,
      "drive",
      "data-room",
      "room_1",
      "events",
      "everyone",
    ]);
    expect(driveQueryKeys.dataRoomQuestions(orgA, "room_1")).toEqual([
      orgA,
      "drive",
      "data-room",
      "room_1",
      "questions",
    ]);
    expect(driveQueryKeys.googleSheet(orgA, "res_1")).toEqual([
      orgA,
      "drive",
      "google-sheet",
      "res_1",
    ]);
    expect(driveQueryKeys.tags(orgA)).toEqual([orgA, "drive", "tags"]);
  });

  it("round-trips splitDriveQueryKey through buildScopedQueryKey", () => {
    const fullKey = driveQueryKeys.dataRoom(orgA, "room_1");
    const split = splitDriveQueryKey(fullKey);

    expect(split).toEqual({
      scope: orgA,
      queryKey: ["drive", "data-room", "room_1"],
    });
    expect(buildScopedQueryKey(split.scope, split.queryKey)).toEqual(fullKey);
  });
});

describe("invalidateDrive", () => {
  it("removes deletedIds from entries with data (including error entries with prior data) and invalidates the store prefix", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fileKeep = fileRow("res_keep", "drive/orgs/org_a/keep.pdf");
    const fileDropById = fileRow("res_drop_id", "drive/orgs/org_a/a.pdf");
    const fileDropByPath = fileRow("res_drop_path", "drive/orgs/org_a/b.pdf");
    const otherOrgFile = fileRow("res_drop_id", "drive/orgs/org_b/a.pdf");

    const catalogKey = buildScopedQueryKey(orgA, ["drive", "catalog", "all"]);
    const recentsKey = buildScopedQueryKey(orgA, ["drive", "recents", "all"]);
    const arrayKey = buildScopedQueryKey(orgA, ["drive", "picker", "all"]);
    const staleErrorKey = buildScopedQueryKey(orgA, ["drive", "stale-error"]);
    const otherOrgKey = buildScopedQueryKey(orgB, ["drive", "picker", "all"]);
    const failedKey = buildScopedQueryKey(orgA, ["drive", "failed-list"]);
    const pendingKey = buildScopedQueryKey(orgA, ["drive", "pending-list"]);

    queryClient.setQueryData<InfiniteData<{ items: TestFileRow[] }>>(
      catalogKey,
      {
        pages: [{ items: [fileKeep, fileDropById, fileDropByPath] }],
        pageParams: [null],
      },
    );
    queryClient.setQueryData<
      InfiniteData<{
        items: Array<{
          kind: "drive-file";
          resourceId: string;
          pathname: string;
        }>;
      }>
    >(recentsKey, {
      pages: [
        {
          items: [
            {
              kind: "drive-file",
              resourceId: "res_keep",
              pathname: "drive/orgs/org_a/keep.pdf",
            },
            {
              kind: "drive-file",
              resourceId: "res_drop_id",
              pathname: "drive/orgs/org_a/a.pdf",
            },
          ],
        },
      ],
      pageParams: [null],
    });
    queryClient.setQueryData(arrayKey, [fileKeep, fileDropByPath]);
    queryClient.setQueryData(staleErrorKey, [fileKeep, fileDropById]);
    await queryClient
      .fetchQuery({
        queryKey: staleErrorKey,
        queryFn: () => Promise.reject(new Error("refresh failed")),
      })
      .catch(() => undefined);
    expect(queryClient.getQueryState(staleErrorKey)?.status).toBe("error");
    queryClient.setQueryData(otherOrgKey, [otherOrgFile]);

    await queryClient
      .fetchQuery({
        queryKey: failedKey,
        queryFn: () => Promise.reject(new Error("boom")),
      })
      .catch(() => undefined);

    const pendingDeferred = Promise.withResolvers<TestFileRow[]>();
    const pendingFetch = queryClient
      .fetchQuery({
        queryKey: pendingKey,
        queryFn: () => pendingDeferred.promise,
      })
      .catch(() => undefined);

    await invalidateDrive(queryClient, orgA, {
      deletedIds: ["res_drop_id", "drive/orgs/org_a/b.pdf"],
    });

    expect(
      queryClient.getQueryData<InfiniteData<{ items: TestFileRow[] }>>(
        catalogKey,
      )?.pages[0]?.items,
    ).toEqual([fileKeep]);
    expect(
      queryClient.getQueryData<
        InfiniteData<{
          items: Array<{ kind: "drive-file"; resourceId: string }>;
        }>
      >(recentsKey)?.pages[0]?.items,
    ).toEqual([
      {
        kind: "drive-file",
        resourceId: "res_keep",
        pathname: "drive/orgs/org_a/keep.pdf",
      },
    ]);
    expect(queryClient.getQueryData(arrayKey)).toEqual([fileKeep]);
    expect(queryClient.getQueryData(staleErrorKey)).toEqual([fileKeep]);
    // Other workspace cache is untouched.
    expect(queryClient.getQueryData(otherOrgKey)).toEqual([otherOrgFile]);

    // Failed (no data) and unloaded queries must never be marked success.
    expect(queryClient.getQueryState(failedKey)?.status).toBe("error");
    expect(queryClient.getQueryState(pendingKey)?.status).toBe("pending");

    // Every orgA Drive entry is invalidated; orgB stays fresh.
    expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(arrayKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(staleErrorKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherOrgKey)?.isInvalidated).toBe(false);

    pendingDeferred.resolve([]);
    await pendingFetch;
  });
});
