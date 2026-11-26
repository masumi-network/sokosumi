"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface UseClipboardOptions {
  copySuccessMessage: string;
  copyErrorMessage: string;
}

export interface UseClipboardReturn {
  copied: boolean;
  copy: (text: string) => Promise<void>;
  reset: () => void;
}

export const COPY_SUCCESS_TIMEOUT = 3000;

/** One-shot clipboard write + toast. Use when the caller does not need `copied`. */
export async function copyTextWithToast(
  text: string,
  messages: UseClipboardOptions,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(messages.copySuccessMessage);
    return true;
  } catch {
    toast.error(messages.copyErrorMessage);
    return false;
  }
}

/**
 * Clipboard copy with toast feedback and optional visual "copied" state timing.
 * Callers supply messages so this hook stays free of any specific i18n namespace.
 */
export function useClipboard(options: UseClipboardOptions): UseClipboardReturn {
  const { copySuccessMessage, copyErrorMessage } = options;
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const copy = useCallback(
    async (text: string): Promise<void> => {
      const didCopy = await copyTextWithToast(text, {
        copySuccessMessage,
        copyErrorMessage,
      });
      if (!didCopy) {
        return;
      }
      setCopied(true);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setCopied(false);
        timeoutRef.current = null;
      }, COPY_SUCCESS_TIMEOUT);
    },
    [copyErrorMessage, copySuccessMessage],
  );

  const reset = useCallback(() => {
    setCopied(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    copied,
    copy,
    reset,
  };
}
