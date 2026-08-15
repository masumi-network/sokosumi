import { getFormatter, getTranslations } from "next-intl/server";

import type { Coworker } from "@/app/chat/utils/types";
import { SokosumiIcon } from "@/components/masumi-logos";
import type { TaskActivitySummary } from "@/lib/clients/generated/core";

import { buildActivityStats, resolveFeaturedCoworker } from "./landing-content";
import { LandingCoworkerPicker } from "./landing-coworker-picker.client";
import { OpenCoworkerRoomProvider } from "./use-open-coworker-room";

interface ChatLandingProps {
  coworkers: Coworker[];
  /** True only for an organization workspace, where other humans exist. */
  isOrganizationWorkspace: boolean;
  /** Null when Core could not be reached; chips still render as zeros. */
  summary: TaskActivitySummary | null;
  /** Given name already resolved, or null for the nameless greeting. */
  userName: null | string;
}

/**
 * Desktop composition of the `/chat` welcome (`chat-landing.tsx`).
 *
 * Pair of {@link ChatLandingMobile} (`chat-landing.mobile.tsx`): same content
 * decisions from `landing-content`, larger strip and type. Owns `/chat` at
 * `md` and up.
 *
 * Middle column is top-aligned so Start chat stays put across coworker
 * selection. Stats stay `shrink-0` at the bottom of the viewport-tall column —
 * always mounted, including zero chips — so the first view keeps the row.
 */
export async function ChatLanding({
  coworkers,
  isOrganizationWorkspace,
  summary,
  userName,
}: ChatLandingProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Chat.Landing"),
    getFormatter(),
  ]);
  const featured = resolveFeaturedCoworker(coworkers);
  const stats = buildActivityStats(summary, isOrganizationWorkspace, t);

  return (
    // `-mx-4` cancels app-main `p-4` so the strip can use the full content
    // pane. No middle-column `px-*` / `max-w-*`: pad pitch + stats + CTA only.
    // Padding on an overflow-y ancestor clips edge faces.
    <div className="-mx-4 flex h-full min-h-0 w-[calc(100%+2rem)] min-w-0 flex-1 flex-col items-stretch pt-10 lg:pt-16">
      <SokosumiIcon
        animated={false}
        className="text-foreground shrink-0 self-center"
        height={48}
        width={48}
      />

      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-stretch justify-start overflow-y-auto py-8 text-center lg:py-12">
        <h1 className="text-foreground shrink-0 px-4 text-2xl font-light text-balance md:text-4xl">
          {userName ? t("greetingWithName", { name: userName }) : t("greeting")}
        </h1>

        <p className="text-muted-foreground mt-4 shrink-0 px-4 text-base leading-[1.65] md:mt-6 md:text-lg md:whitespace-nowrap">
          {t("intro")}
        </p>

        {featured ? (
          <OpenCoworkerRoomProvider>
            <LandingCoworkerPicker
              coworkers={coworkers}
              initialSelectedId={featured.id}
            />
          </OpenCoworkerRoomProvider>
        ) : null}
      </div>

      <div
        className="flex w-full shrink-0 flex-col items-center gap-3 px-4 pb-4"
        data-testid="landing-activity-stats"
      >
        <p className="text-muted-foreground/70 text-[0.8125rem]">
          {summary?.basis === "lastVisit"
            ? t("stats.sinceLastActivity", {
                when: format.relativeTime(summary.since),
              })
            : t("stats.recent")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {stats.map((stat) => (
            <span
              className="bg-card text-muted-foreground rounded-full border px-3 py-1.5 text-[0.8125rem] tabular-nums"
              key={stat}
            >
              {stat}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
