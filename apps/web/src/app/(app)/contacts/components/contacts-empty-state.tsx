"use client";
import { Check, FileSpreadsheet, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SOKO_BOT_PROVIDER_LOGOS } from "@/components/soko-bot/provider-logos";
import { Button } from "@/components/ui/button";
import type { SokoBotConnectOffer } from "@/lib/soko-bot/connect-prompt";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { startSokoBotConnect } from "@/lib/soko-bot/start-integration-connect";

/**
 * No contacts yet. They arrive on their own from connected mail, calendar
 * and Slack, so the first thing to offer is connecting them.
 */
export function ContactsEmptyState({
  offers,
  onAdd,
  onImport,
}: {
  offers: SokoBotConnectOffer[] | null;
  onAdd: () => void;
  onImport: () => void;
}) {
  const t = useTranslations("App.Contacts.empty");
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function connect(provider: string) {
    setBusy(provider);
    startTransition(async () => {
      const error = await startSokoBotConnect(provider, {
        returnTo: "/contacts",
      });
      if (error) {
        setBusy(null);
        toast.error(error.message ?? t("connectFailed"));
      }
    });
  }

  return (
    <div className="content-rise mx-auto flex max-w-md flex-col items-center gap-5 px-6 py-16 text-center">
      <span
        aria-hidden
        className="bg-primary-quinary text-foreground flex size-12 items-center justify-center rounded-full"
      >
        <Users className="size-6" />
      </span>
      <div className="grid gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      {offers?.length ? (
        <div className="grid w-full gap-2">
          {offers.map((offer) => {
            const Logo = SOKO_BOT_PROVIDER_LOGOS[offer.provider];
            return (
              <Button
                key={offer.provider}
                variant="outline"
                className="w-full justify-start"
                disabled={offer.connected || busy !== null}
                loading={busy === offer.provider}
                onClick={() => connect(offer.provider)}
              >
                {Logo ? <Logo className="size-4 shrink-0" /> : null}
                <span className="flex-1 text-start">
                  {offer.connected
                    ? t("connected", { name: offer.name })
                    : t("connect", { name: offer.name })}
                </span>
                {offer.connected ? (
                  <Check aria-hidden className="text-muted-foreground size-4" />
                ) : null}
              </Button>
            );
          })}
        </div>
      ) : (
        <Button asChild variant="outline">
          <Link href={SOKO_BOT_ROUTE}>{t("manageConnections")}</Link>
        </Button>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <UserPlus aria-hidden className="size-4" />
          {t("addByHand")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onImport}>
          <FileSpreadsheet aria-hidden className="size-4" />
          {t("import")}
        </Button>
      </div>
    </div>
  );
}
