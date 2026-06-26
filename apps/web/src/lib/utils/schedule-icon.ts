import type { LucideIcon } from "lucide-react";
import { CalendarSync, Clock } from "lucide-react";

export function getScheduleIcon(mode: "once" | "recurring"): LucideIcon {
  return mode === "recurring" ? CalendarSync : Clock;
}
