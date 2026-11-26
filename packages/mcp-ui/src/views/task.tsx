import {
  BadgeCheck,
  CalendarCheck,
  CalendarX,
  Check,
  CirclePlay,
  CirclePlus,
  CircleSlash,
  CircleX,
  Clock,
  Hourglass,
  KeyRound,
  LoaderCircle,
  type LucideIcon,
  MessageSquareWarning,
  PencilLine,
  ShieldAlert,
  UserRound,
  Wallet,
} from "lucide-react";
import { z } from "zod";
import type { ViewContext } from "../shell/Shell.tsx";
import {
  formatDay,
  isMessageKey,
  isOverdue,
  isUnderBase,
  t,
} from "../shell/text.ts";

/** What the Task views share: the assignee, status, priority, due day and the Web link. */

const Named = z.object({ name: z.string() }).nullish();

/** A Task's assignee, or an event's actor: one of a person, a Coworker or a Soko Bot. */
export const Party = z
  .object({ user: Named, coworker: Named, sokoBot: Named })
  .partial()
  .nullish();
export type Party = z.infer<typeof Party>;

export function partyName(party: Party): string | undefined {
  const { user, coworker, sokoBot } = party ?? {};
  return (user ?? coworker ?? sokoBot)?.name;
}

/** Up to two letters: the first of the first and last words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word?: string) => (word ? Array.from(word)[0] : "");
  const letters =
    words.length > 1 ? first(words[0]) + first(words.at(-1)) : first(words[0]);
  return letters.toUpperCase();
}

/** Web's word for a Task status, if it is one this package knows. */
export function statusWord(status: string): string | undefined {
  const key = `task.status.${status}`;
  return isMessageKey(key) ? t(key) : undefined;
}

/**
 * The Task's Web page. Web resolves a Task by id in any workspace the person
 * can open; an identifier resolves only in the active one (apps/web task-href.ts).
 */
export function taskWebUrl(id: string, base?: string): string | undefined {
  if (!base) return undefined;
  const url = `${base.replace(/\/$/, "")}/tasks/${encodeURIComponent(id)}`;
  return isUnderBase(url, base) ? url : undefined;
}

/**
 * Web's status marker (apps/web/src/components/ui/status-marker.tsx): the
 * hue says the board column, the glyph the exact status. Iris, yellow and
 * green are discs behind a Neutral 950 glyph, never bare ink.
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
} as const;

type Marker = {
  icon: LucideIcon;
  hue: keyof typeof DISC | keyof typeof INK;
  spin?: boolean;
};

/** Web's task-status-badge.tsx table. */
const MARKERS: Record<string, Marker> = {
  DRAFT: { icon: PencilLine, hue: "dormant" },
  QUEUED: { icon: Clock, hue: "staged" },
  READY: { icon: CirclePlay, hue: "staged" },
  CREDITS_TOPPED_UP: { icon: CirclePlus, hue: "staged" },
  RUNNING: { icon: LoaderCircle, hue: "active", spin: true },
  AWAITING_EXTERNAL: { icon: Hourglass, hue: "active" },
  GRANT_PENDING: { icon: ShieldAlert, hue: "blocked" },
  INPUT_REQUIRED: { icon: MessageSquareWarning, hue: "blocked" },
  APPROVAL_REQUIRED: { icon: BadgeCheck, hue: "blocked" },
  AUTHENTICATION_REQUIRED: { icon: KeyRound, hue: "blocked" },
  OUT_OF_CREDITS: { icon: Wallet, hue: "blocked" },
  COMPLETED: { icon: Check, hue: "resolved" },
  FAILED: { icon: CircleX, hue: "fault" },
  CANCELED: { icon: CircleSlash, hue: "dormant" },
};
const UNKNOWN: Marker = { icon: Clock, hue: "dormant" };

