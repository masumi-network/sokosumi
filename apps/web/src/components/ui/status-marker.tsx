import {
  Ban,
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  CirclePlay,
  CirclePlus,
  CircleSlash,
  CircleX,
  Clock,
  Handshake,
  Hourglass,
  KeyRound,
  LoaderCircle,
  MessageSquareWarning,
  OctagonX,
  PackageX,
  PencilLine,
  RotateCcw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Colour carries urgency. The glyph carries identity.
 *
 * The old system asked hue to name eleven categories, which no palette can do:
 * `status-running` and `status-awaiting` measured OKLab ΔE 4.0 apart in light
 * mode, barely past the 2.0 just-noticeable difference, and five pairs sat
 * under ΔE 10. Draft and canceled were byte-identical. Collapsing to five
 * roles removes the crowding, and the glyph separates states inside a role
 * with no crowding limit at all. Every badge now reads in greyscale, which is
 * what WCAG 2.2 SC 1.4.1 asks for.
 */
export type StatusRole =
  | "idle"
  | "queued"
  | "active"
  | "waiting"
  | "action"
  | "problem"
  | "failure"
  | "success"
  | "closed";

interface RoleStyle {
  /** Badge fill. */
  bg: string;
  /** Label colour. Solid fills carry their own foreground. */
  text: string;
  /** Glyph colour. Clears 3:1 on its own fill (WCAG 2.2 SC 1.4.11). */
  marker: string;
  /**
   * Bare dot, for the callers that paint one outside a badge. It is a separate
   * field because it cannot be derived from `marker`: a solid-fill role's
   * marker is the colour of the label ON that fill, so `failure` would yield a
   * near-white dot. Measured on --card-background it came to 1.06:1 in light
   * mode, which is invisible. Every dot below clears 3:1 on that surface.
   */
  dot: string;
}

/**
 * Two questions decide the role: what must the reader do now, and is this a
 * fault. They are separate axes, so `action` (you are blocked and only you can
 * unblock it) is not the same role as `problem` (something went wrong and it
 * may still resolve without you).
 *
 * Fault severity is the third channel, after hue and glyph: `problem` is a red
 * tint, `failure` is the solid red. That escalation needs no extra hue, which
 * matters because the warm arc is already full at amber and red. It also
 * matches how the risk tiers escalate.
 *
 * `idle` and `closed` share the neutral ramp on purpose: neither has a state
 * worth a hue, and pencil against slash already separates them.
 */
export const STATUS_ROLE_STYLES: Record<StatusRole, RoleStyle> = {
  idle: {
    bg: "bg-quaternary",
    text: "text-foreground",
    marker: "text-status-done",
    dot: "bg-status-done",
  },
  queued: {
    bg: "bg-status-queued-quaternary",
    text: "text-foreground",
    marker: "text-status-queued",
    dot: "bg-status-queued",
  },
  active: {
    bg: "bg-status-active-quaternary",
    text: "text-foreground",
    marker: "text-status-active",
    dot: "bg-status-active",
  },
  waiting: {
    bg: "bg-status-waiting-quaternary",
    text: "text-foreground",
    marker: "text-status-waiting",
    dot: "bg-status-waiting",
  },
  action: {
    bg: "bg-semantic-warning-quaternary",
    text: "text-foreground",
    marker: "text-semantic-warning",
    dot: "bg-semantic-warning",
  },
  problem: {
    bg: "bg-semantic-destructive-quaternary",
    text: "text-foreground",
    marker: "text-semantic-destructive",
    dot: "bg-semantic-destructive",
  },
  failure: {
    bg: "bg-semantic-destructive-solid",
    text: "text-semantic-destructive-foreground",
    marker: "text-semantic-destructive-foreground",
    dot: "bg-semantic-destructive-solid",
  },
  success: {
    bg: "bg-semantic-success-quaternary",
    text: "text-foreground",
    marker: "text-semantic-success",
    dot: "bg-semantic-success",
  },
  closed: {
    bg: "bg-quaternary",
    text: "text-foreground",
    marker: "text-status-done",
    dot: "bg-status-done",
  },
};

export interface StatusMarkerSpec {
  role: StatusRole;
  icon: LucideIcon;
  /** Only the running glyph spins. */
  spin?: boolean;
}

/** The glyph vocabulary, shared by task, job, file and risk badges. */
export const MARKER_ICONS = {
  draft: PencilLine,
  queued: Clock,
  ready: CirclePlay,
  grant: ShieldAlert,
  input: MessageSquareWarning,
  approval: BadgeCheck,
  auth: KeyRound,
  credits: Wallet,
  toppedUp: CirclePlus,
  running: LoaderCircle,
  awaiting: Hourglass,
  completed: CircleCheck,
  failed: CircleX,
  canceled: CircleSlash,
  hiring: Handshake,
  hiringFailed: Ban,
  resultMissing: PackageX,
  refund: RotateCcw,
  dispute: Scale,
  warning: CircleAlert,
  riskMinimal: ShieldCheck,
  riskLimited: ShieldAlert,
  riskHigh: TriangleAlert,
  riskUnacceptable: OctagonX,
} as const;

export function StatusMarker({
  spec,
  className,
}: {
  spec: StatusMarkerSpec;
  className?: string;
}) {
  const Icon = spec.icon;
  return (
    <Icon
      aria-hidden
      // 14px, not 12px, and a heavier stroke. A light stroke on a dark ground
      // erodes optically, so the dark glyph read as missing even though it
      // measured 3.61 to 6.65 against its own fill, above the light side.
      strokeWidth={2.25}
      className={cn(
        "size-3.5 shrink-0",
        STATUS_ROLE_STYLES[spec.role].marker,
        spec.spin && "animate-spin motion-reduce:animate-none",
        className,
      )}
    />
  );
}
