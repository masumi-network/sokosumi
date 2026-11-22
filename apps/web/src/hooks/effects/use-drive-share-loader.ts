"use client";

import type { DriveShare } from "@sokosumi/core-client";
import { type RefObject, useEffect, useState } from "react";
import { toast } from "sonner";
import type { DriveShareItem } from "@/app/drive/components/drive-share-dialog";
import {
  type FileStore,
  fetchDriveShare,
} from "@/lib/utils/file-search.client";

/**
 * Owns share and password draft state for `DriveShareDialog`, reloading the
 * share link whenever the target item or store changes.
 */
export function useDriveShareLoader(
  item: DriveShareItem | null,
  store: FileStore,
  loadFailedMessage: RefObject<string>,
) {
  const [share, setShare] = useState<DriveShare | null | undefined>(undefined);
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!item) return;
    let current = true;
    setShare(undefined);
    setPassword("");
    fetchDriveShare({ store, target: item.target })
      .then((found) => {
        if (current) setShare(found);
      })
      .catch(() => {
        if (current) setShare(null);
        toast.error(loadFailedMessage.current);
      });
    return () => {
      current = false;
    };
  }, [item, store]);

  return { share, setShare, password, setPassword };
}
