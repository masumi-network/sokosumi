"use client";

import { useEffect } from "react";
import { toast } from "sonner";

const FLASH_TOAST_STORAGE_KEY = "sokosumi:flash-toast";

interface FlashToastPayload {
  message: string;
  pathname: string;
}

/**
 * Queues a one-time success message in `sessionStorage` scoped to the expected
 * landing `pathname`, so it survives a full document navigation (and any server
 * redirect) and displays once only when the next document lands on that path.
 */
export function queueFlashSuccessToast(
  message: string,
  pathname: string,
): void {
  try {
    const payload: FlashToastPayload = { message, pathname };
    sessionStorage.setItem(FLASH_TOAST_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors in private browsing or full-quota environments.
  }
}

function parseFlashToastPayload(raw: string): FlashToastPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      "pathname" in parsed &&
      typeof parsed.message === "string" &&
      typeof parsed.pathname === "string"
    ) {
      return { message: parsed.message, pathname: parsed.pathname };
    }
  } catch {
    // Ignore malformed storage values.
  }
  return null;
}

/**
 * Consumes any queued one-time flash toast on document mount, displaying it
 * only if `window.location.pathname` matches the queued landing pathname and
 * discarding it otherwise.
 */
export function useFlashToast(): void {
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(FLASH_TOAST_STORAGE_KEY);
      if (raw) {
        sessionStorage.removeItem(FLASH_TOAST_STORAGE_KEY);
      }
    } catch {
      return;
    }
    if (!raw) return;

    const payload = parseFlashToastPayload(raw);
    if (!payload || window.location.pathname !== payload.pathname) {
      return;
    }
    toast.success(payload.message);
  }, []);
}
