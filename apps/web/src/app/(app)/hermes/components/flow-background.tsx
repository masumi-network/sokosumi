"use client";

import { cn } from "@/lib/utils";

interface FlowBackgroundProps {
  children: React.ReactNode;
  /** Optional className for the outer wrapper. */
  className?: string;
  /** Full is used by the public landing surface; subtle keeps app screens calm. */
  intensity?: "full" | "subtle";
}

/**
 * Wrapper for the Personal Assistant flow. Most app states use a quiet surface;
 * the pre-activation landing can opt into a darker, animated stage treatment.
 */
export default function FlowBackground({
  children,
  className,
  intensity = "subtle",
}: FlowBackgroundProps) {
  if (intensity === "full") {
    return (
      <div
        className={cn(
          "dark relative min-h-full w-full overflow-hidden bg-background text-foreground",
          className,
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,color-mix(in_oklch,var(--semantic-critical)_74%,transparent)_0%,color-mix(in_oklch,var(--chart-5)_70%,transparent)_22%,transparent_53%),radial-gradient(circle_at_50%_55%,var(--background)_0%,color-mix(in_oklch,var(--background)_78%,transparent)_33%,transparent_58%),linear-gradient(135deg,var(--background)_0%,color-mix(in_oklch,var(--semantic-critical)_34%,var(--background))_48%,var(--background)_100%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_oklch,var(--background)_88%,transparent)_0%,transparent_22%,transparent_78%,color-mix(in_oklch,var(--background)_88%,transparent)_100%)]"
        />
        {children}
      </div>
    );
  }

  return (
    <div className={cn("relative min-h-full w-full", className)}>
      {children}
    </div>
  );
}
