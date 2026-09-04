"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChannelGrid,
  EmailCell,
  type EmailChoice,
  UnusedChannelCells,
} from "./notification-cells";
import {
  type PushBlock,
  presetChanges,
  withChannel,
} from "./notification-delivery";
import { ChannelLegend } from "./notification-legend";
import { GroupAnswer } from "./notification-presets";
import { PushBanner } from "./notification-push-banner";
import {
  type GroupChoice,
  type NotificationDelivery,
  useNotificationDelivery,
} from "./use-notification-delivery";

/**
 * A row that folds: what it is on the outside, where it arrives inside.
 *
 * Every row of the card is one of these, so the list a reader lands on is a
 * list of things Sokosumi sends rather than a wall of icons. The cells are the
 * second question and they wait for it to be asked: a reader who wants the app
 * and not the phone opens the row and says so, and a reader who only wants
 * less noise never has to meet a channel at all.
 *
 * The trigger holds no control of its own: a button inside a button is not a
 * thing a browser can do. An answer that belongs to the whole row sits under
 * the name instead, indented to the words rather than to the chevron, because
 * the chevron's column belongs to the fold. A `size-4` mark and a `gap-2` make
 * the 24px that indent is.
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
      <div className="px-4 py-3">
        <CollapsibleTrigger className="group focus-visible:ring-ring/50 -m-1 flex w-full min-w-0 items-center gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-[3px]">
          <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          <span className="min-w-0">
            <span className="block text-sm leading-5">{name}</span>
            <span
              id={descriptionId}
              className="text-muted-foreground block text-sm leading-5"
            >
              {description}
            </span>
          </span>
        </CollapsibleTrigger>
        {answer ? <div className="mt-2 pl-6">{answer}</div> : null}
      </div>
      {/* The fold measures itself, so the cells slide out of the row rather
          than replacing it between two frames. `overflow-hidden` is what makes
          the height mean anything: without it they stand at full height while
          the box around them is still growing. A reader who asked for less
          motion gets the old jump, which is the honest thing to give them. */}
      <CollapsibleContent className="motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down overflow-hidden">
        <div className="bg-muted/20 border-t px-4 pt-1 pb-1">{children}</div>
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
  const [only] = group.kinds;
  const alone = group.kinds.length === 1 && only;

  return (
    <FoldRow
      open={open}
      onOpenChange={setOpen}
      name={t(group.spec.labelKey)}
      // A group of one is its kind, so the line under the name is what that
      // kind is rather than what the group holds. Nothing else would be there:
      // the grid inside draws no name for a group with one row in it.
      description={
        alone
          ? t(only.spec.hintKey)
          : group.spec.descriptionKey
            ? t(group.spec.descriptionKey)
            : ""
      }
      answer={
        // A group of one is its own situation, and a group Core answered only
        // part of is one no word covers. Both leave the rows to answer.
        alone || group.presets.length === 0 ? null : (
          <GroupAnswer
            group={t(group.spec.labelKey)}
            kinds={kinds}
            presets={group.presets}
            preset={group.preset}
            saving={group.saving}
            onPick={(preset) => {
              void choices.setDeliveries(presetChanges(preset, kinds));
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
        email={email}
        pushBlock={pushBlock}
        showNames={!alone}
        heads={<ChannelLegend pushBlock={pushBlock} />}
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
 * Sokosumi's own news, as a row of the same card.
 *
 * It is not a notification about the reader's work, and Core holds it as an
 * account switch rather than a cell of the matrix. It is still a thing
 * Sokosumi sends, so it folds open on the same columns instead of sitting
 * under the card as a switch of its own. The two columns it does not use say
 * so rather than leaving a hole where an answer should be.
 */
function NewsRow({ news }: { news: EmailChoice }) {
  const t = useTranslations("App.Account.Notifications");
  const [open, setOpen] = useState(false);
  const label = t("marketingEmailsTitle");
  const hintId = useId();

  return (
    <FoldRow
      name={label}
      description={t("marketingEmailsDescription")}
      descriptionId={hintId}
      open={open}
      onOpenChange={setOpen}
    >
      <div className="flex items-center justify-end gap-2 py-2">
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
      </div>
    </FoldRow>
  );
}

/** The account switch on a row of its own, for when no kind row carries it. */
function EmailRow({ email }: { email: EmailChoice }) {
  const t = useTranslations("App.Account.Notifications");
  const [open, setOpen] = useState(false);
  const hintId = useId();

  return (
    <FoldRow
      name={t("channelEmailLabel")}
      // No rows to be shared with here, so this one says what the emails are
      // rather than which rows hold the same switch.
      description={t("channelEmailFallbackHint")}
      descriptionId={hintId}
      open={open}
      onOpenChange={setOpen}
    >
      <div className="flex items-center justify-end gap-2 py-2">
        <EmailCell
          // Named for the row, like the marketing row below it. Composed, it
          // would read "Email for Job status emails".
          name={t("channelEmailLabel")}
          describedById={hintId}
          email={email}
        />
      </div>
    </FoldRow>
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
  return (
    <>
      {choices.groups.map((group) => (
        <GroupRows
          key={group.spec.id}
          group={group}
          email={email}
          pushBlock={pushBlock}
          choices={choices}
        />
      ))}
    </>
  );
}

/**
 * What you get notified about, and where each kind arrives.
 *
 * One control per decision: a group that a reader settles at once carries the
 * group's own answers, and the kinds under it stay separately selectable. Open
 * a row and it becomes a grid, because a channel is a place rather than a
 * volume: an entry in Sokosumi, a push on the device, and an email are three
 * of them.
 *
 * Everything Sokosumi sends answers here, including the switches that used to
 * sit under the card. Push is no longer a preference of its own: asking for
 * one in a cell asks the browser, and a browser that cannot show one says so
 * in a banner over the rows rather than in a row about the browser.
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
      {/* One banner for the whole card, because the browser is one answer for
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
        {choices.loading || mailedByARow ? null : <EmailRow email={email} />}
        <NewsRow news={news} />
      </div>
    </div>
  );
}
