"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface UseClipboardOptions {
  copySuccessMessage?: string;
  copyErrorMessage?: string;
}

export interface UseClipboardReturn {
  copied: boolean;
  copy: (text: string) => Promise<void>;
  reset: () => void;
}

export const COPY_SUCCESS_TIMEOUT = 2000;

/**
 * Custom hook for clipboard operations
 * Handles copying text to clipboard with visual feedback and timeout management
 */
export function useClipboard(
  options?: UseClipboardOptions,
): UseClipboardReturn {
  const t = useTranslations("App.Account.ApiKeys");
  const successMessage =
    options?.copySuccessMessage ?? t("Messages.copySuccess");
  const errorMessage = options?.copyErrorMessage ?? t("Messages.copyError");
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Copies text to clipboard and shows success feedback
   */
  const copy = useCallback(
    async (text: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(successMessage);
        setCopied(true);

        // Clear any existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Set new timeout to reset copied state
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
          timeoutRef.current = null;
        }, COPY_SUCCESS_TIMEOUT);
      } catch {
        toast.error(errorMessage);
      }
    },
    [errorMessage, successMessage],
  );

  /**
   * Manually reset the copied state
   */
  const reset = useCallback(() => {
    setCopied(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Effect is necessary: Cleanup to prevent memory leaks
  // Clears timeout when component unmounts to avoid setState on unmounted component
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
