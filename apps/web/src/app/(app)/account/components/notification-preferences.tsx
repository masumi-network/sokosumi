"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth/auth.client";
import { NotificationKinds } from "./notification-kinds";

interface NotificationPreferencesProps {
  marketingOptIn: boolean;
  /** A quieter card rendered under the grid, for settings that are not delivery. */
  children?: ReactNode;
}

type UpdateUserResult = Awaited<ReturnType<typeof authClient.updateUser>>;

export function NotificationPreferences({
  marketingOptIn: initialMarketingOptIn,
  children,
}: NotificationPreferencesProps) {
  const t = useTranslations("App.Account.Notifications");
  const [marketingOptIn, setMarketingOptIn] = useState(initialMarketingOptIn);
  const [isSaving, setIsSaving] = useState(false);

  const handleMarketingOptInToggle = (nextValue: boolean) => {
    if (isSaving) {
      return;
    }

    const previous = marketingOptIn;
    setMarketingOptIn(nextValue);
    setIsSaving(true);

    // The value goes back on the chain rather than inside the toast, so it is
    // put back whether or not the toast renders its error, and never after the
    // flag that tells the row the write has settled.
    // Called inside the chain, so a throw on the way out is a rejection the
    // catch and the finally still see. Thrown before it, the flag would stay
    // set for the life of the page and the control would refuse forever.
    const updatePromise = Promise.resolve()
      .then(() => authClient.updateUser({ marketingOptIn: nextValue }))
      .then((result: UpdateUserResult) => {
        if (result.error) {
          throw new Error(result.error.message ?? "update_failed");
        }
      })
      .catch((error: unknown) => {
        setMarketingOptIn(previous);
        throw error;
      })
      .finally(() => {
        setIsSaving(false);
      });

    toast.promise(updatePromise, {
      loading: t("loading"),
      success: () =>
        nextValue
          ? t("marketingEmailsEnabledSuccess")
          : t("marketingEmailsDisabledSuccess"),
      error: () => t("error"),
    });
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        {/* The route's top-level heading. `CardTitle` is a div, so without this
            heading navigation, which is how a settings page is read, reaches
            nothing here. Preflight resets a heading's size and weight, so the
            card looks the same. Cards below this one use `h2`. */}
        <CardTitle>
          <h1>{t("title")}</h1>
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Everything about delivery is in the one grid: what Sokosumi tells
            you about, and where each of those things reaches you. The
            marketing switch is a row of it, so a reader answers one question in
            one place rather than meeting a second kind of control among them.
            Push has no row of its own at all: a cell asks the browser. A
            preference that changes no delivery cannot be a row here, so
            `children` carries it below the grid as its own quieter card
            instead. */}
        {/* Busy while the write is in flight. A cell that took the press and
            did nothing would look broken; dimmed and marked busy, it says
            why. */}
        <NotificationKinds
          news={{
            enabled: marketingOptIn,
            saving: isSaving,
            onChange: handleMarketingOptInToggle,
          }}
        />
      </CardContent>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}
