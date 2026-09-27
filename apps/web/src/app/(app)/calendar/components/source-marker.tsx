"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { WorkspaceCalendarSource } from "@/lib/clients/generated/core";

const SOURCE_PALETTE_CLASSES = {
  blue: "bg-chart-1",
  violet: "bg-chart-2",
} as const;

export function SourceMarker({
  decorative = false,
  size = "size-4",
  source,
  sourceName,
}: {
  decorative?: boolean;
  size?: string;
  source: WorkspaceCalendarSource | undefined;
  sourceName: string;
}) {
  if (source?.logoUrl) {
    return (
      <Avatar
        className={`${size} shrink-0 rounded-sm`}
        data-testid="calendar-source-marker"
      >
        <AvatarImage alt={decorative ? "" : sourceName} src={source.logoUrl} />
        <AvatarFallback aria-hidden={decorative} className="rounded-sm text-xs">
          {sourceName.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <span
      aria-hidden={decorative}
      aria-label={decorative ? undefined : sourceName}
      className={`${size} shrink-0 rounded-full ${
        source ? SOURCE_PALETTE_CLASSES[source.paletteToken] : "bg-primary"
      }`}
      data-testid="calendar-source-marker"
    />
  );
}
