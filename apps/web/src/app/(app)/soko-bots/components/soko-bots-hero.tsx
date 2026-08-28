import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AuroraOrb } from "@/components/aurora-orb";
import { SokoBotStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import { Button } from "@/components/ui/button";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import type { SokoBotAvatar, SokoBotTeam } from "@/lib/clients/generated/core";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

import { MessageBotButton } from "./message-bot-button.client";

type Member = SokoBotTeam["members"][number];

/** Overlapping faces: the mascots if we have them, the workspace's bots if not. */
function AvatarStack({
  avatars,
  seeds,
}: {
  avatars: SokoBotAvatar[];
  seeds: string[];
}) {
  const hasFaces = avatars.length > 0 || seeds.length > 0;
  if (!hasFaces) return null;
  return (
    <span className="flex shrink-0 -space-x-4" aria-hidden>
      {avatars.map((avatar) => (
        <img
          key={avatar.id}
          src={avatar.imageUrl}
          alt=""
          className="ring-background size-14 rounded-full object-cover ring-3 sm:size-16"
        />
      ))}
      {seeds.map((seed) => (
        <AuroraOrb
          key={seed}
          seed={seed}
          size={128}
          alt=""
          className="ring-background size-14 ring-3 sm:size-16"
        />
      ))}
    </span>
  );
}

/**
 * The page's opening statement: what a Soko Bot is, a row of faces, and the
 * one action that matters — create yours, or open the one you have.
 */
export async function SokoBotsHero({
  me,
  avatars,
}: {
  me: Member | null;
  avatars: SokoBotAvatar[];
}) {
  const t = await getTranslations("App.SokoBots");
  const bot = me?.bot ?? null;

  // Your own bot leads the stack when you have one; mascots fill the rest.
  const seeds = bot && me ? [bot.avatarSeed ?? defaultOrbSeed(me.userId)] : [];
  const faces = avatars.slice(0, bot ? 4 : 5);

  return (
    <section className="bg-card/40 relative overflow-hidden rounded-xl border">
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="space-y-4">
          <span className="text-primary inline-flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
            <Sparkles aria-hidden className="size-3.5" />
            {t("heroEyebrow")}
          </span>
          <h1 className="text-foreground max-w-3xl text-3xl font-semibold tracking-tight text-balance md:text-4xl">
            {t("heroTitle")}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed sm:text-base">
            {t("heroBody")}
          </p>
        </div>

        <AvatarStack
          avatars={bot ? faces : avatars.slice(0, 5)}
          seeds={seeds}
        />

        {bot && me ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground flex items-center gap-2 text-sm">
              <span className="text-foreground font-medium">
                {bot.name?.trim() || t("assistantFallback")}
              </span>
              <SokoBotStatusBadge status={bot.status} />
            </span>
            <span className="grow" />
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
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href={SOKO_BOT_ROUTE}>
                {t("heroCta")}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </Button>
            <p className="text-muted-foreground text-xs">{t("heroCtaHint")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
