"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  ChannelGrid,
  EmailCell,
  type EmailChoice,
  KindCells,
  UnusedChannelCells,
} from "./notification-cells";
import {
  type PushBlock,
  presetChanges,
  withChannel,
} from "./notification-delivery";
import { ChannelLegend, ChannelLegendScope } from "./notification-legend";
import { GroupAnswer } from "./notification-presets";
import { DeviceBanner, PushBanner } from "./notification-push-banner";
import {
  type GroupChoice,
  type KindChoice,
  type NotificationDelivery,
  useNotificationDelivery,
} from "./use-notification-delivery";

/**
 * A row that folds: what it is on the outside, where it arrives inside.
 *
 * Only a group of more than one kind is one of these. Its cells are the
 * second question and they wait for it to be asked: a reader who wants the app
 * and not the phone for one kind of chat opens the row and says so, and a
 * reader who only wants less noise sets the whole group from the row.
 *
 * The trigger holds no control of its own: a button inside a button is not a
 * thing a browser can do. An answer that belongs to the whole row sits beside
 * the name instead, at the end of the row, where it is one line rather than a
 * second one and where it lands over the columns the fold opens on. A phone
 * has no room for both on one line, so there it drops under the name and
 * keeps the trailing edge, where the cells of every row that answers on the
 * card stand too.
 *
 * Whether it stands open is the caller's to hold. The answer under the name
 * can ask for the rows, and only the caller that draws that answer can say
 * open rather than toggle.
 */
function FoldRow({
  name,
  description,
  descriptionId,
  answer,
  open,
  onOpenChange,
  children,
}: {
  name: string;
  description: string;
  /** For a control inside the fold that is described by the row's own line. */
  descriptionId?: string;
  /** What the whole row answers at once, for a row that has such an answer. */
  answer?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-2 px-4 py-3 @xl:flex-row @xl:items-center @xl:gap-4">
        <CollapsibleTrigger className="group focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring -m-1 flex w-full min-w-0 items-center gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-[3px] @xl:flex-1">
          {/* Turned on the same 200ms ease-out the fold opens on, so the
              mark and the box it belongs to stop together. Under reduced
              motion it has no transition at all and simply points the other
              way, which is what the fold does too. */}
          <ChevronRight
            className="text-muted-foreground size-4 shrink-0 duration-200 ease-out group-data-[state=open]:rotate-90 motion-safe:transition-transform"
            aria-hidden="true"
          />
          {/* The name carries the weight. The line under it is the same size
              and longer, so at one weight the two were told apart by colour
              alone. */}
          <span className="min-w-0">
            <span className="block text-sm leading-5 font-medium">{name}</span>
            <span
              id={descriptionId}
              className="text-muted-foreground block text-sm leading-5"
            >
              {description}
            </span>
          </span>
        </CollapsibleTrigger>
        {answer ? (
          <div className="shrink-0 self-end @xl:self-auto">{answer}</div>
        ) : null}
      </div>
      {/* The fold measures itself, so the cells slide out of the row rather
          than replacing it between two frames. `overflow-hidden` is what makes
          the height mean anything: without it they stand at full height while
          the box around them is still growing. A reader who asked for less
          motion gets the old jump, which is the honest thing to give them. */}
      <CollapsibleContent className="group/fold motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down overflow-hidden">
        {/* No padding above the children. What comes first is the line of
            column names, and it carries its own, so the names sit under the
            border the way a table head sits under its rule rather than
            floating in a band of their own.

            The rows fade over the same 200ms the box takes. Drawn at full
            strength from the first frame, a grid of thirty cells is already
            all there and the box is a shutter being pulled off it; faded in,
            it is the grid that arrives. `animation-duration-200` rather than
            `duration-200`, which would also set a transition duration this
            element never asked for. */}
        <div className="bg-card-background motion-safe:group-data-[state=closed]/fold:animate-out motion-safe:group-data-[state=closed]/fold:fade-out motion-safe:group-data-[state=open]/fold:animate-in motion-safe:group-data-[state=open]/fold:fade-in animation-duration-200 border-t px-4 pb-1 ease-out">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
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
  pushBlock,
  choices,
}: {
  group: GroupChoice;
  pushBlock: PushBlock | null;
  choices: NotificationDelivery;
}) {
  const t = useTranslations("App.Account.Notifications");
  const [open, setOpen] = useState(false);
  const kinds = group.kinds.map((kind) => kind.spec);

  return (
    <FoldRow
      open={open}
      onOpenChange={setOpen}
      name={t(group.spec.labelKey)}
      description={
        group.spec.descriptionKey ? t(group.spec.descriptionKey) : ""
      }
      answer={
        // A group Core answered only part of is one no word covers, so it
        // leaves the rows to answer.
        group.presets.length === 0 ? null : (
          <GroupAnswer
            group={t(group.spec.labelKey)}
            kinds={kinds}
            presets={group.presets}
            preset={group.preset}
            saving={group.saving}
            onPick={(preset) => {
              void choices.setDeliveries(presetChanges(preset, group.kinds));
            }}
            onCustom={() => {
              setOpen(true);
            }}
          />
        )
      }
    >
      <ChannelGrid
        kinds={group.kinds}
        pushBlock={pushBlock}
        heads={<ChannelLegend pushBlock={pushBlock} named="kind" />}
        onToggle={(kind, channel, on) => {
          void choices.setDeliveries([
            {
              category: kind.spec.category,
              channels: withChannel(kind.channels, channel, on),
            },
          ]);
        }}
      />
    </FoldRow>
  );
}

