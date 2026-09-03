"use client";

import {
  Bell,
  ChevronRight,
  type LucideIcon,
  Mail,
  MailClock,
  Smartphone,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CHANNEL_SPECS,
  presetChanges,
  type StoredChannel,
  sameChannels,
  withChannel,
} from "./notification-delivery";
import { PresetStops } from "./notification-presets";
import {
  type GroupChoice,
  type KindChoice,
  type NotificationDelivery,
  useNotificationDelivery,
} from "./use-notification-delivery";

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
const CELL_DEAD = "text-muted-foreground cursor-default border-transparent";

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

/** The account's one email switch, as a row needs it. */
interface EmailChoice {
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
 * Email on one kind's row.
 *
 * Drawn on every row, because a reader reads across a row rather than hunting
 * for the one control that sits elsewhere. What it writes is not per kind
 * though: Sokosumi mails job status through one account switch, so the two job
 * rows hold the same value and move together, and the cell carries that as its
 * own description rather than leaving it in a title, which a touch reader and
 * a keyboard reader never open.
 *
 * A kind Sokosumi does not mail yet keeps the cell and loses the press. Its
 * icon carries a clock, so the row says which cells are still waiting without
 * leaning on a colour or on a hover a finger never gets. Dropping the cell
 * would leave a hole in the column and say nothing about why.
 */
function EmailCell({ kind, email }: { kind: KindChoice; email: EmailChoice }) {
  const t = useTranslations("App.Account.Notifications");
  const label = t(kind.spec.labelKey);
  const hintId = useId();

  // One value behind two rows, so a press here moves the cell on the other job
  // row as well. Nothing on screen says that to a reader who cannot see it, so
  // this cell speaks, on the same terms as the channel cells beside it: only
  // the cell that was pressed, only once the write has landed, and the
  // sentence comes down again when the value moves under it.
  const [arrival, setArrival] = useState<{
    enabled: boolean;
    text: string;
  } | null>(null);
  const [awaiting, setAwaiting] = useState(false);

  useEffect(() => {
    if (awaiting) {
      if (email.saving) {
        return;
      }

      setAwaiting(false);
      setArrival({
        enabled: email.enabled,
        text: t(email.enabled ? "emailAnnounceOn" : "emailAnnounceOff"),
      });
      return;
    }

    if (arrival && arrival.enabled !== email.enabled) {
      setArrival(null);
    }
  }, [arrival, awaiting, email.saving, email.enabled, t]);

  // Stays a button, and stays in the tab order. A reader who never uses a
  // mouse would otherwise pass the row and never learn that email is one of
  // the places a notification can reach them.
  if (!kind.spec.email) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger
            aria-disabled="true"
            aria-label={t("channelEmailSoonLabel", { kind: label })}
            aria-describedby={hintId}
            className={cn(CELL, CELL_DEAD)}
          >
            <MailClock className="size-4" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t("channelEmailSoonHint")}</TooltipContent>
        </Tooltip>
        <span aria-hidden="true" id={hintId} className="sr-only">
          {t("channelEmailSoonHint")}
        </span>
      </>
    );
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          aria-pressed={email.enabled}
          aria-disabled={email.saving || undefined}
          // Named for its row like every other cell in it, and described by
          // what it reaches beyond the row. The name has to differ per row or
          // the two job cells answer to one name; the description is where the
          // shared switch gets said.
          aria-label={t("channelCellLabel", {
            channel: t("channelEmail"),
            kind: label,
          })}
          aria-describedby={hintId}
          onClick={() => {
            if (email.saving) {
              return;
            }

            setAwaiting(true);
            email.onChange(!email.enabled);
          }}
          className={cn(
            CELL,
            email.saving && "opacity-50",
            email.enabled ? CELL_ON : CELL_OFF,
          )}
        >
          <Mail className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{t("channelEmailHint")}</TooltipContent>
      </Tooltip>
      {/* Hidden from the tree and still read: a description is computed from
          the element it points at, whether or not that element is in the
          tree. Left in it, the row reads the same sentence twice. */}
      <span aria-hidden="true" id={hintId} className="sr-only">
        {t("channelEmailHint")}
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {arrival?.text ?? ""}
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
  onToggle,
}: {
  kind: KindChoice;
  email: EmailChoice;
  onToggle: (channel: StoredChannel, on: boolean) => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  const { channels, saving } = kind;
  const label = t(kind.spec.labelKey);

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
      className="flex shrink-0 items-center justify-end gap-1"
    >
      {CHANNEL_SPECS.map((spec) => {
        const pressed = channels.includes(spec.id);
        const Icon = CHANNEL_ICON[spec.id];

        return (
          <Tooltip key={spec.id}>
            <TooltipTrigger
              aria-pressed={pressed}
              aria-disabled={saving || undefined}
              aria-label={t("channelCellLabel", {
                channel: t(spec.labelKey),
                kind: label,
              })}
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
            <TooltipContent>{t(spec.hintKey)}</TooltipContent>
          </Tooltip>
        );
      })}
      <EmailCell kind={kind} email={email} />
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
function ChannelGrid({
  kinds,
  email,
  showNames,
  onToggle,
}: {
  kinds: readonly KindChoice[];
  email: EmailChoice;
  showNames: boolean;
  onToggle: (kind: KindChoice, channel: StoredChannel, on: boolean) => void;
}) {
  const t = useTranslations("App.Account.Notifications");

  // The names sit on the row's floor. A channel whose name wraps in one
  // language would otherwise lift its own column, and the heads would read on
  // two lines of sight.
  const heads = (
    <>
      {CHANNEL_SPECS.map((spec) => (
        <ColumnHead key={spec.id}>{t(spec.labelKey)}</ColumnHead>
      ))}
      <ColumnHead>{t("channelEmail")}</ColumnHead>
    </>
  );

  return (
    <div>
      {/* Ended at the same edge as the cells rather than spaced off a name
          that is not always there, so a group of one lines up with the rest.
          With names, the rows stack on a narrow screen and each row carries
          its own heads instead: one set at the top would sit a whole name
          block away from the cells it labels. */}
      <div
        aria-hidden="true"
        className={cn(
          "items-end justify-end gap-1 pb-1",
          showNames ? "hidden sm:flex" : "flex",
        )}
      >
        {heads}
      </div>
      <div className={cn(showNames && "divide-y")}>
        {kinds.map((kind) => (
          // Stacked on a narrow screen, where three cells and a name that
          // wraps would leave the name about 70px wide. The cells keep the
          // right edge either way, so they stay under their own heads.
          <div
            key={kind.spec.category}
            className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-end sm:gap-1"
          >
            {showNames ? (
              <div className="min-w-0 pr-3 pl-6 break-words sm:flex-1 sm:pl-10">
                <p className="text-sm leading-5">{t(kind.spec.labelKey)}</p>
                <p className="text-muted-foreground text-sm leading-5">
                  {t(kind.spec.hintKey)}
                </p>
              </div>
            ) : null}
            {/* The cells name their own channel, so both copies of the heads
                are for the eye alone and a reader hears them once, from the
                control. */}
            {showNames ? (
              <div
                aria-hidden="true"
                className="flex items-end justify-end gap-1 sm:hidden"
              >
                {heads}
              </div>
            ) : null}
            <KindCells
              kind={kind}
              email={email}
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

/**
 * A group that folds, with its kinds under it.
 *
 * The group control offers the answers that mean something for this group, and
 * the kinds under it stay separately selectable. Chat is the case this exists
 * for: mentions, direct messages and every message in a room are usually one
 * decision and sometimes three. Set one by one, the group says Custom and that
 * stop opens the fold rather than picking for you.
 */
function GroupRows({
  group,
  email,
  choices,
}: {
  group: GroupChoice;
  email: EmailChoice;
  choices: NotificationDelivery;
}) {
  const t = useTranslations("App.Account.Notifications");
  const [open, setOpen] = useState(false);
  const kinds = group.kinds.map((kind) => kind.spec);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        {/* The trigger holds no control of its own: a button inside a button is
            not a thing a browser can do. */}
        <CollapsibleTrigger className="group focus-visible:ring-ring/50 -m-1 flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-[3px]">
          <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          <span className="min-w-0">
            <span className="block text-sm leading-5">
              {t(group.spec.labelKey)}
            </span>
            {group.spec.descriptionKey ? (
              <span className="text-muted-foreground block truncate text-sm leading-5">
                {t(group.spec.descriptionKey)}
              </span>
            ) : null}
          </span>
        </CollapsibleTrigger>
        <PresetStops
          group={t(group.spec.labelKey)}
          kinds={kinds}
          preset={group.preset}
          saving={group.saving}
          onPick={(preset) => {
            void choices.setDeliveries(presetChanges(preset, kinds));
          }}
        />
      </div>
      <CollapsibleContent>
        <div className="bg-muted/20 border-t px-4 pt-3 pb-1">
          <ChannelGrid
            kinds={group.kinds}
            email={email}
            showNames
            onToggle={(kind, channel, on) => {
              void choices.setDeliveries([
                {
                  category: kind.spec.category,
                  channels: withChannel(kind.channels, channel, on),
                },
              ]);
            }}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The account switch on a row of its own, for when no kind row carries it. */
function EmailRow({ email }: { email: EmailChoice }) {
  const t = useTranslations("App.Account.Notifications");
  const hintId = useId();

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm leading-5 font-medium">
          {t("channelEmailLabel")}
        </p>
        {/* No rows to be shared with here, so this one says what the emails
            are rather than which rows hold the same switch. */}
        <p id={hintId} className="text-muted-foreground text-sm leading-6">
          {t("channelEmailFallbackHint")}
        </p>
      </div>
      <button
        type="button"
        aria-pressed={email.enabled}
        aria-disabled={email.saving || undefined}
        aria-label={t("channelEmailLabel")}
        aria-describedby={hintId}
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
    </div>
  );
}

/** The groups the matrix carries, in the box they are drawn in. */
function KindGroups({
  email,
  choices,
}: {
  email: EmailChoice;
  choices: NotificationDelivery;
}) {
  const t = useTranslations("App.Account.Notifications");

  return (
    <div className="divide-y rounded-lg border">
      {choices.groups.map((group) => {
        const [only] = group.kinds;

        // A group of one is its kind: folding it away behind a chevron would
        // hide the control without shortening the page, and its own name is
        // the only row a grid would draw.
        return group.kinds.length === 1 && only ? (
          <div
            key={group.spec.id}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <div className="min-w-0">
              <p className="text-sm leading-5">{t(group.spec.labelKey)}</p>
              <p className="text-muted-foreground text-sm leading-5">
                {t(only.spec.hintKey)}
              </p>
            </div>
            <ChannelGrid
              kinds={group.kinds}
              email={email}
              showNames={false}
              onToggle={(kind, channel, on) => {
                void choices.setDeliveries([
                  {
                    category: kind.spec.category,
                    channels: withChannel(kind.channels, channel, on),
                  },
                ]);
              }}
            />
          </div>
        ) : (
          <GroupRows
            key={group.spec.id}
            group={group}
            email={email}
            choices={choices}
          />
        );
      })}
    </div>
  );
}

/**
 * What you get notified about, and where each kind arrives.
 *
 * One control per decision: a group that a reader settles at once carries the
 * group's own answers, and the kinds under it stay separately selectable. Open
 * a group and it becomes a grid, because a channel is a place rather than a
 * volume: an entry in Sokosumi, a push on the device, and an email are three
 * of them.
 */
export function NotificationKinds({ email }: { email: EmailChoice }) {
  const t = useTranslations("App.Account.Notifications");
  const choices = useNotificationDelivery();

  if (choices.loading) {
    return null;
  }

  // Email is the one control here that the matrix does not carry, and Core
  // keeps mailing whatever the matrix says. A read that failed leaves no rows
  // at all, and a matrix that comes back without the job kinds leaves rows
  // that all mail nothing. Either way the switch stands on a row of its own
  // rather than disappearing with them.
  const mailedByARow = choices.groups.some((group) =>
    group.kinds.some((kind) => kind.spec.email),
  );

  return (
    <div className="space-y-3">
      {choices.groups.length > 0 ? (
        <>
          <div>
            <p className="text-sm leading-5 font-medium">{t("kindsTitle")}</p>
            <p className="text-muted-foreground text-sm leading-6">
              {t("kindsDescription")}
            </p>
          </div>
          <KindGroups email={email} choices={choices} />
          <p className="text-muted-foreground text-sm leading-6">
            {t("pushHint")}
          </p>
        </>
      ) : null}
      {mailedByARow ? null : <EmailRow email={email} />}
    </div>
  );
}
