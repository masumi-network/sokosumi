"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/auth.client";
import {
  type FileStore,
  fetchWorkspaceFolders,
} from "@/lib/utils/file-search.client";

/**
 * Every folder path in a store, loaded again on each `reloadToken`.
 *
 * It shared the panel's labels load, which runs once per store, so a folder
 * an upload had just made (Upload folder, with its subfolders) stayed out of
 * the folder list until the page was opened again. Waiting on the slower
 * labels and collections also held the folder list back on arrival.
 *
 * A failure is silent: a folder facet the reader cannot see is a filter they
 * do not miss, and the search box is the better tool anyway.
 */
export function useWorkspaceFolders(
  store: FileStore,
  reloadToken: number,
): string[] {
  const { data: session } = useSession();
  const viewerId = session?.user?.id ?? null;
  const organizationId =
    store.scope === "org" ? (store.organizationId ?? null) : null;

  const foldersQuery = useQuery({
    queryKey: [
      "drive",
      "workspace-folders",
      viewerId,
      store.scope,
      organizationId,
      // `reloadToken` is a signal, not an input: the files under the store
      // changed, so the folders they sit in may have too.
      reloadToken,
    ],
    queryFn: ({ signal }) => fetchWorkspaceFolders({ store, signal }),
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      if (
        previousKey &&
        previousKey[2] === viewerId &&
        previousKey[3] === store.scope &&
        previousKey[4] === organizationId
      ) {
        return previousData;
      }
      return undefined;
    },
    staleTime: 0,
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
  });

  return foldersQuery.isError ? [] : (foldersQuery.data ?? []);
}
