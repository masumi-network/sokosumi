"use client";

import { buildQuoteSnippet } from "@sokosumi/utils";
import { Pin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listPinnedMessagesAction } from "@/app/chat/actions";
import { cn } from "@/lib/utils";
import { pickLatestPinnedMessage } from "./pick-latest-pinned-message";
import { messageSender } from "./room-helpers";

export interface LatestPinnedMessageBannerLabels {
  latest: string;
  jumpToLatest: (author: string) => string;
  viewAll: string;
  count: (count: number) => string;
  couldNotLoad: string;
}

export interface LatestPinnedMessageBannerProps {
  roomId: string;
  listGeneration: number;
  labels: LatestPinnedMessageBannerLabels;
  onJump: (messageId: string) => void;
  onOpenAll: () => void;
  onIdsLoaded: (messageIds: readonly string[]) => void;
}

/** Page large enough to skip a few deleted newest pins. */
export const LATEST_PINNED_FETCH_LIMIT = 8;

interface LatestPinnedBannerState {
  messageId: string;
  authorName: string | null;
  snippet: string | null;
  total: number;
}

export function LatestPinnedMessageBanner({
  roomId,
  listGeneration,
  labels,
  onJump,
  onOpenAll,
  onIdsLoaded,
}: LatestPinnedMessageBannerProps): React.ReactElement | null {
  const [isLoading, setIsLoading] = useState(true);
  const [pin, setPin] = useState<LatestPinnedBannerState | null>(null);
  const loadedRoomIdRef = useRef<string | null>(null);
  const pinRef = useRef(pin);
  pinRef.current = pin;

  useEffect(() => {
    let cancelled = false;
    if (loadedRoomIdRef.current !== roomId) {
      pinRef.current = null;
      setPin(null);
    }
    setIsLoading(true);
    void listPinnedMessagesAction(roomId, {
      limit: LATEST_PINNED_FETCH_LIMIT,
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          loadedRoomIdRef.current = roomId;
          if (pinRef.current == null) {
            setPin(null);
          }
          setIsLoading(false);
          return;
        }
        const latest = pickLatestPinnedMessage(result.value.items);
        onIdsLoaded(result.value.items.map((item) => item.messageId));
        if (!latest) {
          loadedRoomIdRef.current = roomId;
          setPin(null);
          setIsLoading(false);
          return;
        }
        const message = latest.message;
        loadedRoomIdRef.current = roomId;
        setPin({
          messageId: latest.messageId,
          authorName: message ? messageSender(message).name : null,
          snippet: message ? buildQuoteSnippet(message.content) : null,
          total: result.value.total,
        });
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        loadedRoomIdRef.current = roomId;
        if (pinRef.current == null) {
          setPin(null);
        }
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listGeneration, onIdsLoaded, roomId]);

  if (isLoading && pin == null) {
    return (
      <div
        className="border-border bg-muted/40 flex h-11 shrink-0 items-stretch border-b"
        data-testid="latest-pinned-message-loading"
        aria-hidden
      >
        <div className="bg-primary/40 w-1 shrink-0" />
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 md:px-6">
          <div className="bg-muted size-3.5 animate-pulse rounded-full" />
          <div className="bg-muted h-3 w-40 animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (!pin) {
    return null;
  }

  const authorName = pin.authorName;
  const snippet = pin.snippet;

  return (
    <div
      className="border-border bg-muted/40 flex min-h-11 shrink-0 items-stretch border-b"
      data-testid="latest-pinned-message"
      role="region"
      aria-label={labels.latest}
    >
      <div className="bg-primary w-1 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 md:px-6">
        <Pin
          className="text-primary size-3.5 shrink-0"
          fill="currentColor"
          fillOpacity={0.25}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-primary text-xs font-medium tracking-wide">
            {labels.latest}
          </p>
          {authorName != null && snippet != null ? (
            <button
              type="button"
              className="flex min-w-0 max-w-full cursor-pointer items-baseline gap-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              aria-label={labels.jumpToLatest(authorName)}
              onClick={() => {
                onJump(pin.messageId);
              }}
            >
              <span className="text-foreground shrink-0 font-medium">
                {authorName}
              </span>
              <span className="text-muted-foreground min-w-0 truncate">
                {snippet}
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="text-muted-foreground cursor-pointer truncate text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => {
                onOpenAll();
              }}
            >
              {labels.couldNotLoad}
            </button>
          )}
        </div>
        {pin.total > 1 ? (
          <button
            type="button"
            className={cn(
              "text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-xs font-medium",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            title={labels.viewAll}
            aria-label={labels.viewAll}
            onClick={() => {
              onOpenAll();
            }}
          >
            {labels.count(pin.total)}
          </button>
        ) : null}
      </div>
    </div>
  );
}
