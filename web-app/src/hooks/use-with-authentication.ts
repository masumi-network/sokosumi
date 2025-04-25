"use client";

import { useCallback } from "react";

import AuthenticationModal from "@/components/modals/authentication-modal";
import { useSession } from "@/lib/auth/auth.client";

import useModal from "./use-modal";

type Callback =
  | ((...args: unknown[]) => void)
  | ((...args: unknown[]) => Promise<void>);

export default function useWithAuthentication() {
  const { data: session, isPending } = useSession();
  const { Component, showModal } = useModal(AuthenticationModal);

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
