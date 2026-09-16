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
 * Colour says what the reader must do. The glyph says which status it is.
 *
 * The old system asked hue to name eleven categories, which no palette can do:
 * `status-running` and `status-awaiting` measured OKLab ΔE 4.0 apart in light
 * mode, barely past the 2.0 just-noticeable difference, and five pairs sat
 * under ΔE 10. Draft and canceled were byte-identical.
 *
 * So hue answers one question instead: what is owed, and by whom. Seven roles
 * cover both the task and the job scale. Statuses that ask the same thing of
 * the reader share a hue and are told apart by the glyph and the word, which
 * have no crowding limit. Every badge also reads in greyscale, which is what
 * WCAG 2.2 SC 1.4.1 asks for.
 */
export type StatusRole =
  /** Nobody owes anything: a draft nobody submitted, a case already closed. */
  | "inert"
  /** We have it. Wait. Queued, starting, running, resuming. */
  | "working"
  /** Someone outside owes the next move: a vendor, a payer, a system. */
  | "external"
  /** You owe the next move, and nothing proceeds until you make it. */
  | "action"
  /** Something is wrong and may still resolve. */
  | "problem"
  /** It failed. Hire again. */
  | "failure"
  /** There is a result to read. */
  | "success";

interface RoleStyle {
  /** Badge fill. */
  bg: string;
  /**
   * Label colour. The chromatic roles use a `-label` step: the marker hue is
   * tuned to 3:1 for a glyph, and 12px badge text needs 4.5:1 on the same
   * fill. Solid fills carry their own foreground.
   */
  text: string;
  /** Glyph colour. Clears 3:1 on its own fill (WCAG 2.2 SC 1.4.11). */
  marker: string;
  /**
   * Bare dot, for the callers that paint one outside a badge. It is a separate
   * field because it cannot be derived from `marker`: a solid-fill role's
   * marker is the colour of the label ON that fill, so `failure` would yield a
   * near-white dot. Measured on --card-background it came to 1.06:1 in light
   * mode, which is invisible. Every dot below clears 3:1 on that surface: the
   * range is 4.56 to 10.37 in light and 3.31 to 10.61 in dark.
   *
   * One surface still misses. On --muted, the hover fill of the agent job
   * list row, the mark is the glyph and reads `onSurface` rather than this
   * field; both resolve to the same token, and in dark `failure` measures
   * 2.78:1 there, because --semantic-destructive-solid is darker than the
   * tint base. The tint base would measure 3.99, but the two roles already
   * paint the same dot in light mode, so moving it would erase the
   * tint-to-solid escalation in dark as well. Left as it is, and written
   * down here rather than left to be rediscovered.
   */
  dot: string;
  /**
   * Glyph colour when the marker is drawn with no fill behind it, as the
   * compact job badge does. Same reasoning and same values as `dot`, as a
   * text colour rather than a fill. Spelled out rather than rewritten from
   * `dot` at runtime: deriving one class from another by string surgery is
   * what produced the invisible failure dot in the first place.
   */
  onSurface: string;
}

/**
 * Two questions decide the role: who owes the next move, and is this a fault.
 * They are separate axes, so `action` (you are blocked and only you can
 * unblock it) is not the same role as `problem` (something went wrong and it
 * may still resolve without you).
 *
 * Fault severity is the third channel, after hue and glyph: `problem` is a red
 * tint, `failure` is the solid red. That escalation needs no extra hue, which
 * matters because the warm arc is already full at amber and red. It also
 * matches how the risk tiers escalate.
 *
 * The escalation lives in the fill only. `--semantic-destructive` and
 * `--semantic-destructive-solid` hold the same value in light mode, so the
 * two roles paint the same `dot` and the same `onSurface` there. In light
 * mode a caller that shows a mark with no fill therefore separates the two by
 * glyph, not by colour. In dark mode the two values differ, so colour still
 * separates them there.
 *
 * The two waiting roles are split by who is holding the task, not by what
 * stage it is at, because that is the only difference the reader can act on:
 * `working` means wait for us, `external` means wait for someone else.
 */
export const STATUS_ROLE_STYLES: Record<StatusRole, RoleStyle> = {
  inert: {
    bg: "bg-quaternary",
    text: "text-foreground",
    marker: "text-status-done",
    dot: "bg-status-done",
    onSurface: "text-status-done",
  },
  working: {
    bg: "bg-status-working-quaternary",
    text: "text-status-working-label",
    marker: "text-status-working",
    dot: "bg-status-working",
    onSurface: "text-status-working",
  },
  external: {
    bg: "bg-status-external-quaternary",
    text: "text-status-external-label",
    marker: "text-status-external",
    dot: "bg-status-external",
    onSurface: "text-status-external",
  },
  action: {
    bg: "bg-semantic-warning-quaternary",
    text: "text-semantic-warning-label",
    marker: "text-semantic-warning",
    dot: "bg-semantic-warning",
    onSurface: "text-semantic-warning",
  },
  problem: {
    bg: "bg-semantic-destructive-quaternary",
    text: "text-semantic-destructive-label",
    marker: "text-semantic-destructive",
    dot: "bg-semantic-destructive",
    onSurface: "text-semantic-destructive",
  },
  failure: {
    bg: "bg-semantic-destructive-solid",
    text: "text-semantic-destructive-foreground",
    marker: "text-semantic-destructive-foreground",
    dot: "bg-semantic-destructive-solid",
    onSurface: "text-semantic-destructive-solid",
  },
  success: {
    bg: "bg-semantic-success-quaternary",
    text: "text-semantic-success-label",
    marker: "text-semantic-success",
    dot: "bg-semantic-success",
    onSurface: "text-semantic-success",
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
  tone,
  live = true,
}: {
  spec: StatusMarkerSpec;
  /**
   * Colour class for the glyph, replacing the role's own. Callers that paint
   * the glyph on something other than its fill pass their own colour here.
   *
   * It replaces rather than adds so the glyph has exactly one colour class in
   * the markup. `cn` would in fact resolve a duplicate, because tailwind-merge
   * keeps the last class of the text-colour group and drops the earlier ones,
   * but that is a property of the merge helper rather than of CSS: the same
   * two classes on a plain `className` would be settled by stylesheet order.
   * One value, named, is what makes the override readable at the call site.
   */
  tone?: string;
  /**
   * Whether the glyph stands for something happening right now.
   *
   * The spin is the only part of a marker that makes a claim about time: it
   * says the work is in flight as you read it. That claim is false in a
   * history row, where the status is a value someone set hours ago, and in a
   * menu row, where the status is an option nobody has chosen. Those callers
   * pass `false` and get the same glyph, held still.
   */
  live?: boolean;
}) {
  const Icon = spec.icon;
  return (
    <Icon
      aria-hidden
      // 14px, not 12px, and a heavier stroke. A light stroke on a dark ground
      // erodes optically, so the dark glyph read as missing even though it
      // measured 3.59 to 6.65 against its own fill, above the light side's
      // floor of 3.18. Only the floor: light external reaches 7.04, past the
      // dark ceiling.
      strokeWidth={2.25}
      className={cn(
        "size-3.5 shrink-0",
        tone ?? STATUS_ROLE_STYLES[spec.role].marker,
        spec.spin && live && "animate-spin motion-reduce:animate-none",
      )}
    />
  );
}
