"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Inbox, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { SOKO_BOT_PROVIDER_LOGOS } from "@/components/soko-bot/provider-logos";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { connectSokoBotIntegrationAction } from "@/lib/actions/soko-bot/action";
import type {
  SokoBotConnectOffer,
  SokoBotConnectPromptState,
} from "@/lib/soko-bot/connect-prompt";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

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
export function SokoBotConnectPrompt({ sokoBotId }: { sokoBotId: string }) {
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
    <SokoBotConnectCard
      botName={data.botName}
      offers={data.offers}
      onDismiss={dismiss}
    />
  );
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

  // The composer owns the outer inset; the tray sits one step inside it.
  return (
    <section
      data-testid="soko-bot-connect-prompt"
      aria-label={t("connectTitle", { bot: botName })}
      className="border-border bg-background-muted mx-3 -mb-px flex items-center gap-3 rounded-t-lg border border-b-0 py-1.5 ps-3 pe-1.5"
    >
      <Inbox aria-hidden className="text-muted-foreground size-4 shrink-0" />
      {/* Wraps (up to three lines) rather than truncating: on a 320px phone one line
          leaves "Give Jarvis y…", which drops what the logos are for. */}
      <p className="line-clamp-3 min-w-0 flex-1 text-xs leading-5 [overflow-wrap:anywhere]">
        <span className="font-medium">
          {t("connectTitle", { bot: botName })}
        </span>
        <span className="text-muted-foreground max-sm:hidden">
          {" · "}
          {t("connectBody")}
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-0.5">
        {offers.map((offer) => {
          const Logo = SOKO_BOT_PROVIDER_LOGOS[offer.provider];
          const label = offer.connected
            ? t("connectConnected", { name: offer.name })
            : t("connectProvider", { name: offer.name });
          return (
            <Tooltip key={offer.provider}>
              <TooltipTrigger asChild>
                {/* aria-disabled, not disabled: a connected provider keeps
                      its tooltip and stays reachable, it just does nothing. */}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={label}
                  aria-disabled={offer.connected || busy !== null}
                  onClick={() => {
                    if (!offer.connected && busy === null)
                      connect(offer.provider);
                  }}
                  className="relative size-7 aria-disabled:cursor-default"
                >
                  {Logo ? <Logo className="size-4 shrink-0" /> : null}
                  {offer.connected ? (
                    <Check
                      aria-hidden
                      className="bg-background text-semantic-success absolute -end-0.5 -bottom-0.5 size-3 rounded-full"
                    />
                  ) : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{label}</TooltipContent>
            </Tooltip>
          );
        })}
        <span aria-hidden className="bg-border mx-1 h-4 w-px" />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t("connectDismiss")}
          onClick={onDismiss}
          className="text-muted-foreground size-7"
        >
          <X aria-hidden className="size-3.5" />
        </Button>
      </div>
    </section>
  );
}
