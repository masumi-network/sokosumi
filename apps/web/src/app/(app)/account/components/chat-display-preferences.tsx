"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth/auth.client";

interface ChatDisplayPreferencesProps {
  showRoomUnreadCount: boolean;
}

type UpdateUserResult = Awaited<ReturnType<typeof authClient.updateUser>>;

/**
 * Chat display preferences, as a recessive card nested in the notification card.
 *
 * It is a card and not a row of that card's grid, because the grid answers what
 * Sokosumi tells a reader about and where each of those things reaches them.
 * This preference changes no delivery at all: it changes what the reader sees
 * in a sidebar they already have open, so a row of that grid would misreport
 * what it does.
 *
 * It reads quieter than its host on purpose. It keeps the host's ground so it
 * does not stand out as a second surface, and a border alone says where it
 * starts. One radius step down, tighter padding, and its heading demoted to a
 * muted label, so a reader meets the delivery grid first and finds this below
 * it.
 */
export function ChatDisplayPreferences({
  showRoomUnreadCount: initialShowRoomUnreadCount,
}: ChatDisplayPreferencesProps) {
  const t = useTranslations("App.Account.ChatDisplay");
  const switchId = useId();
  const [showRoomUnreadCount, setShowRoomUnreadCount] = useState(
    initialShowRoomUnreadCount,
  );
  const [isSaving, setIsSaving] = useState(false);

  function handleToggle(nextValue: boolean) {
    if (isSaving) {
      return;
    }

    const previous = showRoomUnreadCount;
    setShowRoomUnreadCount(nextValue);
    setIsSaving(true);

    // The value goes back on the chain rather than inside the toast, so it is
    // put back whether or not the toast renders its error, and never after the
    // flag that re-enables the switch. The sibling notification card orders its
    // write the same way.
    const updatePromise = Promise.resolve()
      .then(() => authClient.updateUser({ showRoomUnreadCount: nextValue }))
      .then((result: UpdateUserResult) => {
        if (result.error) {
          throw new Error(result.error.message ?? "update_failed");
        }
      })
      .catch((error: unknown) => {
        setShowRoomUnreadCount(previous);
        throw error;
      })
      .finally(() => {
        setIsSaving(false);
      });

    toast.promise(updatePromise, {
      loading: t("loading"),
      success: () =>
        nextValue
          ? t("roomUnreadCountEnabledSuccess")
          : t("roomUnreadCountDisabledSuccess"),
      error: () => t("error"),
    });
  }

  return (
    // `rounded-lg` is one step under the host card's `rounded-xl`. The two do
    // not share a corner (this sits 1.5rem inside), so there is no concentric
    // radius to preserve, only the hierarchy to state. Ground stays the host's:
    // a second fill made this read as a louder surface, not a quieter one. The
    // border does the whole job, and a boundary is structure, which a border
    // states and a shadow would not.
    <Card className="gap-2 rounded-lg py-4">
      {/* `gap-0`: `CardHeader` is a two-row grid and this header has one child,
          so the gutter would otherwise be drawn to an empty second row. */}
      <CardHeader className="gap-0 px-4">
        {/* h2: the notification card around this one owns the route's h1.
            `leading-none` is restated because any `text-*` replaces it in the
            merge, and without it the title line box grows. */}
        <CardTitle className="text-muted-foreground text-xs leading-none font-medium">
          <h2>{t("title")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor={switchId} className="text-sm font-normal">
              {t("roomUnreadCountTitle")}
            </Label>
            <p className="text-muted-foreground text-xs">
              {t("roomUnreadCountDescription")}
            </p>
          </div>
          <Switch
            id={switchId}
            checked={showRoomUnreadCount}
            disabled={isSaving}
            onCheckedChange={handleToggle}
          />
        </div>
      </CardContent>
    </Card>
  );
}