/**
 * A row with nothing to fold: one notification, answered on the row itself.
 *
 * A fold around a single row of cells hid one line behind a click, and a
 * reader scanning the card saw four names with no answer beside them. So a
 * row that is its own answer carries its cells where a folding row carries
 * its preset.
 *
 * The name starts where a folding row's name does, past the chevron's column:
 * `pl-6` is the `size-4` mark and the `gap-2` beside it. Without it the names
 * down the box would start at two different edges.
 */
function FlatRow({
  name,
  description,
  descriptionId,
  children,
}: {
  name: string;
  description: string;
  /** For a cell described by the row's own line. */
  descriptionId?: string;
  /** The cells. */
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 @xl:flex-row @xl:items-center @xl:gap-4">
      <div className="min-w-0 pl-6 @xl:flex-1">
        <p className="text-sm leading-5 font-medium">{name}</p>
        <p
          id={descriptionId}
          className="text-muted-foreground text-sm leading-5"
        >
          {description}
        </p>
      </div>
      <div className="shrink-0 self-end @xl:self-auto">{children}</div>
    </div>
  );
}

/**
 * A group of one kind, which is that kind.
 *
 * The line under the name is what the kind is rather than what the group
 * holds, because a group of one holds nothing else.
 */
function KindRow({
  group,
  kind,
  pushBlock,
  choices,
}: {
  group: GroupChoice;
  kind: KindChoice;
  pushBlock: PushBlock | null;
  choices: NotificationDelivery;
}) {
  const t = useTranslations("App.Account.Notifications");

  return (
    <FlatRow name={t(group.spec.labelKey)} description={t(kind.spec.hintKey)}>
      <KindCells
        kind={kind}
        pushBlock={pushBlock}
        onToggle={(channel, on) => {
          void choices.setDeliveries([
            {
              category: kind.spec.category,
              channels: withChannel(kind.channels, channel, on),
            },
          ]);
        }}
      />
    </FlatRow>
  );
}

/**
 * Sokosumi's own news, as a row of the same card.
 *
 * It is not a notification about the reader's work, and Core holds it as an
 * account switch rather than a cell of the matrix. It is still a thing
 * Sokosumi sends, so it answers in the same columns instead of sitting under
 * the card as a switch of its own. The two columns it does not use say so
 * rather than leaving a hole where an answer should be.
 */
function NewsRow({ news }: { news: EmailChoice }) {
  const t = useTranslations("App.Account.Notifications");
  const label = t("marketingEmailsTitle");
  const hintId = useId();

  return (
    <FlatRow
      name={label}
      description={t("marketingEmailsDescription")}
      descriptionId={hintId}
    >
      <div
        role="group"
        // Its own sentence rather than the one every kind row uses, which
        // reads "Where {kind} arrives" and is written for a row of the
        // matrix. Marketing emails are not a kind the matrix carries.
        aria-label={t("newsDeliveryAriaLabel")}
        className="flex shrink-0 items-center justify-end gap-2"
      >
        <UnusedChannelCells kind={label} />
        <EmailCell
          // Its own name rather than "Email for Marketing emails", which is
          // what composing gives on a row that is already about email.
          // Described by the row's own line rather than by a sentence of its
          // own: that line is already on screen and says the same.
          name={label}
          describedById={hintId}
          email={news}
        />
      </div>
    </FlatRow>
  );
}

/**
 * What you get notified about, and where each kind arrives.
 *
 * One control per decision: a group that a reader settles at once carries the
 * group's own answers, and the kinds under it stay separately selectable. Open
 * such a row and it becomes a grid, and a row that is one notification carries
 * its cells already, because a channel is a place rather than a volume: an
 * entry in Sokosumi, a push on the device, and an email are three of them.
 *
 * Everything Sokosumi sends answers here, including the switches that used to
 * sit under the card. Push is no longer a preference of its own: asking for
 * one in a cell asks the browser, and a browser that cannot show one says so
 * in a banner over the rows rather than in a row about the browser.
 */
