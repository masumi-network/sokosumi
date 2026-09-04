"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChannelGrid,
  ColumnHeads,
  EmailCell,
  type EmailChoice,
  UnusedChannelCells,
} from "./notification-cells";
import {
  type PushBlock,
  scopeChanges,
  withChannel,
} from "./notification-delivery";
import { GroupAnswer } from "./notification-presets";
import { PushBanner } from "./notification-push-banner";
import {
  type GroupChoice,
  type NotificationDelivery,
  useNotificationDelivery,
} from "./use-notification-delivery";

/**
 * A group that folds, with its kinds under it.
 *
 * The group control offers the answers that mean something for this group, and
 * the kinds under it stay separately selectable. Chat is the case this exists
 * for: mentions, direct messages and every message in a room are usually one
 * decision and sometimes three. Set one by one, the group says Custom and that
 * stop opens the fold rather than picking for you.
 *
 * The answer sits on a row of its own under the name, indented to the text
 * rather than the chevron. On the header's line it had a corner of the row to
 * fit in and was the first thing to overflow; here it has the card's width,
 * and the description below the name no longer has to be cut to leave it
 * room.
 */
function GroupRows({
  group,
  email,
  pushBlock,
  choices,
}: {
  group: GroupChoice;
  email: EmailChoice;
  pushBlock: PushBlock | null;
  choices: NotificationDelivery;
}) {
  const t = useTranslations("App.Account.Notifications");
  const [open, setOpen] = useState(false);
  const kinds = group.kinds.map((kind) => kind.spec);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="px-4 py-3">
        {/* The trigger holds no control of its own: a button inside a button is
            not a thing a browser can do. */}
        <CollapsibleTrigger className="group focus-visible:ring-ring/50 -m-1 flex w-full min-w-0 items-center gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-[3px]">
          <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          <span className="min-w-0">
            <span className="block text-sm leading-5">
              {t(group.spec.labelKey)}
            </span>
            {group.spec.descriptionKey ? (
              <span className="text-muted-foreground block text-sm leading-5">
                {t(group.spec.descriptionKey)}
              </span>
            ) : null}
          </span>
        </CollapsibleTrigger>
        {/* Indented to the name rather than the chevron: the chevron's column
            belongs to the fold, and the answer is about the words beside it.
            A `size-4` mark and a `gap-2` make 24px. */}
        <div className="mt-2 pl-6">
          <GroupAnswer
            group={t(group.spec.labelKey)}
            kinds={kinds}
            scope={group.scope}
            saving={group.saving}
            onPick={(scope) => {
              void choices.setDeliveries(scopeChanges(scope, group.kinds));
            }}
          />
        </div>
      </div>
      <CollapsibleContent>
        <div className="bg-muted/20 border-t px-4 pt-3 pb-1">
          <ChannelGrid
            kinds={group.kinds}
            email={email}
            pushBlock={pushBlock}
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

/**
 * Sokosumi's own news, as a row of the same grid.
 *
 * It is not a notification about the reader's work, and Core holds it as an
 * account switch rather than a cell of the matrix. It is still a thing
 * Sokosumi sends, so it answers the same question in the same columns instead
 * of sitting under the card as a switch of its own. The two columns it does
 * not use say so rather than leaving a hole where an answer should be.
 */
function NewsRow({ news }: { news: EmailChoice }) {
  const t = useTranslations("App.Account.Notifications");
  const label = t("marketingEmailsTitle");
  const hintId = useId();

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <p className="text-sm leading-5">{label}</p>
        <p id={hintId} className="text-muted-foreground text-sm leading-5">
          {t("marketingEmailsDescription")}
        </p>
      </div>
      <div>
        <div
          aria-hidden="true"
          className="flex items-end justify-end gap-2 pb-1"
        >
          <ColumnHeads />
        </div>
        <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
          <div
            role="group"
            // Its own sentence rather than the one every kind row uses,
            // which reads "Where {kind} arrives" and is written for a row of
            // the matrix. Marketing emails are not a kind the matrix carries.
            aria-label={t("newsDeliveryAriaLabel")}
            className="flex shrink-0 items-center justify-end gap-2"
          >
            <UnusedChannelCells kind={label} />
            <EmailCell
              // Its own name rather than "Email for Marketing emails", which
              // is what composing gives on a row that is already about email.
              // Described by the row's own line rather than by a sentence of
              // its own: that line is already on screen and says the same.
              name={label}
              describedById={hintId}
              email={news}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The account switch on a row of its own, for when no kind row carries it. */
function EmailRow({ email }: { email: EmailChoice }) {
  const t = useTranslations("App.Account.Notifications");
  const hintId = useId();

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm leading-5">{t("channelEmailLabel")}</p>
        {/* No rows to be shared with here, so this one says what the emails
            are rather than which rows hold the same switch. */}
        <p id={hintId} className="text-muted-foreground text-sm leading-5">
          {t("channelEmailFallbackHint")}
        </p>
      </div>
      <EmailCell
        // Named for the row, like the marketing row below it. Composed, it
        // would read "Email for Job status emails".
        name={t("channelEmailLabel")}
        describedById={hintId}
        email={email}
      />
    </div>
  );
}

/** The groups the matrix carries, as rows of the box around them. */
function KindGroups({
  email,
  pushBlock,
  choices,
}: {
  email: EmailChoice;
  pushBlock: PushBlock | null;
  choices: NotificationDelivery;
}) {
  const t = useTranslations("App.Account.Notifications");

  return (
    <>
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
              pushBlock={pushBlock}
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
            pushBlock={pushBlock}
            choices={choices}
          />
        );
      })}
    </>
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
 *
 * Everything Sokosumi sends answers here, including the switches that used to
 * sit under the card. Push is no longer a preference of its own: asking for
 * one in a cell asks the browser, and a browser that cannot show one says so
 * in the cell rather than in a row about the browser.
 */
