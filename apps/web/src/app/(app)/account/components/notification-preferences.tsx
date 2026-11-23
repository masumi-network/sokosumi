"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/auth.client";
import { NotificationKinds } from "./notification-kinds";

interface NotificationPreferencesProps {
  marketingOptIn: boolean;
  pushDevices?: ReactNode;
  /** A quieter card rendered under the grid, for settings that are not delivery. */
  children?: ReactNode;
}

type UpdateUserResult = Awaited<ReturnType<typeof authClient.updateUser>>;

export function NotificationPreferences({
  marketingOptIn: initialMarketingOptIn,
  children,
  pushDevices,
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
    // No card of its own: the page's gray panel is the surface, and the
    // groups below sit on it as white bordered blocks, like every other
    // settings page. A card here put four layers between the edge and a row.
    <div className="flex flex-col gap-6">
      <header className="space-y-1.5">
        {/* The route's top-level heading, so heading navigation, which is how
            a settings page is read, has a landmark to arrive at. Blocks below
            this one use `h2`. */}
        <h1 className="text-lg leading-none font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>
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
        pushDevices={pushDevices}
        news={{
          enabled: marketingOptIn,
          saving: isSaving,
          onChange: handleMarketingOptInToggle,
        }}
      />
      {children}
    </div>
  );
}
