"use client";

import { cn } from "@/lib/utils";

interface FlowBackgroundProps {
  children: React.ReactNode;
  /** Optional className for the outer wrapper. */
  className?: string;
  /** Kept for call-site compatibility; the backdrop is intentionally clean. */
  intensity?: "full" | "subtle";
}

/**
 * Wrapper for the Personal Assistant flow. Intentionally a clean, borders-first
 * surface — no gradient wash, no grid. The assistant's orb carries the colour;
 * the background stays quiet, matching the rest of the app.
 */
export default function FlowBackground({
  children,
  className,
}: FlowBackgroundProps) {
  return (
    <div className={cn("relative min-h-full w-full", className)}>
      {children}
    </div>
  );
}
