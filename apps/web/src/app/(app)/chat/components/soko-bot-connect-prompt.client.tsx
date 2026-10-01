"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Mail, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { connectSokoBotIntegrationAction } from "@/lib/actions/soko-bot/action";
import type { SokoBotConnectPromptState } from "@/lib/soko-bot/connect-prompt";
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
  const t = useTranslations("App.Chat.SokoBot");
  const { data } = useQuery({
    queryKey: ["soko-bot-connect-prompt"],
    queryFn: fetchPrompt,
    staleTime: 5 * 60_000,
  });
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (
    !data ||
    data.botId !== sokoBotId ||
    dismissed ||
    readDismissed(sokoBotId)
  )
    return null;

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

  function dismiss() {
    try {
      window.localStorage.setItem(`${DISMISSED_KEY}:${sokoBotId}`, "1");
    } catch {}
    setDismissed(true);
  }

  return (
    <div
      data-testid="soko-bot-connect-prompt"
      className="border-border bg-card-background mb-2 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
    >
      <p className="text-muted-foreground min-w-0 flex-1">
        {t("connectPrompt", { bot: data.botName })}
      </p>
      <div className="flex items-center gap-2">
        {data.missing.map((offer) => {
          const Icon = offer.kind === "email" ? Mail : CalendarDays;
          return (
            <Button
              key={offer.provider}
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => connect(offer.provider)}
            >
              <Icon aria-hidden className="size-4" />
              {t("connectProvider", { name: offer.name })}
            </Button>
          );
        })}
        <button
          type="button"
          aria-label={t("connectDismiss")}
          onClick={dismiss}
          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1 transition-colors"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}
