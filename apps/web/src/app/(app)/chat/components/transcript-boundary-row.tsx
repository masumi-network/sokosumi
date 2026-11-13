"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useLoadWhenVisible } from "@/hooks/use-load-when-visible";

/** History loads one screen before the reader reaches where it is missing. */
const LOAD_AHEAD = "100% 0px";

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
 * gap fills it without hunting for a button. "Into view" starts one screen
 * early, so the rows are there before the reader is. A failed load stays on the row
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
  // The transcript keeps this row in place while the reader scrolls, also
  // after its page has landed. It is then idle and in view again, with the
  // same cursor. So it asks on its own once per cursor; a tap asks again.
  const [askedFor, setAskedFor] = useState<string | null>(null);
  useLoadWhenVisible(rowRef, {
    armed: status === "idle" && askedFor !== cursorMessageId,
    boundaryKey: cursorMessageId,
    onVisible: () => {
      setAskedFor(cursorMessageId);
      onLoad(cursorMessageId);
    },
    ahead: LOAD_AHEAD,
  });

  const isLoading = status === "loading";
  const actionLabel = isGap ? t("Boundary.loadMissing") : t("loadOlder");

  return (
    <div
      ref={rowRef}
      className="text-muted-foreground my-2 flex flex-col items-center gap-1 text-sm"
    >
      {/* The whole row is the hit area, so a thumb on the label or on the
          error text lands too. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full flex-wrap py-2"
        loading={isLoading}
        onClick={() => onLoad(cursorMessageId)}
      >
        {status === "failed" ? (
          <span role="alert" className="text-destructive font-normal">
            {t("Boundary.loadFailed")}
          </span>
        ) : isGap ? (
          <span className="text-muted-foreground font-normal">
            {t("Boundary.missingHere")}
          </span>
        ) : null}
        {status === "failed" ? t("Boundary.retry") : actionLabel}
      </Button>
    </div>
  );
}
