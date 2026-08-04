"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";

import { authClient } from "@/lib/auth/auth.client";
import {
  createAuthSessionGetter,
  createDebouncedScheduler,
  probeSessionWithRetry,
  SESSION_RESUME_DEBOUNCE_MS,
  type SessionValidateReason,
} from "@/lib/auth/auth.utils";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

export function AuthSessionGuard() {
  const router = useRouter();
  const isRedirectingRef = useRef(false);
  const resumeGenerationRef = useRef(0);
  const getFreshSession = createAuthSessionGetter(() =>
    authClient.getSession({
      query: {
        disableCookieCache: true,
      },
    }),
  );

  const redirectToSignIn = useEffectEvent(() => {
    if (isRedirectingRef.current) {
      return;
    }

    isRedirectingRef.current = true;
    const returnUrl = encodeURIComponent(getReturnUrlFromCurrentLocation());
    router.replace(`/signin?returnUrl=${returnUrl}`);
  });

  const validateSession = useEffectEvent(
    async (reason: SessionValidateReason) => {
      if (isRedirectingRef.current) {
        return;
      }

      if (reason === "mount") {
        try {
          const session = await getFreshSession();
          if (isRedirectingRef.current || session) {
            return;
          }
        } catch {
          return;
        }

        redirectToSignIn();
        return;
      }

      const generation = ++resumeGenerationRef.current;
      const result = await probeSessionWithRetry({
        getSession: getFreshSession,
        shouldCancel: () =>
          isRedirectingRef.current ||
          generation !== resumeGenerationRef.current,
      });

      if (result === "missing") {
        redirectToSignIn();
      }
    },
  );

  useEffect(() => {
    void validateSession("mount");
  }, []);

  useEffect(() => {
    const scheduler = createDebouncedScheduler(() => {
      void validateSession("resume");
    }, SESSION_RESUME_DEBOUNCE_MS);

    function handleWindowFocus() {
      scheduler.schedule();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        scheduler.schedule();
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      scheduler.cancel();
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
