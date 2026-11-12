"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
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
 * closes it (the x, or "Not now" in the dialog). Only where an organization of theirs is on
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
  const dismiss = () => {
    writeStoredPreference(DISMISSED_KEY, "1");
    setDismissed(true);
  };
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
    data.app?.authorized !== true &&
    // On Buzz with the key Sokosumi keeps: nothing left to set up.
    !(data.lastActiveOnBuzzAt !== null && data.app === null);

  return (
    <>
      {show ? (
        // Floats over the end of the chat list, anchored on the footer's top
        // edge: the list fades out beneath it and the card casts a shadow, so
        // it reads as on top. Open it or close it with the x.
        <div className="animate-in fade-in-0 slide-in-from-bottom-1 pointer-events-none absolute inset-x-0 bottom-full z-10 duration-200 ease-out motion-reduce:animate-none">
          <div className="to-sidebar from-transparent h-6 bg-linear-to-b" />
          <div className="bg-sidebar px-2 pb-2">
            <BuzzSurface
              bees={false}
              className="press pointer-events-auto rounded-lg p-3 shadow-lg"
            >
              <BuzzMark className="w-7" />
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-3 block text-left text-base leading-tight font-bold tracking-[-0.02em] outline-hidden after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-current"
              >
                {t("card.title")}
              </button>
              <p className="mt-1 text-xs leading-4">{t("card.summary")}</p>
              <span className="mt-3 flex">
                <BuzzPill>{t("card.connect")}</BuzzPill>
              </span>
              <button
                type="button"
                onClick={dismiss}
                aria-label={t("card.close")}
                className="press hit-area absolute top-1.5 right-1.5 z-10 flex size-7 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-hidden"
              >
                <X className="size-4" />
              </button>
            </BuzzSurface>
          </div>
        </div>
      ) : null}
      <BuzzConnectDialog
        open={open}
        onOpenChange={setOpen}
        resume={data?.app?.status === "linked"}
        onNotNow={() => {
          dismiss();
          setOpen(false);
        }}
      />
    </>
  );
}
