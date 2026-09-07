"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PushRefusal } from "./notification-delivery";

/** What is wrong, in a line the reader can act on or dismiss in their head. */
const TITLE_KEY: Record<PushRefusal, string> = {
  unsupported: "pushBannerUnsupportedTitle",
  denied: "pushBannerDeniedTitle",
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
const BODY_KEY: Record<PushRefusal, string> = {
  unsupported: "pushBannerUnsupportedBody",
  denied: "pushBannerDeniedBody",
};

/**
 * A push the rows are asking for, that this browser will not show.
 *
 * One banner for the whole card, because the browser is one answer for every
 * row under it. The cells stay exactly as the reader set them: they write the
 * account rather than this browser, so what is missing is this browser alone.
 *
 * Neither of these can be fixed from here, so the banner carries no control.
 * A refusal has to be taken back in the browser's own settings, since a site
 * that has been refused cannot ask again, and a browser without the feature
 * has nothing to offer. The third case, a browser that simply holds no
 * subscription, is a switch at the end of the card rather than a warning: it
 * is a thing the reader can turn on, and one of them meant to turn it off.
 */
export function PushBanner({ block }: { block: PushRefusal }) {
  const t = useTranslations("App.Account.Notifications");

  return (
    // It usually arrives in the middle of a press: a cell asks for a push,
    // and this is the answer. Fading down into the gap it makes says it
    // belongs to that press, where appearing between two frames reads as the
    // page having been like this all along and the reader having missed it. A
    // reader who set the cell on an earlier visit meets it on the first paint
    // instead, where one short fade is the whole of it.
    <div className="border-semantic-warning-tertiary bg-semantic-warning-quinary motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 animation-duration-200 rounded-lg border p-4">
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
      </div>
    </div>
  );
}
