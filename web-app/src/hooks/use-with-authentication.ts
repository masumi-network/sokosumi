"use client";

import { useCallback } from "react";

import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { useSession } from "@/lib/auth/auth.client";

import useIsClient from "./use-is-client";

type Callback =
  | ((...args: unknown[]) => void)
  | ((...args: unknown[]) => Promise<void>);

export default function useWithAuthentication() {
  const isClient = useIsClient();
  const { data: session, isPending: isSessionPending } = useSession();
  const { showAuthenticationModal } = useGlobalModalsContext();
  const isPending = isClient ? isSessionPending : true;

  const withAuthentication = useCallback(
    (callback: Callback) => {
      if (isPending) {
        return () => {};
      }

      if (!session) {
        return showAuthenticationModal;
      }

      return callback;
    },
    [isPending, session, showAuthenticationModal],
  );

  return {
    isPending,
    withAuthentication,
  };
}
