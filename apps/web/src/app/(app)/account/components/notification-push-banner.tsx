"use client";

import { AlertTriangle, type LucideIcon, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PushBlock } from "./notification-delivery";

/** What is wrong, in a line the reader can act on or dismiss in their head. */
const TITLE_KEY: Record<PushBlock, string> = {
  unsupported: "pushBannerUnsupportedTitle",
  denied: "pushBannerDeniedTitle",
  unsubscribed: "pushBannerUnsubscribedTitle",
};

/**
 * Why, and what to do about it.
 *
 * Each one ends by saying the reader's other devices may still be getting
 * these, so a warning about one browser does not read as the account going
 * quiet. It says may. This browser can read the account consent and the
 * cells, and never whether another browser still holds a subscription, so
 * anything firmer would be a promise nothing here can keep.
 */
const BODY_KEY: Record<PushBlock, string> = {
  unsupported: "pushBannerUnsupportedBody",
  denied: "pushBannerDeniedBody",
  unsubscribed: "pushBannerUnsubscribedBody",
};

/** The press a notice offers, where it has one to offer. */
interface NoticeAction {
  labelKey: string;
  /** A push write is in flight. The button stays where it is, and waits. */
  saving: boolean;
  onPress: () => void;
}

/**
 * One line about this browser, over the rows it is about.
 *
 * Both faces of that line are this shape, because they are one answer read
 * twice: the rows below ask for a push, and this says whether it lands here.
 * Drawing them apart would give the same sentence two layouts and put the
 * button in two places.
 *
 * A browser that cannot show a push the reader asked for is a warning: it
 * takes the warning tint and the warning mark, and owes the reader a second
 * line saying why. A browser that can show one is not a warning. It keeps the
 * card's own colours, says its piece in the title, and stops there.
 */
function BrowserNotice({
  warning,
  icon: Icon,
  titleKey,
  bodyKey,
  action,
}: {
  warning: boolean;
  icon: LucideIcon;
  titleKey: string;
  bodyKey: string | null;
  action: NoticeAction | null;
}) {
  const t = useTranslations("App.Account.Notifications");
  const titleId = useId();

  return (
    // It usually arrives in the middle of a press: a cell asks for a push,
    // and this is the answer. Fading down into the gap it makes says it
    // belongs to that press, where appearing between two frames reads as the
    // page having been like this all along and the reader having missed it. A
    // reader who set the cell on an earlier visit meets it on the first paint
    // instead, where one short fade is the whole of it.
    <div
      className={cn(
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 animation-duration-200 rounded-lg border p-4",
        warning
          ? "border-semantic-warning-tertiary bg-semantic-warning-quinary"
          : "bg-muted/50",
      )}
    >
      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* The tint and the mark carry the warning; the words do not.
              `--semantic-warning` is a 40% yellow, about 2.3:1 on its own
              quinary tint in light mode, which is under what a paragraph
              needs. The account notices colour their text with it and get
              away with one short line. This one has a reason to explain. */}
          <Icon
            className={cn(
              "mt-0.5 size-4 shrink-0",
              warning ? "text-semantic-warning" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-1">
            <p id={titleId} className="text-sm leading-5 font-medium">
              {t(titleKey)}
            </p>
            {bodyKey ? (
              <p className="text-muted-foreground text-sm leading-5">
                {t(bodyKey)}
              </p>
            ) : null}
          </div>
        </div>
        {action ? (
          <Button
            variant="outline"
            size="sm"
            // The line above says which push and which browser, so the button
            // does not have to. Read on its own, "Turn off" answers nothing;
            // read with the sentence it sits under, it is the whole of it.
            aria-describedby={titleId}
            // Reachable while the write is in flight, and doing nothing. The
            // browser drops a `disabled` control out of the tab order under
            // the reader's finger, and this write waits on the browser's own
            // permission prompt, so it is in flight for as long as a person
            // takes to answer it. Every other control on this card refuses a
            // press the same way.
            aria-disabled={action.saving || undefined}
            onClick={() => {
              if (action.saving) {
                return;
              }

              action.onPress();
            }}
            // Stacked under the words on a phone, it starts where the words
            // start rather than where the mark does: the mark and the gap
            // beside it are 28px.
            //
            // It wraps there too. A button holds its label on one line by
            // default, and this label is a sentence: at 320px it ran 198px
            // into a 176px column and the end of it was clipped away, and the
            // German label ran 283px. Wrapping costs a second line and keeps
            // the words. The fixed height goes with it, or the second line
            // would leave the box the same way.
            className={cn(
              "ml-7 h-auto min-h-8 self-start py-1.5 whitespace-normal @xl:ml-0 @xl:h-8 @xl:self-auto @xl:py-0",
              action.saving && "opacity-50",
            )}
          >
            {t(action.labelKey)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A push the rows are asking for, that this browser will not show.
 *
 * One banner for the whole card, because the browser is one answer for every
 * row under it. The cells stay exactly as the reader set them: they write the
 * account rather than this browser, so what is missing is this browser alone.
 *
 * Only one of the three can be fixed from here. A refusal has to be taken back
 * in the browser's own settings, since a site that has been refused cannot ask
 * again, and a browser without the feature has nothing to offer. Those two
 * explain themselves and take no press.
 */
export function PushBanner({
  block,
  saving,
  onEnable,
}: {
  block: PushBlock;
  /** A push write is in flight. The button stays where it is, and waits. */
  saving: boolean;
  onEnable: () => void;
}) {
  return (
    <BrowserNotice
      warning={true}
      icon={AlertTriangle}
      titleKey={TITLE_KEY[block]}
      bodyKey={BODY_KEY[block]}
      action={
        block === "unsubscribed"
          ? {
              labelKey: "pushBannerAction",
              saving,
              onPress: onEnable,
            }
          : null
      }
    />
  );
}

/**
 * A push the rows are asking for, that this browser will show.
 *
 * The other half of the same answer, and never on screen beside it. The push
 * column writes the account, so a reader who wants their laptop quiet and
 * their phone loud has nowhere else to say so: this drops this browser's own
 * subscription and leaves every cell and the account consent where they were.
 *
 * It carries the mark of the Push column rather than a warning's, because
 * nothing here is wrong. It is the state the reader asked for, and the press
 * is there for the day they stop wanting it. Nothing being wrong is also why
 * it is one line: a reader who set this up is being told it worked.
 */
export function DeviceBanner({
  saving,
  onSilence,
}: {
  /** A push write is in flight. The button stays where it is, and waits. */
  saving: boolean;
  onSilence: () => void;
}) {
  return (
    <BrowserNotice
      warning={false}
      icon={Smartphone}
      titleKey="deviceBannerTitle"
      // The title is the whole notice: which push, and where it lands. A
      // second line under it can only repeat that in more words.
      bodyKey={null}
      action={{
        labelKey: "deviceBannerAction",
        saving,
        onPress: onSilence,
      }}
    />
  );
}
