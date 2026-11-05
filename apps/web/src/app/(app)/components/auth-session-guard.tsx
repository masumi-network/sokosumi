"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth/auth.client";
import { createAuthSessionGetter } from "@/lib/auth/auth.utils";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

export const AuthSessionIdentityContext = createContext<
  ((userId: string) => void) | null
>(null);

interface AuthSessionGuardProps {
  children?: ReactNode;
}

export function AuthSessionGuard({ children }: AuthSessionGuardProps) {
  const router = useRouter();
  const isRedirectingRef = useRef(false);
  const mountedRef = useRef(true);
  const probeGenerationRef = useRef(0);
  const renderedUserIdRef = useRef<string | undefined>(undefined);
  const freshSessionRef = useRef<
    { userId: string; generation: number } | undefined
  >(undefined);
  const getFreshSession = createAuthSessionGetter(() =>
    authClient.getSession({
      query: {
        disableCookieCache: true,
      },
    }),
  );

  const reconcileSession = useCallback(async () => {
    const freshSession = freshSessionRef.current;
    if (
      !mountedRef.current ||
      isRedirectingRef.current ||
      !freshSession ||
      freshSession.generation !== probeGenerationRef.current
    ) {
      return;
    }
    const generation = freshSession.generation;
    const accountChanged =
      renderedUserIdRef.current !== undefined &&
      renderedUserIdRef.current !== freshSession.userId;
    if (accountChanged) {
      // Asked before anything is awaited: the realtime chunk below can fail
      // to load on a tab open across a deploy, and the reload must not wait
      // on it. Not latched either. A `beforeunload` prompt for unsaved edits
      // can keep the document, and a kept document must ask again on the
      // next focus rather than stop checking whose shell it is.
      window.location.reload();
    }
    const realtime = await import("@/lib/ably/realtime-singleton.client");
    if (
      !mountedRef.current ||
      isRedirectingRef.current ||
      generation !== probeGenerationRef.current
    ) {
      return;
    }
    if (accountChanged) {
      realtime.retireAblyRealtimeClientForSessionChange();
      return;
    }
    realtime.discardRetiredAblyRealtimeClient();
  }, []);

  const registerRenderedUser = useCallback(
    (userId: string) => {
      renderedUserIdRef.current = userId;
      void reconcileSession().catch(() => {});
    },
    [reconcileSession],
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
        generation !== probeGenerationRef.current
      ) {
        return;
      }
      if (session) {
        freshSessionRef.current = { userId: session.userId, generation };
        // Another tab can restore this session without running this tab's sign-in flow.
        await reconcileSession();
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

  return (
    <AuthSessionIdentityContext value={registerRenderedUser}>
      {children}
    </AuthSessionIdentityContext>
  );
}
