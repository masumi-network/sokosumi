import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GradientBackground } from "@/components/gradient-background";
import { Button } from "@/components/ui/button";
import { SOKO_BOT_FROM_HOME_ROUTE } from "@/lib/soko-bot/constants";

/**
 * `/` for a user without a personal Soko Bot: the way into its setup.
 */
export async function SokoBotSetup() {
  const t = await getTranslations("App.Chat.Landing.SokoBotSetup");

  return (
    <div className="relative isolate flex min-h-full w-full min-w-0 flex-1 flex-col items-center justify-center px-4">
      {/* Bleeds through main's p-4 to its edges, as on the Soko Bot Home. */}
      <GradientBackground className="absolute -inset-x-4 -top-4 -z-10 h-[42rem]" />
      <div className="flex w-full max-w-3xl flex-col items-center gap-8 py-10 text-center">
        <div className="flex flex-col gap-3">
          <h1 className="text-foreground text-3xl font-normal tracking-tight text-balance md:text-4xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-base text-pretty md:text-lg">
            {t("intro")}
          </p>
        </div>
        <Button asChild variant="primary" size="lg">
          <Link href={SOKO_BOT_FROM_HOME_ROUTE}>{t("cta")}</Link>
        </Button>
      </div>
    </div>
  );
}
