"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth/auth.client";

interface ChatDisplayPreferencesProps {
  showRoomUnreadCount: boolean;
}

type UpdateUserResult = Awaited<ReturnType<typeof authClient.updateUser>>;

/**
 * Chat display preferences, in a card of their own.
 *
 * It sits beside the notification card rather than inside it. That card answers
 * what Sokosumi tells a reader about and where each of those things reaches
 * them, and its grid is deliberately the only control it holds. This preference
 * changes no delivery at all: it changes what the reader sees in a sidebar they
 * already have open, so a row of that grid would misreport what it does.
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
    <Card>
      <CardHeader>
        {/* h2: the notification card above owns this route's h1. */}
        <CardTitle>
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor={switchId} className="text-sm font-medium">
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
