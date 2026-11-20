"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

type ToastVariant = "error" | "success";

export interface RouteNoticeToast {
  /** Disambiguates distinct trigger states that share the same message and href. */
  key?: string | number | null;
  variant: ToastVariant;
  message: string;
  replaceHref: string;
  /** Passed to `router.replace` only when explicitly set. */
  replaceScroll?: boolean;
  /** Fire at most once per mount even across StrictMode, rerenders, or Activity reveal. */
  once?: boolean;
}

export interface StateToast {
  /** Disambiguates distinct trigger states that share the same message. */
  key?: string | number | null;
  variant: ToastVariant;
  message: string;
  duration?: number;
  closeButton?: boolean;
}

function showToast(
  variant: ToastVariant,
  message: string,
  duration?: number,
  closeButton?: boolean,
): void {
  const hasOptions = duration !== undefined || closeButton !== undefined;
  const options = hasOptions
    ? {
        ...(duration !== undefined ? { duration } : {}),
        ...(closeButton !== undefined ? { closeButton } : {}),
      }
    : undefined;

  if (variant === "success") {
    if (options) toast.success(message, options);
    else toast.success(message);
  } else if (options) {
    toast.error(message, options);
  } else {
    toast.error(message);
  }
}

/**
 * Displays a toast for an incoming route notice (e.g., query-param return from
 * a redirect or OAuth callback) and cleans the URL with `router.replace`.
 */
export function useRouteNoticeToast(notice: RouteNoticeToast | null): void {
  const router = useRouter();
  const hasHandledRef = useRef(false);
  const key = notice?.key;
  const variant = notice?.variant;
  const message = notice?.message;
  const replaceHref = notice?.replaceHref;
  const replaceScroll = notice?.replaceScroll;
  const once = notice?.once ?? false;

  useEffect(() => {
    void key;
    if (!variant || !message || !replaceHref) return;
    if (once && hasHandledRef.current) return;
    if (once) hasHandledRef.current = true;

    showToast(variant, message);
    if (replaceScroll === undefined) {
      router.replace(replaceHref);
    } else {
      router.replace(replaceHref, { scroll: replaceScroll });
    }
  }, [key, message, once, replaceHref, replaceScroll, router, variant]);
}

/**
 * Displays a toast when client state enters a notice condition, without
 * coupling to Next.js router navigation.
 */
export function useStateToast(notice: StateToast | null): void {
  const key = notice?.key;
  const variant = notice?.variant;
  const message = notice?.message;
  const duration = notice?.duration;
  const closeButton = notice?.closeButton;

  useEffect(() => {
    void key;
    if (!variant || !message) return;

    showToast(variant, message, duration, closeButton);
  }, [closeButton, duration, key, message, variant]);
}
