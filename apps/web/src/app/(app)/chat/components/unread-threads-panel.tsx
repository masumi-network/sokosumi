"use client";

import { MessagesSquare } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { countAttentionThreadsAction } from "@/app/chat/actions";
import { Button } from "@/components/ui/button";

export interface UnreadThreadsPanelLabels {
  open: string;
}

interface UnreadThreadsPanelProps {
  roomId: string;
  labels: UnreadThreadsPanelLabels;
  /**
   * Monotonic epoch from the parent. Values > 0 trigger a debounced
   * attention-count refetch (same dual-baseline set as overview Mark all).
   */
  attentionRefreshToken: number;
  isOpen: boolean;
  onToggle: () => void;
}

const ATTENTION_REFRESH_DEBOUNCE_MS = 300;

function UnreadThreadsBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      data-testid="unread-threads-badge"
      aria-hidden="true"
      className="bg-primary absolute top-0 right-0 size-2 rounded-full ring-2 ring-background"
    />
  );
}

export function UnreadThreadsPanel({
  roomId,
  labels,
  attentionRefreshToken,
  isOpen,
  onToggle,
}: UnreadThreadsPanelProps) {
  const [badgeCount, setBadgeCount] = useState(0);
  const requestIdRef = useRef(0);

  const loadUnreadCount = useEffectEvent(async () => {
    const requestId = ++requestIdRef.current;
    const result = await countAttentionThreadsAction(roomId);
    if (requestId !== requestIdRef.current) {
      return;
    }
    if (!result.ok) {
      return;
    }
    setBadgeCount(result.value);
  });

  useEffect(() => {
    void loadUnreadCount();
  }, [roomId]);

  useEffect(() => {
    if (attentionRefreshToken <= 0) {
      return;
    }
    const timerId = window.setTimeout(() => {
      void loadUnreadCount();
    }, ATTENTION_REFRESH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [attentionRefreshToken]);

  const triggerLabel =
    badgeCount > 0 ? `${labels.open} (${badgeCount})` : labels.open;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={triggerLabel}
      aria-expanded={isOpen}
      data-testid="unread-threads-trigger"
      className="relative"
      onClick={onToggle}
    >
      <MessagesSquare className="size-4" />
      <UnreadThreadsBadge count={badgeCount} />
    </Button>
  );
}