/** The 14px status glyph, on its disc where the hue has one. */
export function StatusMarker({ status }: { status: string }) {
  const { icon: Icon, hue, spin } = MARKERS[status] ?? UNKNOWN;
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

/**
 * The marker and Web's word for the status. `quiet` drops the word where a
 * board column already names it; the marker then carries the name.
 */
export function TaskStatus({
  status,
  quiet = false,
  className = "text-xs",
}: {
  status: string;
  quiet?: boolean;
  className?: string;
}) {
  const word = statusWord(status) ?? status;
  return (
    <span
      role={quiet ? "img" : undefined}
      aria-label={quiet ? word : undefined}
      className={`text-foreground inline-flex min-w-0 items-center gap-1.5 font-medium ${className}`}
    >
      <StatusMarker status={status} />
      {!quiet && <span className="truncate">{word}</span>}
    </span>
  );
}

const PRIORITY_BARS = [
  { x: 2, y: 9, height: 4 },
  { x: 6.5, y: 6, height: 7 },
  { x: 11, y: 3, height: 10 },
];
const FILLED_BARS: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const URGENT_PATH =
  "M4 1h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3zM7.25 4h1.5v5h-1.5zM8 10.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z";

/** Web's priority glyph: one to three bars, or the "!" square for urgent. */
export function PriorityIcon({
  priority,
  className = "size-4",
}: {
  priority: string;
  className?: string;
}) {
  const key = `task.priority.${priority}`;
  if (!isMessageKey(key)) return null;
  const label = t("task.priority", { level: t(key) });
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      role="img"
      aria-label={label}
      className={`shrink-0 ${priority === "URGENT" ? "text-destructive" : ""} ${priority === "NONE" ? "text-muted-foreground" : ""} ${className}`}
    >
      {priority === "NONE" ? (
        [1.5, 6.5, 11.5].map((x) => (
          <rect key={x} x={x} y={7.25} width={3} height={1.5} rx={0.75} />
        ))
      ) : priority === "URGENT" ? (
        <path fillRule="evenodd" clipRule="evenodd" d={URGENT_PATH} />
      ) : (
        PRIORITY_BARS.map((bar, index) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={bar.y}
            width={2.5}
            height={bar.height}
            rx={0.75}
            opacity={index < (FILLED_BARS[priority] ?? 0) ? 1 : 0.3}
          />
        ))
      )}
    </svg>
  );
}

/**
 * Web's avatar with its initials fallback; no remote image (ADR 0083). No
 * name shows Web's empty person. `label` is for screen readers; without it
 * the avatar is decoration beside a name.
 */
export function Avatar({
  name,
  label,
  className = "size-5 text-2xs",
}: {
  name?: string;
  label?: string;
  className?: string;
}) {
  return (
    <span
      title={name}
      className={`bg-muted text-foreground flex shrink-0 items-center justify-center rounded-full font-medium ${className}`}
    >
      {name ? (
        <span aria-hidden="true">{initials(name)}</span>
      ) : (
        <UserRound
          aria-hidden="true"
          className="text-muted-foreground size-3.5"
        />
      )}
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Web's due badge: "Due Nov 28", or "Overdue · Nov 26" once the day has passed. */
export function DueDate({
  dueOn,
  status,
  context,
  className = "gap-1.5 text-xs",
}: {
  dueOn: string;
  status: string;
  context: Pick<ViewContext, "locale" | "timeZone">;
  className?: string;
}) {
  const overdue = isOverdue(dueOn, status, new Date(), context.timeZone);
  const Icon = overdue ? CalendarX : CalendarCheck;
  const date = formatDay(dueOn, context);
  return (
    <span
      className={`inline-flex min-w-0 items-center ${overdue ? "text-foreground font-medium" : "text-muted-foreground"} ${className}`}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <time dateTime={dueOn} className="truncate">
        {overdue ? t("task.overdue", { date }) : t("task.due", { date })}
      </time>
    </span>
  );
}
