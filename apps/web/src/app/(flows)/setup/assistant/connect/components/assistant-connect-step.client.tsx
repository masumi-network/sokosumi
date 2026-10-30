"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { SOKO_BOT_PROVIDER_LOGOS } from "@/components/soko-bot/provider-logos";
import { Button } from "@/components/ui/button";
import type { SokoBotConnectOffer } from "@/lib/soko-bot/connect-prompt";
import { startSokoBotConnect } from "@/lib/soko-bot/start-integration-connect";

interface AssistantConnectStepProps {
  botName: string;
  offers: SokoBotConnectOffer[];
  /** The bot's chat, where this step ends. */
  chatUrl: string;
  /** This page, where OAuth comes back to. */
  returnTo: string;
}

/** Optional: give the new bot mail and calendar, then open its chat. */
export function AssistantConnectStep({
  botName,
  offers,
  chatUrl,
  returnTo,
}: AssistantConnectStepProps) {
  const t = useTranslations("WorkspaceGate.Assistant");
  const tConnect = useTranslations("App.Chat.SokoBot");
  const [busy, setBusy] = useState<string | null>(null);
  const anyConnected = offers.some((offer) => offer.connected);

  async function handleConnect(provider: string) {
    setBusy(provider);
    const error = await startSokoBotConnect(provider, { returnTo });
    if (error) {
      setBusy(null);
      toast.error(error.message ?? tConnect("connectError"));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-12 md:py-20">
      <h1 className="text-foreground text-center text-2xl font-light tracking-tight text-balance md:text-3xl">
        {tConnect("connectTitle", { bot: botName })}
      </h1>
      <p className="text-muted-foreground mt-3 text-center text-sm text-pretty md:text-base">
        {tConnect("connectBody")}
      </p>
      <div className="mt-10 w-full space-y-3">
        {offers.map(({ provider, name, connected }) => {
          const Logo = SOKO_BOT_PROVIDER_LOGOS[provider];
          return (
            <Button
              key={provider}
              type="button"
              variant="outline"
              className="w-full"
              loading={busy === provider}
              disabled={connected || (busy !== null && busy !== provider)}
              onClick={() => void handleConnect(provider)}
            >
              {Logo ? <Logo className="size-4 shrink-0" /> : null}
              {connected
                ? tConnect("connectConnected", { name })
                : tConnect("connectProvider", { name })}
              {connected ? (
                <Check aria-hidden className="text-foreground size-4" />
              ) : null}
            </Button>
          );
        })}
      </div>
      <Button
        asChild
        variant={anyConnected ? "default" : "ghost"}
        className="mt-6 w-full"
      >
        <Link href={chatUrl} replace>
          {t(anyConnected ? "continue" : "skip")}
        </Link>
      </Button>
    </div>
  );
}
