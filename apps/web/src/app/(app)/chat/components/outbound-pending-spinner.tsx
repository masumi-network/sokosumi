import { cn } from "@/lib/utils";

/**
 * Quiet dual-arc ring for classic outbound pending. Slow spin; static under
 * prefers-reduced-motion. Not the coworker Drive grid / thinking orb.
 */
export function OutboundPendingSpinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn(
        "text-muted-foreground animate-outbound-pending-spin motion-reduce:animate-none",
        className,
      )}
      data-testid="outbound-delivery-pending-spinner"
    >
      {/* Faint track — stays put under reduced motion so the mark still reads. */}
      <circle
        cx="8"
        cy="8"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity={0.28}
      />
      {/* Leading arc */}
      <path
        d="M8 2.5a5.5 5.5 0 0 1 4.76 2.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Trailing arc (opposite, softer) */}
      <path
        d="M8 13.5a5.5 5.5 0 0 1-4.76-2.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity={0.45}
      />
    </svg>
  );
}
