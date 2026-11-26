import type { LucideIcon } from "lucide-react";

/**
 * Web's status marker (apps/web/src/components/ui/status-marker.tsx): the
 * hue says where the work stands, the weight which status inside it, the
 * glyph names it. Iris, yellow and green are discs behind a Neutral 950
 * glyph, never bare ink.
 */
const DISC = {
  active: "bg-status-working text-primary-foreground",
  blocked: "bg-semantic-warning text-semantic-warning-foreground",
  resolved: "bg-semantic-success text-semantic-success-foreground",
} as const;
const INK = {
  dormant: "text-status-done",
  staged: "text-status-external",
  fault: "text-semantic-destructive",
  warning: "text-status-warning",
  info: "text-status-info",
  success: "text-status-success",
  destructive: "text-status-destructive",
} as const;

export type Hue = keyof typeof DISC | keyof typeof INK;

export interface MarkerSpec {
  icon: LucideIcon;
  hue: Hue;
  /** `outline` is the second status in a hue, `solid` a fault that did not resolve. */
  weight?: "filled" | "outline" | "solid";
  /** Only the running glyph spins, and only while the work is live. */
  spin?: boolean;
}

/** The 14px glyph, on its disc where the hue has one. */
export function StatusMarker({ spec }: { spec: MarkerSpec }) {
  const { icon: Icon, hue, spin } = spec;
  const spinning = spin ? "animate-spin motion-reduce:animate-none" : "";
  if (hue in DISC) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex size-3.5 shrink-0 items-center justify-center rounded-full ${DISC[hue as keyof typeof DISC]}`}
      >
        <Icon strokeWidth={2.75} className={`size-2.5 ${spinning}`} />
      </span>
    );
  }
  return (
    <Icon
      aria-hidden="true"
      strokeWidth={2.25}
      className={`size-3.5 shrink-0 ${INK[hue as keyof typeof INK]} ${spinning}`}
    />
  );
}

const CHIP = {
  filled: "bg-muted border-border text-foreground",
  outline: "border-border text-foreground",
  solid:
    "bg-semantic-destructive-solid text-semantic-destructive-foreground border-transparent [&_svg]:text-semantic-destructive-foreground",
} as const;

/** Web's status chip (job-status-badge.tsx): the marker and its word in a bordered box. */
export function StatusBadge({
  spec,
  label,
}: {
  spec: MarkerSpec;
  label: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium ${CHIP[spec.weight ?? "filled"]}`}
    >
      <StatusMarker spec={spec} />
      <span>{label}</span>
    </span>
  );
}
