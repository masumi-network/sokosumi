"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { SOKO_BOT_PROVIDER_LOGOS } from "@/components/soko-bot/provider-logos";
import { Button } from "@/components/ui/button";
import { connectSokoBotIntegrationAction } from "@/lib/actions/soko-bot/action";
import type {
  SokoBotConnectOffer,
  SokoBotConnectPromptState,
} from "@/lib/soko-bot/connect-prompt";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

import { SokoBotConnectPromptPrototype } from "./soko-bot-connect-prompt.prototype.client";

/** The bot's face, for prompt designs that show who is asking. */
export interface SokoBotConnectFace {
  image: string | null;
  avatarSeed: string | null;
}

const DISMISSED_KEY = "soko-bot-connect-prompt-dismissed";

function readDismissed(botId: string): boolean {
  try {
    return window.localStorage.getItem(`${DISMISSED_KEY}:${botId}`) === "1";
  } catch {
    return false;
  }
}

async function fetchPrompt(): Promise<SokoBotConnectPromptState | null> {
  const response = await fetch("/api/personal-assistant/connect-prompt", {
    credentials: "same-origin",
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    prompt: SokoBotConnectPromptState | null;
  };
  return body.prompt;
}

/**
 * Above the composer in the owner's own bot DM, while mail or calendar is
 * not connected: most of what the bot does on its own needs them.
 */
export function SokoBotConnectPrompt({
  sokoBotId,
  face = null,
}: {
  sokoBotId: string;
  face?: SokoBotConnectFace | null;
}) {
  const { data } = useQuery({
    queryKey: ["soko-bot-connect-prompt"],
    queryFn: fetchPrompt,
    staleTime: 5 * 60_000,
  });
  const [dismissed, setDismissed] = useState(false);

  if (
    !data ||
    data.botId !== sokoBotId ||
    dismissed ||
    readDismissed(sokoBotId)
  )
    return null;

  function dismiss() {
    try {
      window.localStorage.setItem(`${DISMISSED_KEY}:${sokoBotId}`, "1");
    } catch {}
    setDismissed(true);
  }

  return (
    <SokoBotConnectPromptPrototype
      botName={data.botName}
      face={face}
      offers={data.offers}
      onDismiss={dismiss}
    />
  );
}

/** Starts a provider's OAuth flow; `busy` names the provider in flight. */
export function useConnectProvider() {
  const t = useTranslations("App.Chat.SokoBot");
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function connect(provider: string) {
    setBusy(provider);
    startTransition(async () => {
      const returnUrl = `${window.location.origin}${SOKO_BOT_ROUTE}/integrations/return?provider=${encodeURIComponent(provider)}`;
      const result = await connectSokoBotIntegrationAction({
        provider,
        returnUrl,
      });
      if (!result.ok) {
        setBusy(null);
        toast.error(result.error.message ?? t("connectError"));
        return;
      }
      window.location.assign(result.value.redirectUrl);
    });
  }

  return { busy, connect };
}

/** The card itself, without the fetch, so it renders in tests and previews. */
export function SokoBotConnectCard({
  botName,
  offers,
  onDismiss,
}: {
  botName: string;
  offers: SokoBotConnectOffer[];
  onDismiss: () => void;
}) {
  const t = useTranslations("App.Chat.SokoBot");
  const { busy, connect } = useConnectProvider();

  return (
    <section
      data-testid="soko-bot-connect-prompt"
      aria-label={t("connectTitle", { bot: botName })}
      className="border-border bg-card-background relative mb-2 flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="min-w-0 flex-1 pr-6 sm:pr-0">
        <p className="text-sm font-medium">
          {t("connectTitle", { bot: botName })}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t("connectBody")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {offers.map((offer) => {
          const Logo = SOKO_BOT_PROVIDER_LOGOS[offer.provider];
          return (
            <Button
              key={offer.provider}
              type="button"
              size="sm"
              variant="outline"
              disabled={offer.connected || busy !== null}
              aria-label={
                offer.connected
                  ? t("connectConnected", { name: offer.name })
                  : t("connectProvider", { name: offer.name })
              }
              onClick={() => connect(offer.provider)}
              className="gap-2"
            >
              {Logo ? <Logo className="size-4 shrink-0" /> : null}
              <span>{offer.name}</span>
              {offer.connected ? (
                <Check aria-hidden className="text-semantic-success size-3.5" />
              ) : null}
            </Button>
          );
        })}
      </div>
      <button
        type="button"
        aria-label={t("connectDismiss")}
        onClick={onDismiss}
        className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-2 right-2 rounded p-1 transition-colors sm:static"
      >
        <X aria-hidden className="size-4" />
      </button>
    </section>
  );
}
