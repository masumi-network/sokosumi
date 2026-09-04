"use client";

import {
  Bell,
  type LucideIcon,
  Mail,
  MailClock,
  Smartphone,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CHANNEL_SPECS,
  PUSH_BLOCK_HINT_KEY,
  type PushBlock,
  type StoredChannel,
  sameChannels,
} from "./notification-delivery";
import type { KindChoice } from "./use-notification-delivery";

const CELL =
  "focus-visible:ring-ring/50 flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-[3px]";
const CELL_ON = "border-primary bg-primary text-primary-foreground";
const CELL_OFF =
  "text-muted-foreground border-input hover:bg-accent hover:text-accent-foreground";
/**
 * Nothing to press, and the lightest of the three: a filled cell is on, an
 * outlined one is off, and this one carries no box at all. A border here would
 * make the one cell that cannot be pressed the most drawn of the row.
 */
const CELL_DEAD = "text-muted-foreground/45 cursor-default border-transparent";

/**
 * The face of each channel in the grid.
 *
 * Written out per channel rather than carried on `CHANNEL_SPECS`, which the
 * model owns and no icon library should reach into. A channel Core adds later
 * has no icon here and fails to build, which is the loud half of the guard;
 * the specs carry the other half in a comment, since a plain array cannot
 * check itself.
 */
const CHANNEL_ICON: Record<StoredChannel, LucideIcon> = {
  IN_APP: Bell,
  OS_BANNER: Smartphone,
};

/** An account switch, as a row needs it. */
export interface EmailChoice {
  enabled: boolean;
  /** A write is in flight. The cell stays reachable, and does nothing. */
  saving: boolean;
  onChange: (next: boolean) => void;
}

/** A column's name, sized to sit over its cells. */
function ColumnHead({ children }: { children: ReactNode }) {
  return (
    <span className="text-muted-foreground w-9 shrink-0 text-center text-xs">
      {children}
    </span>
  );
}

/**
 * The names of the columns, in the order the cells are drawn.
 *
 * Hidden from the accessibility tree wherever it is used: every cell names its
 * own channel, so a reader hears these words from the control rather than
 * twice more as loose text above it.
 */
export function ColumnHeads() {
  const t = useTranslations("App.Account.Notifications");

  return (
    <>
      {CHANNEL_SPECS.map((spec) => (
        <ColumnHead key={spec.id}>{t(spec.labelKey)}</ColumnHead>
      ))}
      <ColumnHead>{t("channelEmail")}</ColumnHead>
    </>
  );
}

/**
 * The columns, named once for the whole card.
 *
 * Every row right-aligns its cells into the same column, so one line of names
 * covers all of them. Repeated over each group they read as a stray line of
 * small text, and each copy pushed the block under it down by its own height.
 *
 * The names sit on their line's floor: a channel whose name wraps in one
 * language would otherwise lift its own column, and the heads would read on
 * two lines of sight.
 */
export function ColumnHeadRow() {
  return (
    <div
      aria-hidden="true"
      className="hidden items-end justify-end gap-2 px-4 pt-3 pb-2 sm:flex"
    >
      <ColumnHeads />
    </div>
  );
}

/**
 * A cell with nothing to press, and a reason a reader can reach.
 *
 * Kept in the row rather than dropped, so the column has no hole in it and the
 * row still says what that channel would mean here. The reason opens on hover
 * and on focus, and it is the cell's own description, because a native title
 * waits a second, never opens on a phone, and never opens on focus.
 */
