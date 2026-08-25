import { ArrowRight, Bot, Plus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AuroraOrb } from "@/components/aurora-orb";
import { SokoBotStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import { Button } from "@/components/ui/button";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import type { SokoBotTeam } from "@/lib/clients/generated/core";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

import { MessageBotButton } from "./message-bot-button.client";

type Member = SokoBotTeam["members"][number];

/** The user's own Soko Bots: open the one they have, or the call to create it. */
export async function YourSokoBots({ me }: { me: Member | null }) {
  const t = await getTranslations("App.SokoBots");
  const bot = me?.bot ?? null;
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{t("yoursTitle")}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {bot && me ? (
          <div className="bg-background flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center gap-3">
              {bot.avatarImageUrl ? (
                <img
                  src={bot.avatarImageUrl}
                  alt=""
                  className="ring-border/40 size-12 shrink-0 rounded-full object-cover ring-1"
                />
              ) : (
                <AuroraOrb
                  seed={bot.avatarSeed ?? defaultOrbSeed(me.userId)}
                  size={96}
                  alt=""
                  className="ring-border/40 size-12 shrink-0 ring-1"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  <span className="truncate">
                    {bot.name?.trim() || t("assistantFallback")}
                  </span>
                  <SokoBotStatusBadge status={bot.status} />
                </p>
                <p className="text-muted-foreground text-sm">
                  {t("yourAssistantBlurb")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm">
                <Link href={SOKO_BOT_ROUTE}>
                  {t("manage")}
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </Button>
              {bot.coworkerId ? (
                <MessageBotButton
                  coworkerId={bot.coworkerId}
                  label={t("openChat")}
                  errorLabel={t("chatError")}
                  variant="button"
                />
              ) : null}
            </div>
          </div>
        ) : (
          <Link
            href={SOKO_BOT_ROUTE}
            className="border-primary/50 hover:border-primary hover:bg-primary/5 flex flex-col gap-4 rounded-lg border-2 border-dashed p-4 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="bg-primary text-primary-foreground inline-flex size-12 shrink-0 items-center justify-center rounded-full">
                <Plus aria-hidden className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-medium">{t("createAssistant")}</p>
                <p className="text-muted-foreground text-sm">
                  {t("createAssistantBlurb")}
                </p>
              </div>
            </div>
            <span className="text-primary inline-flex items-center gap-1 text-sm font-medium">
              {t("createNow")}
              <ArrowRight aria-hidden className="size-3.5" />
            </span>
          </Link>
        )}
        <div className="text-muted-foreground flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm">
          <span className="bg-muted inline-flex size-12 shrink-0 items-center justify-center rounded-full">
            <Bot aria-hidden className="size-5" />
          </span>
          <span>
            <span className="text-foreground block font-medium">
              {t("moreTitle")}
            </span>
            {t("moreComing")}
          </span>
        </div>
      </div>
    </section>
  );
}
