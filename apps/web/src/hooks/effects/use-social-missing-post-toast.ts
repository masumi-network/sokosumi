"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface UseSocialMissingPostToastOptions {
  requestedPostId: string | undefined;
  selectedPostId: string | undefined;
  selectedPostFailed: boolean;
  t: (key: "toasts.missingPost") => string;
}

export function useSocialMissingPostToast({
  requestedPostId,
  selectedPostId,
  selectedPostFailed,
  t,
}: UseSocialMissingPostToastOptions): void {
  const toastedMissingPostIdRef = useRef<string | null>(null);

  useEffect(() => {
    // A failed load is not a missing post; the inline error says so instead.
    if (!requestedPostId || selectedPostId || selectedPostFailed) {
      toastedMissingPostIdRef.current = null;
      return;
    }
    if (toastedMissingPostIdRef.current === requestedPostId) return;
    toastedMissingPostIdRef.current = requestedPostId;
    toast.error(t("toasts.missingPost"), {
      duration: Infinity,
      closeButton: true,
    });
  }, [requestedPostId, selectedPostId, selectedPostFailed, t]);
}