export function NotificationKinds({
  email,
  news,
}: {
  email: EmailChoice;
  news: EmailChoice;
}) {
  const t = useTranslations("App.Account.Notifications");
  const choices = useNotificationDelivery();

  // Email is the one control here that the matrix does not carry, and Core
  // keeps mailing whatever the matrix says. A read that failed leaves no rows
  // at all, and a matrix that comes back without the job kinds leaves rows
  // that all mail nothing. Either way the switch stands on a row of its own
  // rather than disappearing with them.
  const mailedByARow = choices.groups.some((group) =>
    group.kinds.some((kind) => kind.spec.email),
  );

  // The two account switches are server props, and the matrix is a read that
  // has to land. So the marketing row is drawn while the read is in flight,
  // and the rows that come from the matrix are not: an empty card for the
  // length of a round trip loses a control that never needed the answer.
  // The job emails wait, because whether they need a row of their own is
  // something only the matrix can say.
  //
  // Only a read with no answer yet holds the kinds back. A refetch over a
  // warm cache reports success, so the rows it already has stay on screen
  // rather than blanking and coming back.
  const showKinds = !choices.loading && choices.groups.length > 0;

  return (
    <div className="space-y-3">
      {/* The heading describes the groups, so it comes with them. A read that
          failed leaves the box holding the one row Sokosumi can still answer
          for, and a title about setting groups would be pointing at nothing. */}
      {showKinds ? (
        <div>
          <p className="text-sm leading-5 font-medium">{t("kindsTitle")}</p>
          <p className="text-muted-foreground text-sm leading-6">
            {t("kindsDescription")}
          </p>
        </div>
      ) : null}
      {/* Above the rows it is about, and below the title that owns them. One
          banner for the whole card, because the browser is one answer for
          every row. It waits for a kind to be asking for a push: with every
          banner cell off, nothing is going wrong here. */}
      {choices.pushBlock && choices.pushWanted ? (
        <PushBanner
          block={choices.pushBlock}
          saving={choices.pushSaving}
          onEnable={() => {
            void choices.activatePush();
          }}
        />
      ) : null}
      <div className="divide-y rounded-lg border">
        {showKinds ? (
          <KindGroups
            email={email}
            pushBlock={choices.pushBlock}
            choices={choices}
          />
        ) : null}
        {/* Last, because it is the one row that is not about the reader's own
            work, and the only one Sokosumi sends rather than reports. It is
            also the row that does not come from the matrix, so it stands
            whether or not the read landed. */}
        {/* A row of the box like the rest, rather than a control adrift under
            it: the box is always drawn now, so a row outside it would stand
            unpadded and out of column right below the marketing row. */}
        {choices.loading || mailedByARow ? null : <EmailRow email={email} />}
        <NewsRow news={news} />
      </div>
    </div>
  );
}
