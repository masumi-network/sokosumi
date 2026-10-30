import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Large outcome disc for invitation / accept flows. Same fill-only rule as
 * `StatusMarker`: success is a green disc with a Neutral 950 glyph; a fault
 * is a neutral disc with the X.
 */
export function StatusOutcomeDisc({
  kind,
  icon: Icon,
  className,
}: {
  kind: "success" | "fault";
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex size-16 items-center justify-center rounded-full",
        kind === "success" ? "bg-semantic-success" : "bg-quinary",
        className,
      )}
    >
      <Icon
        className={cn(
          "size-8",
          kind === "success"
            ? "text-semantic-success-foreground"
            : "text-semantic-destructive",
        )}
      />
    </div>
  );
}
