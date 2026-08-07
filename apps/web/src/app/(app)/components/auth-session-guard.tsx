"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth/auth.client";
import { createAuthSessionGetter } from "@/lib/auth/auth.utils";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

export function AuthSessionGuard() {
  const router = useRouter();
  const isRedirectingRef = useRef(false);
  const mountedRef = useRef(true);
  const probeGenerationRef = useRef(0);
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

    const generation = ++probeGenerationRef.current;

    try {
      const session = await getFreshSession();
      if (
        !mountedRef.current ||
        isRedirectingRef.current ||
        generation !== probeGenerationRef.current ||
        session
      ) {
        return;
      }
    } catch {
      return;
    }

    isRedirectingRef.current = true;
    const returnUrl = encodeURIComponent(getReturnUrlFromCurrentLocation());
    router.replace(`/signin?returnUrl=${returnUrl}`);
  });

  useMountEffect(() => {
    mountedRef.current = true;
    void validateSession();

    return () => {
      mountedRef.current = false;
      probeGenerationRef.current += 1;
    };
  });

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
