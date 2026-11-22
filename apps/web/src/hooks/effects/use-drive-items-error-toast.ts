"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Logs and toasts when `DrivePageWorkspace`'s Drive items query enters an error
 * state.
 */
export function useDriveItemsErrorToast(
  isError: boolean,
  error: unknown,
  t: (key: "loadFilesError") => string,
): void {
  useEffect(() => {
    if (!isError) {
      return;
    }
    console.error("Failed to load Drive items", error);
    toast.error(t("loadFilesError"));
  }, [error, isError, t]);
}
