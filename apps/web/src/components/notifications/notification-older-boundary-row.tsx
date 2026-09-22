"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import type { NotificationOlderStatus } from "@/contexts/notification-provider";
import { useLoadWhenVisible } from "@/hooks/use-load-when-visible";

interface NotificationOlderBoundaryRowProps {
  /** The oldest row loaded, which is where this boundary sits. */
  oldestId: string;
  status: NotificationOlderStatus;
  onLoad: () => void;
}

/**
 * The end of the loaded list, where the rows older than it come in.
 *
 * It loads on its own as soon as it scrolls into view, and it is still a
 * button so a tap works where there is no observer to watch it. A failed load
 * stays on the row with a retry and stops the auto-load until the reader asks
 * again: a list that kept asking would hammer a server that just said no.
 */
export function NotificationOlderBoundaryRow({
  oldestId,
  status,
  onLoad,
}: NotificationOlderBoundaryRowProps) {
  const t = useTranslations("Components.NotificationCenter");
  const rowRef = useRef<HTMLDivElement | null>(null);
  useLoadWhenVisible(rowRef, {
    armed: status === "idle",
    boundaryKey: oldestId,
    onVisible: onLoad,
  });

  const isLoading = status === "loading";

  return (
    <div
      ref={rowRef}
      data-testid="notification-older-boundary"
      className="text-muted-foreground flex flex-col items-center gap-1 p-2 text-sm"
    >
      {/* The whole row is the hit area, so a thumb on the label or on the
          error text lands too. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full flex-wrap py-2 font-normal"
        disabled={isLoading}
        aria-busy={isLoading}
        onClick={onLoad}
      >
        {status === "failed" ? (
          <>
            <span role="alert" className="text-destructive">
              {t("fetchError")}
            </span>
            {t("retry")}
          </>
        ) : isLoading ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("loading")}
          </>
        ) : (
          // Idle is a button waiting to be pressed, not a load in flight.
          // A spinner and "Loading..." here say the older rows are on their
          // way before anything has asked for them, and that is the state a
          // reader sees for good when no observer runs.
          t("showOlder")
        )}
      </Button>
    </div>
  );
}
