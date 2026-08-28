import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AuroraOrb } from "@/components/aurora-orb";
import { SokoBotStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import { Button } from "@/components/ui/button";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import type { SokoBotTeam } from "@/lib/clients/generated/core";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

import { MessageBotButton } from "./message-bot-button.client";

type Member = SokoBotTeam["members"][number];

/** The user's own Soko Bots: open the one they have, or the call to create it. */
export async function YourSokoBots({ me }: { me: Member | null }) {
  const t = await getTranslations("App.SokoBots");
  const bot = me?.bot ?? null;
  const previews = bot
    ? []
    : await sokoBotService.listAvatars(4, []).catch(() => []);
  return (
    <section className="space-y-3">
      <h2 className="text-foreground text-lg font-medium">{t("yoursTitle")}</h2>
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
          <div className="bg-background flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center gap-3">
              {previews.length > 0 ? (
                <span className="flex shrink-0 -space-x-3" aria-hidden>
                  {previews.map((avatar) => (
                    <img
                      key={avatar.id}
                      src={avatar.imageUrl}
                      alt=""
                      className="ring-background size-12 rounded-full object-cover ring-2"
                    />
                  ))}
                </span>
              ) : null}
              <div className="min-w-0">
                <p className="font-medium">{t("createAssistant")}</p>
                <p className="text-muted-foreground text-sm">
                  {t("createAssistantBlurb")}
                </p>
              </div>
            </div>
            <Button asChild className="w-fit">
              <Link href={SOKO_BOT_ROUTE}>
                {t("createNow")}
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            </Button>
          </div>
        )}
        <div className="text-muted-foreground flex items-center rounded-lg border border-dashed p-4 text-sm">
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
