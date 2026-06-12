"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";

import { createAuthSessionGetter } from "@/lib/utils/auth-redirect";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

async function fetchBrowserSession() {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    return { data: { session: null } };
  }

  const payload = (await response.json()) as {
    session: unknown;
  };

  return { data: { session: payload.session ?? null } };
}

export function AuthSessionGuard() {
  const router = useRouter();
  const isRedirectingRef = useRef(false);
  const getFreshSession = createAuthSessionGetter(fetchBrowserSession);

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
