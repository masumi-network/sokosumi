"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { UseClipboardReturn } from "@/app/account/components/api-keys/types";
import { COPY_SUCCESS_TIMEOUT } from "@/app/account/components/api-keys/utils";

/**
 * Custom hook for clipboard operations
 * Handles copying text to clipboard with visual feedback and timeout management
 */
export function useClipboard(): UseClipboardReturn {
  const t = useTranslations("App.Account.ApiKeys");
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Copies text to clipboard and shows success feedback
   */
  const copy = useCallback(
    async (text: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t("Messages.copySuccess"));
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
        toast.error(t("Messages.copyError"));
      }
    },
    [t],
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

  // Cleanup timeout on unmount
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
