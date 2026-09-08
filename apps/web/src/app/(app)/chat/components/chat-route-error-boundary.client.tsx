"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import {
  CHAT_EDIT_CHANNEL_PARAM,
  pathWithSearch,
} from "@/app/chat/utils/chat-route-base";
import DefaultErrorBoundary from "@/components/default-error-boundary";
import { CHAT_MESSAGE_PARAM } from "@/lib/utils/notification-href";

import { ChatErrorFallback } from "./chat-error-fallback";

type SearchParamsLike = { toString(): string } | null | undefined;

/**
 * What a room reads once and then takes back off its URL: the message a
 * notification named, and a request to open the edit dialog.
 *
 * Named as one list here because the key is the only place that needs both
 * together. Each room-side reader strips only its own, so neither takes the
 * other's off the URL, and the edit reader waits while a message is still on
 * it, so the two do not write in one commit.
 */
const ONE_SHOT_ROOM_PARAMS = [
  CHAT_MESSAGE_PARAM,
  CHAT_EDIT_CHANNEL_PARAM,
] as const;

/**
 * Keep one-shot room requests within the mounted room. Consuming the message
 * parameter must not discard its thread state or the lookup still in flight,
 * and the edit parameter has less than that to survive on: the room holds the
 * dialog it asks for in state, which a remount would throw away before the
 * reader ever saw it.
 * Other query changes, such as Welcome notices, still reset the boundary.
 */
export function chatRouteErrorBoundaryKey(
  pathname: string,
  searchParams?: SearchParamsLike,
): string {
  const params = new URLSearchParams(searchParams?.toString() ?? "");
  for (const param of ONE_SHOT_ROOM_PARAMS) {
    params.delete(param);
  }
  return pathWithSearch(pathname, params);
}

/**
 * Page-only error boundary keyed by pathname + search so a failed segment
 * does not latch across soft navigations within the chat layout (layout
 * stays mounted).
 */
export function ChatRouteErrorBoundary({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <DefaultErrorBoundary
      key={chatRouteErrorBoundaryKey(pathname, searchParams)}
      fallback={<ChatErrorFallback />}
    >
      {children}
    </DefaultErrorBoundary>
  );
}
