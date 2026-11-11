"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BuzzMark, BuzzPill, BuzzSurface } from "@/components/buzz/buzz-brand";
import {
  BUZZ_CONNECTION_QUERY_KEY,
  BuzzConnectDialog,
  fetchBuzzConnection,
} from "@/components/buzz/buzz-connect-dialog";
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
        // edge, so the footer keeps its height and nothing moves. Drawn in
        // Buzz's own style (yellow, dots, ink pill), no shadow, no hover.
        <div className="animate-in fade-in-0 slide-in-from-bottom-1 pointer-events-none absolute inset-x-0 bottom-full z-10 px-2 pb-2 duration-200 ease-out motion-reduce:animate-none">
          <div className="pointer-events-auto">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="press focus-visible:ring-sidebar-ring block w-full rounded-lg text-left focus-visible:ring-2 focus-visible:outline-hidden"
            >
              <BuzzSurface className="rounded-lg p-3">
                <BuzzMark className="w-7" />
                <p className="mt-3 text-base leading-tight font-bold tracking-[-0.02em]">
                  {t("card.title")}
                </p>
                <p className="mt-1 text-xs leading-4">{t("card.summary")}</p>
                <span className="mt-3 flex">
                  <BuzzPill>{t("card.connect")}</BuzzPill>
                </span>
              </BuzzSurface>
            </button>
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
