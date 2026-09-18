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
 * Hue says where the work sits on the board. Weight says which status it is
 * inside that column. The glyph names the exact one.
 *
 * The system this replaces asked hue to answer "who owes the next move". That
 * read well on paper and failed on screen, because the board groups by stage
 * and the badge grouped by obligation, so the two disagreed in front of the
 * reader. Four task statuses shared one hue across three different columns:
 * `QUEUED`, `READY`, `CREDITS_TOPPED_UP` and `RUNNING` were all the same
 * magenta, and `QUEUED` wore it inside a grey backlog column. The board is
 * what the reader is looking at, so the board wins.
 *
 * Three rules, in order:
 *
 * 1. Hue is the column. `task-column.ts` owns that grouping and this table
 *    follows it.
 * 2. Weight is the status inside the column. `filled` is the column's
 *    ordinary state, `outline` the variant. Across the tones in use the two
 *    measure 7.04 to 15.96 OKLab dE apart, the floor being `blocked` in
 *    light after the hue rotation; a box with a hole in it is a second cue
 *    on top of that. The cue is the shape, not the border's contrast: every
 *    `-tertiary` border measures 1.37 to 2.42 against --card-background, under
 *    the 3:1 SC 1.4.11 asks of a boundary, which is a property of the whole
 *    ramp rather than of this scale (--border itself is 1.24). Nothing rests
 *    on it: the glyph and the word carry the status, and both clear their
 *    floors. Two tints of one hue were tried first and rejected: warning
 *    quaternary against quinary came to 4.06, under the 6.0 that reads as
 *    comfortably separate.
 * 3. A fault leaves its column. Anything wrong is `fault`, wherever the board
 *    files it, so a failing job does not go quiet because it happens to sit
 *    under in-progress.
 *
 * `solid` is the escalation inside `fault` only: a tint says it may still
 * resolve, the solid says it did not.
 */
export type StatusHue =
  /** Nothing is moving: a draft, a queued item, a case already closed. */
  | "dormant"
  /** Staged and waiting to start. The `todo` column. */
  | "staged"
  /** Running now, or held mid-flight. The `in-progress` column. */
  | "active"
  /** Nothing proceeds until someone answers. The `input-required` column. */
  | "blocked"
  /** There is a result to read. */
  | "resolved"
  /** Something is wrong. Overrides the column it sits in. */
  | "fault";

/**
 * How much of the hue the badge spends.
 *
 * `outline` is not "disabled". It is the second status in a column that only
 * has two, and it carries the same hue at the same strength in its dot and
 * its label. Only the fill is dropped.
 */
export type StatusWeight = "filled" | "outline" | "solid";

/**
 * A hue and the weight it is spent at.
 *
 * `solid` is paired with `fault` in the type, not merely by convention,
 * because `getToneStyle` returns the solid classes before it ever reads the
 * hue. A `{ hue: "resolved", weight: "solid" }` would therefore render a
 * destructive-red badge for a success, and nothing at runtime would object.
 * Written as a union, that combination does not compile.
 */
export type StatusTone =
  | { hue: StatusHue; weight: Exclude<StatusWeight, "solid"> }
  | { hue: "fault"; weight: Extract<StatusWeight, "solid"> };

interface HueClasses {
  /** Badge fill for `filled`. */
  fill: string;
  /** Badge border for `outline`. */
  border: string;
  /** Label colour. Clears 4.5:1 on both the fill and the card, both themes. */
  label: string;
  /**
   * Dot and glyph colour. Clears 3:1 on the fill and on `--card-background`
   * in both themes, with one exception carried over from before this scale.
   *
   * Two surfaces in dark are lighter than the card and take it under: the
   * agent job list row's `--muted` hover (`jobs-list.tsx`) and cmdk's
   * `--accent` selected row, which hold the same value. There the dark
   * `fault` mark measures 2.53:1, because
   * `--semantic-destructive-solid` is darker than the tint base. The tint
   * base would measure 3.99, but the two weights already paint the same dot
   * in light mode, so moving it would erase the tint-to-solid escalation in
   * dark as well. Left as it is and written down rather than rediscovered.
   *
   * The note this replaces put that figure at 2.78:1. Neither token has
   * moved since it was written, so 2.78 was simply miscomputed; 2.53 is the
   * ratio the shipped values give.
   */
  mark: string;
}

/**
 * Six hues, one per column plus the fault override. Every value already
 * shipped except `--status-external-tertiary`, added with this change so the
 * staged column can draw an outline.
 *
 * `dormant` takes its label from `--foreground` because the grey ramp has no
 * `-label` step and does not need one: grey text on a grey tint measures
 * 15.83:1 in light and 12.28:1 in dark.
 */
const HUE_CLASSES: Record<StatusHue, HueClasses> = {
  dormant: {
    fill: "bg-status-done-quaternary",
    border: "border-status-done-tertiary",
    label: "text-foreground",
    mark: "bg-status-done",
  },
  staged: {
    fill: "bg-status-external-quaternary",
    border: "border-status-external-tertiary",
    label: "text-status-external-label",
    mark: "bg-status-external",
  },
  active: {
    fill: "bg-status-working-quaternary",
    border: "border-status-working-tertiary",
    label: "text-status-working-label",
    mark: "bg-status-working",
  },
  blocked: {
    fill: "bg-semantic-warning-quaternary",
    border: "border-semantic-warning-tertiary",
    label: "text-semantic-warning-label",
    mark: "bg-semantic-warning",
  },
  resolved: {
    fill: "bg-semantic-success-quaternary",
    border: "border-semantic-success-tertiary",
    label: "text-semantic-success-label",
    mark: "bg-semantic-success",
  },
  fault: {
    fill: "bg-semantic-destructive-quaternary",
    border: "border-semantic-destructive-tertiary",
    label: "text-semantic-destructive-label",
    mark: "bg-semantic-destructive",
  },
};

