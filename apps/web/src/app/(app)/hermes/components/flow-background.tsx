"use client";

import { cn } from "@/lib/utils";

interface FlowBackgroundProps {
  children: React.ReactNode;
  /** Optional className for the outer wrapper. */
  className?: string;
  /** Dial the overall blob saturation. Defaults to full. */
  intensity?: "full" | "subtle";
}

/**
 * Ambient animated gradient backdrop for the Hermes setup flow.
 *
 * Wraps the screen content so the blobs sit in a controlled stacking
 * context — fixed positioning + negative z-index doesn't reliably render
 * over the parent layout's `bg-background`, so we anchor inside the screen
 * itself with `absolute inset-0` and stack content explicitly above.
 *
 * Three large, heavily-blurred color blobs drift slowly across the
 * background on long, desynced cycles. Honors `prefers-reduced-motion`.
 */
export default function FlowBackground({
  children,
  className,
  intensity = "full",
}: FlowBackgroundProps) {
  const opacityClass =
    intensity === "subtle" ? "opacity-60" : "opacity-100";

  return (
    <div className={cn("relative min-h-full w-full", className)}>
      {/*
        Blob container escapes the parent layout's `p-4 pt-20 md:pt-4`
        padding via negative insets so the gradient hits the true viewport
        edges (no white border around it). Height is generous (130vh) so
        the bottom of the gradient extends past the fold and fades cleanly
        into the page background rather than cutting off sharply.
        `overflow-hidden` lives here, NOT on the outer wrapper — that bug
        was clipping page content below the fold.
      */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-x-8 -top-24 h-[130vh] overflow-hidden md:-inset-x-8 md:-top-8",
          opacityClass,
        )}
      >
        {/* Violet — top-left drift */}
        <div className="hermes-blob hermes-blob-1 bg-violet-400/40 dark:bg-violet-500/30" />
        {/* Cyan — bottom-right drift */}
        <div className="hermes-blob hermes-blob-2 bg-cyan-400/35 dark:bg-cyan-500/25" />
        {/* Amber — center-top drift, slower */}
        <div className="hermes-blob hermes-blob-3 bg-amber-300/30 dark:bg-amber-400/20" />

        {/* Soft top wash so the brightest spots don't fight the heading text */}
        <div className="from-background/40 via-background/0 to-background/0 absolute inset-0 bg-gradient-to-b" />
        {/* Bottom fade — gradient dissolves into the page bg over the last
            40% of the blob container so there's no hard cutoff at the fold. */}
        <div className="from-background absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-t to-transparent" />
      </div>

      {/* Content stacks above the blobs */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
