import type { SokoBotTeam } from "@sokosumi/core-client";
import { ArrowRight, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SokoBotStatusLine } from "@/components/soko-bot/soko-bot-badges";
import { Button } from "@/components/ui/button";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

import { BotFace } from "./bot-face";
import { ChatWithBotButton } from "./open-bot-chat.client";

type Member = SokoBotTeam["members"][number];

/** The viewer's own assistant: one row with the two things you do with it. */
export async function YourAssistant({ me }: { me: Member | null }) {
  const t = await getTranslations("App.SokoBots");
  const bot = me?.bot ?? null;

  if (!bot || !me) {
    return (
      <section className="bg-card-background flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:p-5">
        <span className="bg-primary-quinary text-primary inline-flex size-12 shrink-0 items-center justify-center rounded-full">
          <Plus aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-foreground text-sm font-medium">
            {t("noAssistantYou")}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("createAssistantHint")}
          </p>
        </div>
        <Button asChild size="sm" className="w-full sm:w-auto">
          <Link href={SOKO_BOT_ROUTE}>
            {t("createAssistant")}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </Button>
      </section>
    );
  }

  const name = bot.name?.trim() || t("assistantFallback");
  return (
    <section
      aria-label={t("yourAssistant")}
      className="bg-card-background flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:p-5"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <BotFace bot={bot} ownerId={me.userId} className="size-12" />
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-xs">{t("yourAssistant")}</p>
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-foreground truncate text-base font-semibold tracking-tight">
              {name}
            </span>
            <SokoBotStatusLine status={bot.status} />
          </div>
          <p className="text-muted-foreground truncate text-sm">
            {t("yourAssistantHint")}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ChatWithBotButton
          sokoBotId={bot.id}
          label={t("chat")}
          errorLabel={t("chatError")}
        />
        <Button asChild size="sm" variant="ghost">
          <Link href={SOKO_BOT_ROUTE}>
            <Settings aria-hidden className="size-3.5" />
            {t("manage")}
          </Link>
        </Button>
      </div>
    </section>
  );
}
