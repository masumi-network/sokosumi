"use client";

import { CalendarClock, Layers, Server, UserPlus } from "lucide-react";
import { type ComponentType } from "react";

/** Swiss flag, drawn rather than an emoji so it renders identically across
 * platforms inside the feature icon tile. */
export function SwissFlagIcon({
  className,
}: {
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" fill="#D52B1E" />
      <rect x="13" y="7" width="6" height="18" fill="#FFFFFF" />
      <rect x="7" y="13" width="18" height="6" fill="#FFFFFF" />
    </svg>
  );
}

export const FEATURES: Array<{
  titleKey: string;
  bodyKey: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  { titleKey: "feature2Title", bodyKey: "feature2Body", Icon: UserPlus },
  { titleKey: "feature4Title", bodyKey: "feature4Body", Icon: Server },
  { titleKey: "feature5Title", bodyKey: "feature5Body", Icon: CalendarClock },
  { titleKey: "feature6Title", bodyKey: "feature6Body", Icon: Layers },
  { titleKey: "feature7Title", bodyKey: "feature7Body", Icon: SwissFlagIcon },
];
