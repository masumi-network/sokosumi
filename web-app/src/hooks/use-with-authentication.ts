"use client";

import { useCallback } from "react";

import { useSession } from "@/lib/auth/auth.client";

import useAuthenticationModal from "./use-authentication-modal";

type Callback =
  | ((...args: unknown[]) => void)
  | ((...args: unknown[]) => Promise<void>);

export default function useWithAuthentication() {
  const { data: session, isPending } = useSession();
  const { Component, showModal } = useAuthenticationModal();

  const withAuthentication = useCallback(
    (callback: Callback) => {
      if (isPending) {
        return () => {};
      }

      if (!session) {
        return showModal;
      }

      return callback;
    },
    [isPending, session, showModal],
  );

  return {
    isPending,
    withAuthentication,
    ModalComponent: Component,
  };
}