export function NotificationKinds({ news }: { news: EmailChoice }) {
  const t = useTranslations("App.Account.Notifications");
  const choices = useNotificationDelivery();

  // The marketing switch is a server prop, and the matrix is a read that has
  // to land. So the marketing row is drawn while the read is in flight, and
  // the rows that come from the matrix are not: an empty card for the length
  // of a round trip loses a control that never needed the answer.
  //
  // Only a read with no answer yet holds the kinds back. A refetch over a
  // warm cache reports success, so the rows it already has stay on screen
  // rather than blanking and coming back.
  const showKinds = !choices.loading && choices.groups.length > 0;

  // A group made of one kind is answered on its row, under one head, and the
  // rest fold. Decided by what the group is made of rather than by what Core
  // answered for it: a group Core answered only one kind of stays a fold in
  // its place, where a reader expects it. NOTIFICATION_GROUPS lists every
  // group of several kinds first, so the split keeps the order.
  const groups = showKinds ? choices.groups : [];
  const folding = groups.filter((group) => group.spec.kinds.length > 1);
  const single = groups.flatMap((group) => {
    const [kind] = group.kinds;

    return group.spec.kinds.length === 1 && kind ? [{ group, kind }] : [];
  });

  const readNote = choices.failed
    ? t("kindsLoadError")
    : choices.loading
      ? t("kindsLoading")
      : "";

  return (
    // The card decides its own layout. Every switch below reads this width
    // rather than the window's: with the sidebar open the card is about 430px
    // inside a 768px window, and a window-width switch put the wide layout on
    // it there. The kind name got 156px and stood six lines tall, where the
    // same card one pixel narrower stacked the row and gave it two.
    <div className="@container space-y-3">
      {/* One region for the whole read, drawn from the first paint and empty
          until it has something to say. A region that arrives with its text
          already in it is announced by some screen readers and not by others;
          one that was already there and then changed is announced by all of
          them.

          It says the rows are coming, and then says nothing: they arrive
          under a heading of their own, which is where a reader going through
          the card meets them. A read that failed has no such landing, so that
          line is shown as well as spoken. Without it the card is a marketing
          switch and no account of the rows nobody can see. */}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "text-muted-foreground text-sm leading-5",
          !choices.failed && "sr-only",
        )}
      >
        {readNote}
      </p>
      {/* The heading describes the groups, so it comes with them. A read that
          failed leaves the box holding the one row Sokosumi can still answer
          for, and a title about setting groups would be pointing at nothing. */}
      {showKinds ? (
        <div>
          <h2 className="text-sm leading-5 font-medium">{t("kindsTitle")}</h2>
          <p className="text-muted-foreground text-sm leading-5">
            {t("kindsDescription")}
          </p>
        </div>
      ) : null}
      {/* One line for the whole card, because the browser is one answer for
          every row. Either face waits for a kind to be asking for a push:
          with every banner cell off, this browser has nothing to say.

          The two are halves of one answer and exactly one is ever on screen.
          The warning says a push the reader asked for will not arrive here
          and offers to fix that; the other says one will, and offers to stop
          it. `device` is null whenever a block is set, so they cannot both
          stand. */}
      {choices.pushBlock && choices.pushWanted ? (
        <PushBanner
          block={choices.pushBlock}
          saving={choices.pushSaving}
          onEnable={() => {
            void choices.activatePush();
          }}
        />
      ) : null}
      {choices.device ? (
        <DeviceBanner
          saving={choices.device.saving}
          onSilence={choices.device.onSilence}
        />
      ) : null}
      {/* One open explanation for the whole box. A pointer sweeping down a
          column crosses the names of every head on it, and each legend
          holding its own would leave the one it came from standing. */}
      <ChannelLegendScope>
        {/* `overflow-hidden` because the head can be the first thing in the
            box, before the groups arrive, and its fill would stand outside
            the border's curve. */}
        <div className="divide-y overflow-hidden rounded-lg border">
          {folding.map((group) => (
            <GroupRows
              key={group.spec.id}
              group={group}
              pushBlock={choices.pushBlock}
              choices={choices}
            />
          ))}
          {/* The head of every row below it, and the rows below it answer on
              the row. A group above names its own columns when it opens, so
              this one is not doing that job for it. Drawn whether or not the
              read landed: the marketing row is always here, and so are its
              three cells. */}
          <div className="bg-card-background px-4">
            <ChannelLegend pushBlock={choices.pushBlock} named="row" />
          </div>
          {single.map(({ group, kind }) => (
            <KindRow
              key={group.spec.id}
              group={group}
              kind={kind}
              pushBlock={choices.pushBlock}
              choices={choices}
            />
          ))}
          {/* Last, because it is the one row that is not about the reader's own
            work, and the only one Sokosumi sends rather than reports. It is
            also the row that does not come from the matrix, so it stands
            whether or not the read landed. */}
          <NewsRow news={news} />
        </div>
      </ChannelLegendScope>
    </div>
  );
}
