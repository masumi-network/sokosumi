import {
  Ban,
  BadgeCheck,
  Check,
  CircleAlert,
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
 * The Masumi Family guide (5.2) sets the colours: done is a green check,
 * input required a yellow !, a fault the Neutral 950 X, and in progress is
 * Iris, the brand's active state. Those three colours measure 2.00, 1.44 and
 * 2.67:1 on white, so none of them is ever text or a bare glyph: each is a
 * disc behind a Neutral 950 glyph (`disc` below). The chip around a status is
 * neutral and its label is plain text, so colour never carries the status
 * alone.
 *
 * Three rules, in order:
 *
 * 1. The hue follows the column. `task-column.ts` owns that grouping. Only
 *    three columns get a guide colour; todo, backlog and a fault are
 *    neutral, and their glyphs tell them apart.
 * 2. Weight is the status inside the column: `filled` is the column's
 *    ordinary state, `outline` the variant, a box with a hole in it.
 * 3. A fault leaves its column. Anything wrong is `fault`, wherever the board
 *    files it, so a failing job does not go quiet because it happens to sit
 *    under in-progress.
 *
 * `solid` is the escalation inside `fault` only: an outlined X says it may
 * still resolve, the solid chip says it did not.
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
 * How much of the chip the status spends.
 *
 * `outline` is not "disabled". It is the second status in a column that only
 * has two. Only the fill is dropped.
 */
export type StatusWeight = "filled" | "outline" | "solid";

/**
 * A hue and the weight it is spent at.
 *
 * `solid` is paired with `fault` in the type, not merely by convention,
 * because `getToneStyle` returns the solid classes before it ever reads the
 * hue. Written as a union, `{ hue: "resolved", weight: "solid" }` does not
 * compile.
 */
export type StatusTone =
  | { hue: StatusHue; weight: Exclude<StatusWeight, "solid"> }
  | { hue: "fault"; weight: Extract<StatusWeight, "solid"> };

interface HueClasses {
  /** Glyph colour. On a disc it is the disc's own foreground. */
  mark: string;
  /** The colour fill behind the glyph, for the hues the guide colours. */
  disc?: string;
}

const HUE_CLASSES: Record<StatusHue, HueClasses> = {
  dormant: { mark: "text-status-done" },
  staged: { mark: "text-status-external" },
  active: { mark: "text-primary-foreground", disc: "bg-status-working" },
  blocked: {
    mark: "text-semantic-warning-foreground",
    disc: "bg-semantic-warning",
  },
  resolved: {
    mark: "text-semantic-success-foreground",
    disc: "bg-semantic-success",
  },
  fault: { mark: "text-semantic-destructive" },
};

const CHIP = {
  filled: "bg-muted border-border",
  outline: "bg-transparent border-border",
  solid: "bg-semantic-destructive-solid border-transparent",
} as const;

/** `text-*` to `bg-*`, for a dot in the glyph's colour. */
function asFill(markClass: string): string {
  return markClass.replace(/^text-/, "bg-");
}

export interface ToneStyle {
  /** Fill and border for the chip. */
  box: string;
  /** Label colour for text sitting on `box`. */
  label: string;
  /** Glyph colour for a mark sitting on `box`. */
  mark: string;
  /** The colour disc behind the glyph, when the hue has one. */
  disc?: string;
  /** Dot fill for a mark drawn on the card rather than in a chip. */
  dot: string;
  /** Glyph colour for a mark drawn on the card rather than in a chip. */
  onSurface: string;
}

/**
 * Resolves a tone to classes.
 *
 * A dot takes the disc colour when there is one. Such a dot always sits next
 * to the status word, which carries the status, so it is not the graphic SC
 * 1.4.11 measures. Every mark without a disc clears 3:1 on its own.
 */
export function getToneStyle(tone: StatusTone): ToneStyle {
  if (tone.weight === "solid") {
    return {
      box: CHIP.solid,
      label: "text-semantic-destructive-foreground",
      mark: "text-semantic-destructive-foreground",
      dot: asFill(HUE_CLASSES.fault.mark),
      onSurface: HUE_CLASSES.fault.mark,
    };
  }

  const hue = HUE_CLASSES[tone.hue];

  return {
    box: CHIP[tone.weight],
    label: "text-foreground",
    mark: hue.mark,
    disc: hue.disc,
    dot: hue.disc ?? asFill(hue.mark),
    // Off its disc a glyph cannot keep the disc's Neutral 950: in dark it
    // would vanish into the card.
    onSurface: hue.disc ? "text-foreground" : hue.mark,
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
  // The disc is the circle, so the glyph is the bare check.
  completed: Check,
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
   *
   * A glyph on a disc ignores it: it always takes the disc's foreground.
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
  const spinning = spec.spin && live && "animate-spin motion-reduce:animate-none";

  if (style.disc) {
    // The glyph keeps its 14px box; the disc is the box and the glyph shrinks
    // inside it, always in the disc's own Neutral 950.
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full",
          style.disc,
        )}
      >
        <Icon
          strokeWidth={2.75}
          className={cn("size-2.5", style.mark, spinning)}
        />
      </span>
    );
  }

  return (
    <Icon
      aria-hidden
      // 14px, not 12px, and a heavier stroke. A light stroke on a dark ground
      // erodes optically, so the dark glyph read as missing even though it
      // measured above the light side's floor.
      strokeWidth={2.25}
      className={cn(
        "size-3.5 shrink-0 transition-colors duration-200",
        tone ?? style.mark,
        spinning,
      )}
    />
  );
}
