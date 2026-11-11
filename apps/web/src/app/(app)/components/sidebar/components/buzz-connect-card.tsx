"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  BUZZ_CONNECTION_QUERY_KEY,
  BuzzConnectDialog,
  fetchBuzzConnection,
} from "@/components/buzz/buzz-connect-dialog";
import { BuzzBanner } from "@/components/buzz/buzz-logo";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/utils/preference-storage";

const DISMISSED_KEY = "sokosumi:buzz-connect-card:dismissed";

/**
 * "Chat from Buzz" in the sidebar footer, drawn as an announcement card,
 * until the person is on Buzz (seen there, or their own Buzz app linked) or
 * says "Not now" in the dialog. Only where an organization of theirs is on
 * Buzz.
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
        // Floats over the end of the chat list, anchored on the footer's top
        // edge, so the footer keeps its height and nothing moves. White with a
        // hairline, like our components: no shadow.
        <div className="animate-in fade-in-0 slide-in-from-bottom-1 pointer-events-none absolute inset-x-0 bottom-full z-10 px-2 pb-2 duration-200 ease-out motion-reduce:animate-none">
          <div className="pointer-events-auto">
            <article
              className="border-border bg-card press hover:bg-quinary focus-visible:ring-sidebar-ring relative cursor-pointer overflow-hidden rounded-lg border transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
              role="button"
              tabIndex={0}
              onClick={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setOpen(true);
                }
              }}
            >
              <BuzzBanner />
              <div className="space-y-2 p-3">
                <p className="line-clamp-1 text-sm leading-tight font-medium">
                  {t("card.title")}
                </p>
                <p className="text-sidebar-foreground line-clamp-2 text-xs leading-4">
                  {t("card.summary")}
                </p>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen(true);
                    }}
                  >
                    {t("card.connect")}
                  </Button>
                </div>
              </div>
            </article>
          </div>
        </div>
      ) : null}
      <BuzzConnectDialog
        open={open}
        onOpenChange={setOpen}
        onNotNow={() => {
          writeStoredPreference(DISMISSED_KEY, "1");
          setDismissed(true);
          setOpen(false);
        }}
      />
    </>
  );
}
