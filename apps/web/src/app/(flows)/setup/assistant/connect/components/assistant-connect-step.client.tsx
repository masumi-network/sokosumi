"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { SOKO_BOT_PROVIDER_LOGOS } from "@/components/soko-bot/provider-logos";
import {
  SOKO_BOT_SETUP_FRAME_CLASS,
  SokoBotSetupHeader,
  SokoBotSetupSteps,
} from "@/components/soko-bot/setup-steps";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { SokoBotConnectOffer } from "@/lib/soko-bot/connect-prompt";
import { startSokoBotConnect } from "@/lib/soko-bot/start-integration-connect";

interface AssistantConnectStepProps {
  botName: string;
  /** The picture picked on the step before; null shows the bot's orb. */
  botImageUrl: string | null;
  botOrbSeed: string;
  offers: SokoBotConnectOffer[];
  /** The bot's chat, where this step ends. */
  chatUrl: string;
  /** This page, where OAuth comes back to. */
  returnTo: string;
}

/** Optional: give the new bot mail and calendar, then open its chat. */
export function AssistantConnectStep({
  botName,
  botImageUrl,
  botOrbSeed,
  offers,
  chatUrl,
  returnTo,
}: AssistantConnectStepProps) {
  const t = useTranslations("WorkspaceGate.Assistant");
  const tConnect = useTranslations("App.Chat.SokoBot");
  const [busy, setBusy] = useState<string | null>(null);
  const anyConnected = offers.some((offer) => offer.connected);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The Picture step's Create button held focus and is gone, so start this
  // step at its heading, as the earlier steps do.
  useMountEffect(() => {
    headingRef.current?.focus();
  });

  async function handleConnect(provider: string) {
    setBusy(provider);
    const error = await startSokoBotConnect(provider, { returnTo });
    if (error) {
      setBusy(null);
      toast.error(error.message ?? tConnect("connectError"));
    }
  }

  return (
    <div className={SOKO_BOT_SETUP_FRAME_CLASS}>
      <SokoBotSetupSteps current={3} />
      <SokoBotSetupHeader
        imageUrl={botImageUrl}
        seed={botOrbSeed}
        title={tConnect("connectTitle", { bot: botName })}
        hint={tConnect("connectBody")}
        headingRef={headingRef}
      />
      <div className="flex flex-col gap-3">
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
        className="w-full"
      >
        <Link href={chatUrl} replace>
          {t(anyConnected ? "continue" : "skip")}
        </Link>
      </Button>
    </div>
  );
}
