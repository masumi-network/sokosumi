"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

export type TranscriptBoundaryStatus = "idle" | "loading" | "failed";

interface TranscriptBoundaryRowProps {
  /** First message of the range below; what the older page loads from. */
  cursorMessageId: string;
  /** Between two loaded ranges, as opposed to above the oldest one. */
  isGap: boolean;
  status: TranscriptBoundaryStatus;
  onLoad: (cursorMessageId: string) => void;
}

/**
 * Where the transcript has history missing: above the oldest loaded range,
 * or between two ranges a jump left apart. Loads the next page of missing
 * rows on tap, and on its own once it scrolls into view, so reading toward a
 * gap fills it without hunting for a button. A failed load stays on the row
 * with a retry and stops the auto-load until the reader asks again.
 */
export function TranscriptBoundaryRow({
  cursorMessageId,
  isGap,
  status,
  onLoad,
}: TranscriptBoundaryRowProps) {
  const t = useTranslations("App.Channels");
  const rowRef = useRef<HTMLDivElement | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  // Syncs with the viewport, which is an external system: the row cannot
  // know it has scrolled into view any other way.
  useEffect(() => {
    const row = rowRef.current;
    if (
      status !== "idle" ||
      !row ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }
      observer.disconnect();
      onLoadRef.current(cursorMessageId);
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [status, cursorMessageId]);

  const isLoading = status === "loading";
  const actionLabel = isGap
    ? isLoading
      ? t("Boundary.loadingMissing")
      : t("Boundary.loadMissing")
    : isLoading
      ? t("loadingOlder")
      : t("loadOlder");

  return (
    <div
      ref={rowRef}
      className="text-muted-foreground my-2 flex flex-col items-center gap-1 text-sm"
    >
      {status === "failed" ? (
        <span role="alert" className="text-destructive">
          {t("Boundary.loadFailed")}
        </span>
      ) : null}
      {/* The whole row is the hit area, so a thumb on the label lands too. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full flex-wrap py-2"
        disabled={isLoading}
        aria-busy={isLoading}
        onClick={() => onLoad(cursorMessageId)}
      >
        {isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
        {isGap && status !== "failed" ? (
          <span className="text-muted-foreground font-normal">
            {t("Boundary.missingHere")}
          </span>
        ) : null}
        {status === "failed" ? t("Boundary.retry") : actionLabel}
      </Button>
    </div>
  );
}
