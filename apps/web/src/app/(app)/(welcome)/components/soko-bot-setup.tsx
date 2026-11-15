import type { SokoBotAvatar } from "@sokosumi/core-client";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GradientBackground } from "@/components/gradient-background";
import { Button } from "@/components/ui/button";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

/** Pictures in the row; the middle one is the largest. */
export const SOKO_BOT_SETUP_FACES = 5;

/**
 * `/` for a user without a personal Soko Bot: a row of stock pictures it
 * could wear, and the way into its setup.
 */
export async function SokoBotSetup({ avatars }: { avatars: SokoBotAvatar[] }) {
  const t = await getTranslations("App.Chat.Landing.SokoBotSetup");
  const middle = Math.floor(avatars.length / 2);

  return (
    <div className="relative isolate flex min-h-full w-full min-w-0 flex-1 flex-col items-center justify-center px-4">
      {/* Bleeds through main's p-4 to its edges, as on the Soko Bot Home. */}
      <GradientBackground className="absolute -inset-x-4 -top-4 -z-10 h-[42rem]" />
      <div className="flex w-full max-w-3xl flex-col items-center gap-8 py-10 text-center">
        {avatars.length > 0 ? (
          <div aria-hidden className="flex items-center -space-x-3">
            {avatars.map((avatar, index) => {
              const distance = Math.abs(index - middle);
              return (
                <img
                  key={avatar.id}
                  src={avatar.imageUrl}
                  alt=""
                  style={{ zIndex: avatars.length - distance }}
                  className={cn(
                    "border-background relative rounded-full border-4 object-cover shadow-md",
                    distance === 0
                      ? "size-24 md:size-28"
                      : distance === 1
                        ? "size-16 md:size-20"
                        : "size-12 md:size-14",
                  )}
                />
              );
            })}
          </div>
        ) : null}
        <div className="flex flex-col gap-3">
          <h1 className="text-foreground text-3xl font-normal tracking-tight text-balance md:text-4xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-base text-pretty md:text-lg">
            {t("intro")}
          </p>
        </div>
        <Button asChild variant="primary" size="lg">
          <Link href={SOKO_BOT_ROUTE}>{t("cta")}</Link>
        </Button>
      </div>
    </div>
  );
}
