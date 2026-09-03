"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CHANNEL_SPECS,
  emailChipKeys,
  presetChanges,
  type StoredChannel,
  sameChannels,
  withChannel,
} from "./notification-delivery";
import { PresetStops } from "./notification-presets";
import {
  type GroupChoice,
  type NotificationDelivery,
  useNotificationDelivery,
} from "./use-notification-delivery";

const CHIP =
  "rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors";

/**
 * Which channels one kind arrives on.
 *
 * One chip per channel, each its own answer, because a channel is a place
 * rather than a step. Nothing picked means the kind does not arrive, so there
 * is no separate stop that says off. Picking a push picks the in-app entry
 * with it, so on every kind the feed carries, a push leaves something the
 * reader can find again.
 *
 * That pairing is why the group carries a live region. The chips read as two
 * independent choices, and pressing one of them moves the other, which a
 * reader who cannot see the row would otherwise never learn. So every change
 * says where the kind now arrives, once, in the reader's own words.
 *
 * Email is drawn and cannot be picked, because it is one switch for the whole
 * account rather than a cell per kind. It says which of the two it is: the
 * switch further up this page, or no email at all.
 */
function ChannelToggles({
  kind,
  channels,
  sendsEmail,
  saving,
  onToggle,
}: {
  kind: string;
  channels: readonly StoredChannel[];
  /** Whether email exists for this kind. Changes what the Email chip claims. */
  sendsEmail: boolean;
  /** A write is in flight. The chips stay reachable, and do nothing. */
  saving: boolean;
  onToggle: (channel: StoredChannel, on: boolean) => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  const email = emailChipKeys(sendsEmail);

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
  // contradict the chips and silence the next press that lands on the same
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
          kind,
          channels: on.length > 0 ? on.join(", ") : t("channelsNone"),
        }),
      });
      return;
    }

    if (arrival && !sameChannels(arrival.channels, channels)) {
      setArrival(null);
    }
  }, [arrival, awaiting, saving, channels, kind, t]);

  return (
    <div
      role="group"
      aria-label={t("deliveryAriaLabel", { kind })}
      className="border-input bg-background inline-flex shrink-0 gap-0.5 rounded-full border p-0.5"
    >
      {CHANNEL_SPECS.map((spec) => {
        const channel = spec.id;
        const pressed = channels.includes(channel);

        return (
          <button
            key={channel}
            type="button"
            aria-pressed={pressed}
            aria-disabled={saving || undefined}
            title={t(spec.hintKey)}
            onClick={() => {
              if (saving) {
                return;
              }

              setAwaiting(true);
              onToggle(channel, !pressed);
            }}
            className={cn(
              CHIP,
              "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
              saving && "opacity-50",
              pressed
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(spec.labelKey)}
          </button>
        );
      })}
      {/* Stays a button, and stays in the tab order. A reader who never uses a
          mouse would otherwise pass the row and never learn that email is one
          of the places this kind can reach them. `aria-disabled` rather than
          `disabled` for the same reason, and the accessible name carries the
          reason, which a `title` alone does not reach.

          Struck through where no email exists for the kind. The accessible
          name says which of the two it is, but a sighted reader on a keyboard
          or a touchscreen never opens a `title`, so without this the row that
          can be mailed and the row that cannot look the same. */}
      <button
        type="button"
        aria-disabled="true"
        aria-label={t(email.nameKey)}
        title={t(email.hintKey)}
        className={cn(
          CHIP,
          "text-muted-foreground focus-visible:ring-ring/50 cursor-default outline-none focus-visible:ring-[3px]",
          !sendsEmail && "line-through",
        )}
      >
        {t("channelEmail")}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {arrival?.text ?? ""}
      </span>
    </div>
  );
}

/** One kind of notification, what it is, and where it arrives. */
function KindRow({
  label,
  hint,
  channels,
  sendsEmail,
  saving,
  indent = false,
  onToggle,
}: {
  label: string;
  hint: string;
  channels: readonly StoredChannel[];
  sendsEmail: boolean;
  saving: boolean;
  indent?: boolean;
  onToggle: (channel: StoredChannel, on: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
        indent && "sm:pl-10",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm leading-5">{label}</p>
        <p className="text-muted-foreground text-sm leading-5">{hint}</p>
      </div>
      <ChannelToggles
        kind={label}
        channels={channels}
        sendsEmail={sendsEmail}
        saving={saving}
        onToggle={onToggle}
      />
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
  choices,
}: {
  group: GroupChoice;
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
        <div className="bg-muted/20 divide-y border-t">
          {group.kinds.map((kind) => (
            <KindRow
              key={kind.spec.category}
              label={t(kind.spec.labelKey)}
              hint={t(kind.spec.hintKey)}
              channels={kind.channels}
              sendsEmail={kind.spec.email}
              saving={kind.saving}
              indent
              onToggle={(channel, on) => {
                void choices.setDeliveries([
                  {
                    category: kind.spec.category,
                    channels: withChannel(kind.channels, channel, on),
                  },
                ]);
              }}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * What you get notified about, and where each kind arrives.
 *
 * One control per decision: a group that a reader settles at once carries the
 * group's own answers, and the kinds under it stay separately selectable. Each
 * kind then names its channels one by one, because that is what they are: a
 * push and an entry in Sokosumi are two places, not two volumes of the same
 * one.
 */
export function NotificationKinds() {
  const t = useTranslations("App.Account.Notifications");
  const choices = useNotificationDelivery();

  if (choices.groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm leading-5 font-medium">{t("kindsTitle")}</p>
        <p className="text-muted-foreground text-sm leading-6">
          {t("kindsDescription")}
        </p>
      </div>
      <div className="divide-y rounded-lg border">
        {choices.groups.map((group) => {
          const [only] = group.kinds;

          // A group of one is its kind: folding it away behind a chevron would
          // hide the control without shortening the page.
          return group.kinds.length === 1 && only ? (
            <KindRow
              key={group.spec.id}
              label={t(group.spec.labelKey)}
              hint={t(only.spec.hintKey)}
              channels={only.channels}
              sendsEmail={only.spec.email}
              saving={only.saving}
              onToggle={(channel, on) => {
                void choices.setDeliveries([
                  {
                    category: only.spec.category,
                    channels: withChannel(only.channels, channel, on),
                  },
                ]);
              }}
            />
          ) : (
            <GroupRows key={group.spec.id} group={group} choices={choices} />
          );
        })}
      </div>
      <p className="text-muted-foreground text-sm leading-6">{t("pushHint")}</p>
    </div>
  );
}
