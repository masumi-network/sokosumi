import { getTranslations } from "next-intl/server";
import type { Coworker } from "@/app/chat/utils/types";
import { SokosumiIcon } from "@/components/masumi-logos";

import { resolveFeaturedCoworker } from "./landing-content";
import { LandingCoworkerPicker } from "./landing-coworker-picker.client";
import { OpenCoworkerRoomProvider } from "./use-open-coworker-room";

interface ChatLandingProps {
  coworkers: Coworker[];
  /** Given name already resolved, or null for the nameless greeting. */
  userName: null | string;
}

/**
 * Desktop composition of the `/chat` welcome (`chat-landing.tsx`).
 *
 * Pair of {@link ChatLandingMobile} (`chat-landing.mobile.tsx`): same content
 * decisions from `landing-content`, larger type. Owns `/chat` at
 * `md` and up.
 *
 * The top of Home: Needs you, Projects and the team's day follow it, so it
 * keeps to its content's height and uses the compact strip rather than
 * filling the viewport. The last-24-hours counts head the team day panel.
 */
export async function ChatLanding({ coworkers, userName }: ChatLandingProps) {
  const t = await getTranslations("App.Chat.Landing");
  const featured = resolveFeaturedCoworker(coworkers);

  return (
    // `-mx-4` cancels app-main `p-4` so the strip can use the full content
    // pane. No middle-column `px-*` / `max-w-*`: pad pitch + CTA only.
    // Padding on an overflow-y ancestor clips edge faces.
    <div className="-mx-4 flex w-[calc(100%+2rem)] min-w-0 flex-col items-stretch justify-start pt-6 text-center lg:pt-10">
      <SokosumiIcon
        animated={false}
        className="text-foreground shrink-0 self-center"
        height={40}
        width={40}
      />

      <h1 className="text-foreground mt-6 shrink-0 px-4 text-2xl font-light text-balance md:text-3xl tracking-tight">
        {userName ? t("greetingWithName", { name: userName }) : t("greeting")}
      </h1>

      <p className="text-muted-foreground mt-3 shrink-0 px-4 text-base leading-[1.65] md:whitespace-nowrap">
        {t("intro")}
      </p>

      {featured ? (
        <OpenCoworkerRoomProvider>
          <LandingCoworkerPicker
            coworkers={coworkers}
            initialSelectedId={featured.id}
            size="compact"
          />
        </OpenCoworkerRoomProvider>
      ) : null}
    </div>
  );
}
