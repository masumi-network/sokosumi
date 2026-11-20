"use client";

import { useEffect } from "react";
import { toast } from "sonner";

const FLASH_TOAST_STORAGE_KEY = "sokosumi:flash-toast";

/**
 * Queues a one-time success message in `sessionStorage` so it survives a full
 * document navigation (and any server redirect) and displays once on mount.
 */
export function queueFlashSuccessToast(message: string): void {
  try {
    sessionStorage.setItem(FLASH_TOAST_STORAGE_KEY, message);
  } catch {
    // Ignore storage errors in private browsing or full-quota environments.
  }
}

/**
 * Consumes and displays any queued one-time flash toast on document mount.
 */
export function useFlashToast(): void {
  useEffect(() => {
    let message: string | null = null;
    try {
      message = sessionStorage.getItem(FLASH_TOAST_STORAGE_KEY);
      if (message) {
        sessionStorage.removeItem(FLASH_TOAST_STORAGE_KEY);
      }
    } catch {
      return;
    }
    if (message) {
      toast.success(message);
    }
  }, []);
}