/** The `solid` escalation. Only `fault` uses it. */
const SOLID_CLASSES = {
  fill: "bg-semantic-destructive-solid",
  label: "text-semantic-destructive-foreground",
  mark: "bg-semantic-destructive-solid",
} as const;

/** `bg-*` to `text-*`, for the callers that paint the mark as a glyph. */
function asText(markClass: string): string {
  return markClass.replace(/^bg-/, "text-");
}

export interface ToneStyle {
  /** Fill and border for the badge box. */
  box: string;
  /** Label colour for text sitting on `box`. */
  label: string;
  /** Glyph or dot colour for a mark sitting on `box`. */
  mark: string;
  /**
   * Label colour for text with no box behind it, on `--card-background`.
   *
   * It differs from `label` for `solid` only: a solid badge labels itself in
   * near-white, which measures 1.06:1 on the card. The fault tint's label is
   * the readable form of the same hue, at 6.28:1 in light and 5.61:1 in dark.
   */
  labelOnSurface: string;
  /** Dot fill for a mark painted on the card rather than on `box`. */
  dot: string;
  /** The same colour as `dot`, as a text colour, for a glyph on the card. */
  onSurface: string;
}

/**
 * Resolves a tone to classes.
 *
 * The on-box pair and the on-card pair are separate because for `solid` they
 * are different colours and always were. A solid badge paints its glyph in
 * near-white, the colour of its own label; a bare dot for the same status has
 * no fill under it and must be the solid red instead. Deriving one from the
 * other is what once produced a near-white dot on a white card measuring
 * 1.06:1, so they are resolved side by side here and the test file pins both.
 *
 * An `outline` tone paints no fill, so its mark sits on whatever surface the
 * caller provides, and `--card-background` is what the marks are measured
 * against. A caller that paints a different surface has to check its own: the
 * job list row's `--muted` hover and the command menu's `--accent` selected
 * row are both lighter than the card in dark, and the fault mark measures
 * 2.53:1 on either. See the note on `mark` above. The status picker passes
 * `labelOnSurface` for exactly that reason.
 */
export function getToneStyle(tone: StatusTone): ToneStyle {
  if (tone.weight === "solid") {
    return {
      box: `${SOLID_CLASSES.fill} border-transparent`,
      label: SOLID_CLASSES.label,
      mark: SOLID_CLASSES.label,
      labelOnSurface: HUE_CLASSES.fault.label,
      dot: SOLID_CLASSES.mark,
      onSurface: asText(SOLID_CLASSES.mark),
    };
  }

  const hue = HUE_CLASSES[tone.hue];

  return {
    box:
      tone.weight === "outline"
        ? `bg-transparent ${hue.border}`
        : `${hue.fill} border-transparent`,
    label: hue.label,
    mark: asText(hue.mark),
    labelOnSurface: hue.label,
    dot: hue.mark,
    onSurface: asText(hue.mark),
  };
}

export interface StatusMarkerSpec {
  tone: StatusTone;
  icon: LucideIcon;
  /** Only the running glyph spins, and only where the work is live. */
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
   * Colour class for the glyph, replacing the tone's own. Callers that paint
   * the glyph on something other than its own fill pass their own colour.
   *
   * It replaces rather than adds so the glyph has exactly one colour class in
   * the markup. `cn` would in fact resolve a duplicate, because tailwind-merge
   * keeps the last class of the text-colour group, but that is a property of
   * the merge helper rather than of CSS: the same two classes on a plain
   * `className` would be settled by stylesheet order.
   */
  tone?: string;
  /**
   * Whether the glyph stands for something happening right now. It gates the
   * spin and nothing else.
   *
   * A stopped `LoaderCircle` is an arc with a gap in it and nothing else: the
   * whole glyph means motion, so at rest it reads as a rendering fault rather
   * than as a status. That is a reason to keep the spinning glyph off surfaces
   * that are not live, not a reason to drop every glyph there.
   *
   * A menu of statuses you could pick needs the glyph most of all: five of
   * them share the `blocked` hue, so without it the rows differ by word alone
   * and the marker column is five identical dots. A surface that genuinely
   * wants a dot draws its own (`TaskStatusInline`) from `dot` below.
   */
  live?: boolean;
}) {
  const style = getToneStyle(spec.tone);
  const Icon = spec.icon;

  return (
    <Icon
      aria-hidden
      // 14px, not 12px, and a heavier stroke. A light stroke on a dark ground
      // erodes optically, so the dark glyph read as missing even though it
      // measured above the light side's floor.
      strokeWidth={2.25}
      className={cn(
        "size-3.5 shrink-0",
        tone ?? style.mark,
        spec.spin && live && "animate-spin motion-reduce:animate-none",
      )}
    />
  );
}