export function DeadCell({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  const hintId = useId();

  return (
    <>
      <Tooltip>
        {/* Stays in the tab order. A reader who never uses a mouse would
            otherwise pass the row and never learn that this channel is one of
            the places a notification can reach them. */}
        <TooltipTrigger
          type="button"
          aria-disabled="true"
          aria-label={label}
          aria-describedby={hintId}
          className={cn(CELL, CELL_DEAD)}
        >
          <Icon className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
      {/* Hidden from the tree and still read: a description is computed from
          the element it points at, whether or not that element is in the tree.
          Left in it, the row reads the same sentence twice. */}
      <span aria-hidden="true" id={hintId} className="sr-only">
        {hint}
      </span>
    </>
  );
}

/**
 * Every channel of the matrix, on a row that none of them carries.
 *
 * Derived from the same list the heads are, so a channel Core adds later gets
 * a cell here rather than a head with nothing under it.
 */
export function UnusedChannelCells({ kind }: { kind: string }) {
  const t = useTranslations("App.Account.Notifications");

  return (
    <>
      {CHANNEL_SPECS.map((spec) => (
        <DeadCell
          key={spec.id}
          icon={CHANNEL_ICON[spec.id]}
          label={t("channelUnavailableLabel", {
            channel: t(spec.labelKey),
            kind,
          })}
          hint={t("marketingEmailOnlyHint")}
        />
      ))}
    </>
  );
}

/**
 * Email on one row.
 *
 * What it writes is an account switch rather than a cell of the matrix, so one
 * value can sit on more than one row: both job rows hold the job emails and
 * move together. The cell says that in its own description rather than leaving
 * the reader to discover it by pressing.
 *
 * It does not speak what it wrote. The write behind it raises a toast, and the
 * toast names the account switch that moved, which is the fact a reader on a
 * shared value needs. Said here as well, one press would be announced twice in
 * two wordings. The channel cells still speak, because a press there moves the
 * sibling cell beside it, and no toast reports where the kind arrives now.
 */
export function EmailCell({
  name,
  hint,
  describedById,
  email,
}: {
  /**
   * What a reader hears instead of the icon. Given whole rather than composed
   * here: on a row whose own name is already about email, "Email for Marketing
   * emails" is the name that composing produces.
   */
  name: string;
  /**
   * What the switch reaches, when the row does not already say it on screen.
   * Shown as a tooltip and read as the description.
   */
  hint?: string;
  /**
   * The row's own visible sentence, for a row that already carries one. The
   * cell describes itself with that element rather than repeating it, and a
   * cell with neither would be the only one in the grid a reader meets
   * undescribed.
   */
  describedById?: string;
  email: EmailChoice;
}) {
  const ownHintId = useId();
  const describedBy = hint ? ownHintId : describedById;

  const button = (
    <button
      type="button"
      aria-pressed={email.enabled}
      aria-disabled={email.saving || undefined}
      // The name has to differ per row, or two cells on one value answer
      // to one name. What that shared value reaches is said in the
      // description instead.
      aria-label={name}
      aria-describedby={describedBy}
      onClick={() => {
        if (email.saving) {
          return;
        }

        email.onChange(!email.enabled);
      }}
      className={cn(
        CELL,
        email.saving && "opacity-50",
        email.enabled ? CELL_ON : CELL_OFF,
      )}
    >
      <Mail className="size-4" aria-hidden="true" />
    </button>
  );

  // Wrapped only when there is something to show. A trigger with no content
  // still points its description at the content's id, so a bare wrapper leaves
  // the cell describing an element that was never rendered.
  if (!hint) {
    return button;
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
      <span aria-hidden="true" id={ownHintId} className="sr-only">
        {hint}
      </span>
    </>
  );
}

/**
 * Where one kind arrives, one cell per channel.
 *
 * A cell is its own answer, because a channel is a place rather than a step.
 * Nothing on means the kind does not arrive, so there is no separate cell that
 * says off. Turning a push on turns the in-app entry on with it, so on every
 * kind the feed carries, a push leaves something the reader can find again.
 *
 * That pairing is why the row carries a live region. The cells read as
 * independent, and pressing one of them moves the other, which a reader who
 * cannot see the row would otherwise never learn. So every change says where
 * the kind now arrives, once, in the reader's own words.
 */
function KindCells({
  kind,
  email,
  pushBlock,
  onToggle,
}: {
  kind: KindChoice;
  email: EmailChoice;
  pushBlock: PushBlock | null;
  onToggle: (channel: StoredChannel, on: boolean) => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  const { channels, saving } = kind;
  const label = t(kind.spec.labelKey);
  const pushHintId = useId();

  // What this browser can do with a push, when it cannot do the usual thing.
  // The cell writes the account rather than the browser, so it keeps working:
  // it is the reader's only way to silence or wake the devices that can push.
  // What changes is what the cell says.
  //
  // Three parts, in the order a reader needs them: what the column is for,
  // why it will not happen here and what would change that, and that the press
  // still counts elsewhere. The first is kept rather than replaced, or a
  // reader who meets Push on a blocked browser never learns what the column
  // would have done.
  const pushHint = pushBlock
    ? [
        t("channelPushHint"),
        t(PUSH_BLOCK_HINT_KEY[pushBlock]),
        t("pushOtherDevicesHint"),
      ].join(" ")
    : null;

  // Silent until the reader presses something in this row, so opening a group
  // does not read its rows out. Silent again until that press lands, because
  // `channels` still holds what the row said before it: turning a push on
  // waits on the account consent, which waits on a person, and a region that
  // spoke on the press would read out the state the reader changed away from.
  //
  // Said once, by an effect that clears the flag. A group preset writes every
  // row at once under its own control, so a row that spoke again on someone
  // else's write would report one row of three as if it were all that moved.
  //
  // The channels it spoke about are kept beside the words. A write from
  // anywhere else then takes the sentence back down, because a region only
  // speaks when its text changes: leaving the old sentence up would both
  // contradict the cells and silence the next press that lands on the same
  // channels, which is exactly the press that pulls its sibling along.
  const [arrival, setArrival] = useState<{
    channels: readonly StoredChannel[];
    text: string;
  } | null>(null);
  const [awaiting, setAwaiting] = useState(false);

  useEffect(() => {
    if (awaiting) {
      if (saving) {
        return;
      }

      const on = CHANNEL_SPECS.filter((spec) => channels.includes(spec.id)).map(
        (spec) => t(spec.labelKey),
      );

      setAwaiting(false);
      setArrival({
        channels,
        text: t("channelsAnnounce", {
          kind: label,
          channels: on.length > 0 ? on.join(", ") : t("channelsNone"),
        }),
      });
      return;
    }

    if (arrival && !sameChannels(arrival.channels, channels)) {
      setArrival(null);
    }
  }, [arrival, awaiting, saving, channels, label, t]);

  return (
    <div
      role="group"
      aria-label={t("deliveryAriaLabel", { kind: label })}
      className="flex shrink-0 items-center justify-end gap-2"
    >
      {CHANNEL_SPECS.map((spec) => {
        const pressed = channels.includes(spec.id);
        const Icon = CHANNEL_ICON[spec.id];
        const blocked = spec.id === "OS_BANNER" && pushHint !== null;

        return (
          <Tooltip key={spec.id}>
            <TooltipTrigger
              type="button"
              aria-pressed={pressed}
              aria-disabled={saving || undefined}
              aria-label={t("channelCellLabel", {
                channel: t(spec.labelKey),
                kind: label,
              })}
              // Spread rather than set to undefined. The trigger writes its
              // own `aria-describedby` for the tooltip, and this prop is
              // applied over it: an undefined here deletes it, and every cell
              // that is not blocked loses the one sentence that says what its
              // column means to a reader who cannot see the tooltip.
              {...(blocked ? { "aria-describedby": pushHintId } : {})}
              onClick={() => {
                if (saving) {
                  return;
                }

                setAwaiting(true);
                onToggle(spec.id, !pressed);
              }}
              className={cn(
                CELL,
                saving && "opacity-50",
                pressed ? CELL_ON : CELL_OFF,
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>
              {blocked ? pushHint : t(spec.hintKey)}
            </TooltipContent>
          </Tooltip>
        );
      })}
      {/* Hidden from the tree and still read, the way a dead cell carries its
          own reason. */}
      {pushHint ? (
        <span aria-hidden="true" id={pushHintId} className="sr-only">
          {pushHint}
        </span>
      ) : null}
      {kind.spec.email ? (
        <EmailCell
          name={t("channelCellLabel", {
            channel: t("channelEmail"),
            kind: label,
          })}
          hint={t("channelEmailHint")}
          email={email}
        />
      ) : (
        <DeadCell
          icon={MailClock}
          label={t("channelEmailSoonLabel", { kind: label })}
          hint={t("channelEmailSoonHint")}
        />
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {arrival?.text ?? ""}
      </span>
    </div>
  );
}

/**
 * One group's kinds against the channels they can arrive on.
 *
 * Columns, because the question a reader arrives with is where a kind reaches
 * them, and a column answers it down the whole group at once. Every row
 * carries every channel, so a reader compares along a row as well as down a
 * column, and no kind's answer sits somewhere else.
 *
 * `showNames` is off for a group of one kind, whose name is already the row
 * the grid sits in.
 */
export function ChannelGrid({
  kinds,
  email,
  pushBlock,
  showNames,
  onToggle,
}: {
  kinds: readonly KindChoice[];
  email: EmailChoice;
  pushBlock: PushBlock | null;
  showNames: boolean;
  onToggle: (kind: KindChoice, channel: StoredChannel, on: boolean) => void;
}) {
  const t = useTranslations("App.Account.Notifications");

  return (
    <div>
      {/* Only where the row breaks in two. The card names its columns once
          at the top and every row right-aligns its cells under those names,
          so a second set here would be the same words a few lines lower.
          Below `sm` the name and the cells sit on separate lines and the
          card's own heads are a whole block away, so the cells bring their
          heads with them. */}
      {showNames ? null : (
        <div
          aria-hidden="true"
          className="flex items-end justify-end gap-2 pb-1 sm:hidden"
        >
          <ColumnHeads />
        </div>
      )}
      <div className={cn(showNames && "divide-y")}>
        {kinds.map((kind) => (
          // Stacked on a narrow screen, where three cells and a name that
          // wraps would leave the name about 70px wide. The cells keep the
          // right edge either way, so they stay under their own heads.
          <div
            key={kind.spec.category}
            className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-end sm:gap-2"
          >
            {showNames ? (
              <div className="min-w-0 pr-3 pl-6 break-words sm:flex-1 sm:pl-10">
                <p className="text-sm leading-5">{t(kind.spec.labelKey)}</p>
                <p className="text-muted-foreground text-sm leading-5">
                  {t(kind.spec.hintKey)}
                </p>
              </div>
            ) : null}
            {showNames ? (
              <div
                aria-hidden="true"
                className="flex items-end justify-end gap-2 sm:hidden"
              >
                <ColumnHeads />
              </div>
            ) : null}
            <KindCells
              kind={kind}
              email={email}
              pushBlock={pushBlock}
              onToggle={(channel, on) => {
                onToggle(kind, channel, on);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
