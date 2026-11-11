"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  BUZZ_CONNECTION_QUERY_KEY,
  BuzzConnectDialog,
  fetchBuzzConnection,
} from "@/components/buzz/buzz-connect-dialog";
import { BuzzLogo } from "@/components/buzz/buzz-logo";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/utils/preference-storage";

const DISMISSED_KEY = "sokosumi:buzz-connect-card:dismissed";

/**
 * "New: chat from Buzz" in the sidebar footer, until the person is on Buzz
 * (seen there, or their own Buzz app linked) or dismisses it. Only where an
 * organization of theirs is on Buzz.
 */
export function BuzzConnectCard() {
  const t = useTranslations("Components.BuzzConnect");
  const { state } = useSidebar();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const connection = useQuery({
    queryKey: BUZZ_CONNECTION_QUERY_KEY,
    queryFn: fetchBuzzConnection,
    staleTime: 5 * 60_000,
  });
  const data = connection.data;
  const stored =
    readStoredPreference(DISMISSED_KEY, (raw) =>
      raw === "1" ? true : null,
    ) === true;
  const show =
    !dismissed &&
    !stored &&
    state !== "collapsed" &&
    data?.available === true &&
    data.identity !== null &&
    data.lastActiveOnBuzzAt === null &&
    data.app?.status !== "linked";

  return (
    <>
      {show ? (
        <div className="p-2 pb-0">
          <article className="border-sidebar-border bg-sidebar relative rounded-lg border p-3 shadow-xs">
            <button
              type="button"
              onClick={() => {
                writeStoredPreference(DISMISSED_KEY, "1");
                setDismissed(true);
              }}
              className="hit-area text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-sidebar-ring absolute top-2 right-2 rounded-md p-1 transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
              aria-label={t("card.dismiss")}
            >
              <X className="size-3.5" />
            </button>
            <div className="flex items-center gap-2">
              <BuzzLogo className="size-6 rounded-md" />
              <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-2xs font-semibold">
                {t("card.new")}
              </span>
            </div>
            <p className="mt-2 text-sm leading-tight font-medium">
              {t("card.title")}
            </p>
            <p className="text-sidebar-foreground mt-1 line-clamp-2 text-xs leading-4">
              {t("card.summary")}
            </p>
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setOpen(true)}
              >
                {t("card.connect")}
              </Button>
            </div>
          </article>
        </div>
      ) : null}
      <BuzzConnectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
