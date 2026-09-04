"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
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
  const t = useTranslations("App.Account.Notifications");

  return (
    <div className="border-semantic-warning-tertiary bg-semantic-warning-quinary rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* The tint and the mark carry the warning; the words do not.
              `--semantic-warning` is a 40% yellow, about 2.3:1 on its own
              quinary tint in light mode, which is under what a paragraph
              needs. The account notices colour their text with it and get
              away with one short line. This one has a reason to explain. */}
          <AlertTriangle
            className="text-semantic-warning mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm leading-5 font-medium">
              {t(TITLE_KEY[block])}
            </p>
            <p className="text-muted-foreground text-sm leading-5">
              {t(BODY_KEY[block])}
            </p>
          </div>
        </div>
        {block === "unsubscribed" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={onEnable}
            // Stacked under the words on a phone, it starts where the words
            // start rather than where the mark does: the mark and the gap
            // beside it are 28px.
            className="ml-7 self-start sm:ml-0 sm:self-auto"
          >
            {t("pushBannerAction")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
