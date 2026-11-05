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
  const reloadAskedRef = useRef(false);
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
    if (accountChanged && !reloadAskedRef.current) {
      // Asked before anything is awaited: the realtime chunk below can fail
      // to load on a tab open across a deploy, and the reload must not wait
      // on it. A `beforeunload` prompt for unsaved edits can keep the
      // document, and dismissing that prompt refocuses the window. A kept
      // document asks again on the next return to the tab, not on that
      // focus, or the reader could never reach the editor to save. Focus
      // still probes, so a session that ends meanwhile still signs out. A
      // window that is never hidden, side by side with another, is not
      // asked again until it is: the reader chose to stay with their edits.
      reloadAskedRef.current = true;
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

  const registerRenderedUser = useCallback(
    (userId: string) => {
      renderedUserIdRef.current = userId;
      // A render that disagrees with the last probe is asked again rather
      // than judged on it: a sign-in inside the document re-renders the
      // shell for the new account before any focus asks Core whose session
      // this is, and the shell is a new one, so a kept reload is forgotten.
      if (
        freshSessionRef.current &&
        freshSessionRef.current.userId !== userId
      ) {
        reloadAskedRef.current = false;
        void validateSession();
        return;
      }
      void reconcileSession().catch(() => {});
    },
    [reconcileSession],
  );

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
        reloadAskedRef.current = false;
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
