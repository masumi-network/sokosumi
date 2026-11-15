import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FoilBackground } from "@/components/foil-background";
import { BotFace } from "@/components/soko-bot/bot-face";
import { Button } from "@/components/ui/button";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

const POINTS = ["work", "moving", "inbox"] as const;

/**
 * `/` for a user without a personal Soko Bot: what the bot does, and the way
 * into its setup. The orb is the one the new bot starts with until it gets a
 * picture.
 */
export async function SokoBotSetup({ userId }: { userId: string }) {
  const t = await getTranslations("App.Chat.Landing.SokoBotSetup");

  return (
    <div className="relative isolate flex min-h-full w-full min-w-0 flex-1 flex-col items-center px-4">
      {/* Bleeds through main's p-4 to its edges, as on the Soko Bot Home. */}
      <FoilBackground className="absolute -inset-x-4 -top-4 -z-10 h-[42rem]" />
      <div className="flex w-full max-w-3xl flex-col items-center gap-8 pt-[12dvh] pb-10 text-center md:pt-[18dvh]">
        <BotFace
          imageUrl={null}
          seed={defaultOrbSeed(userId)}
          orbSize={64}
          className="size-16"
        />
        <div className="flex flex-col gap-3">
          <h1 className="text-foreground text-3xl font-normal tracking-tight text-balance md:text-4xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mx-auto max-w-xl text-base text-pretty md:text-lg">
            {t("intro")}
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <Button asChild variant="primary" size="lg">
            <Link href={SOKO_BOT_ROUTE}>{t("cta")}</Link>
          </Button>
          <p className="text-muted-foreground text-sm">{t("hint")}</p>
        </div>
        <ul className="grid w-full gap-6 pt-8 text-left sm:grid-cols-3">
          {POINTS.map((point) => (
            <li key={point} className="flex flex-col gap-1">
              <p className="text-foreground text-sm font-medium">
                {t(`points.${point}.title`)}
              </p>
              <p className="text-muted-foreground text-sm text-pretty">
                {t(`points.${point}.description`)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
