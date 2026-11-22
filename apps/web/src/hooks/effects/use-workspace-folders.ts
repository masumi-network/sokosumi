"use client";

import { useEffect, useState } from "react";
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
  const [folders, setFolders] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchWorkspaceFolders({ store, signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setFolders(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFolders([]);
      });
    return () => controller.abort();
    // `reloadToken` is a signal, not an input: the files under the store
    // changed, so the folders they sit in may have too.
  }, [store, reloadToken]);

  return folders;
}
