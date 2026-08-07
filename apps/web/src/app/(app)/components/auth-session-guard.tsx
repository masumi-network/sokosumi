"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";

import { authClient } from "@/lib/auth/auth.client";
import { createAuthSessionGetter } from "@/lib/auth/auth.utils";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

export function AuthSessionGuard() {
  const router = useRouter();
  const isRedirectingRef = useRef(false);
  const getFreshSession = createAuthSessionGetter(() =>
    authClient.getSession({
      query: {
        disableCookieCache: true,
      },
    }),
  );

  const validateSession = useEffectEvent(async () => {
    if (isRedirectingRef.current) {
      return;
    }

    try {
      const session = await getFreshSession();
      if (isRedirectingRef.current || session) {
        return;
      }
    } catch {
      return;
    }

    isRedirectingRef.current = true;
    const returnUrl = encodeURIComponent(getReturnUrlFromCurrentLocation());
    router.replace(`/signin?returnUrl=${returnUrl}`);
  });

  useEffect(() => {
    void validateSession();
  }, []);

  useEffect(() => {
    function handleWindowFocus() {
      void validateSession();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void validateSession();
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
