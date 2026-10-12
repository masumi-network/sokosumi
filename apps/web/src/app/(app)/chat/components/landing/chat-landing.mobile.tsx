import type { TaskActivitySummary } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import type { Coworker } from "@/app/chat/utils/types";

import { ActivityTrend } from "./activity-trend";
import { buildActivityStats, resolveFeaturedCoworker } from "./landing-content";
import { LandingCoworkerPicker } from "./landing-coworker-picker.client";
import { OpenCoworkerRoomProvider } from "./use-open-coworker-room";

interface ChatLandingMobileProps {
  coworkers: Coworker[];
  /** True only for an organization workspace, where other humans exist. */
  isOrganizationWorkspace: boolean;
  /** Null when Core could not be reached; chips still render as zeros. */
  summary: TaskActivitySummary | null;
  /** Given name already resolved, or null for the nameless greeting. */
  userName: null | string;
}

/**
 * Mobile composition of the `/chat` welcome (`chat-landing.mobile.tsx`).
 *
 * Pair of {@link ChatLanding} (`chat-landing.tsx`): pitch + stats for a narrow
 * column. Brand mark lives only in the mobile header leading slot — do not
 * re-render `SokosumiIcon` here. Middle column centers its content with
 * `my-auto` (not `justify-center`, which clips overflow) so it stays
 * scrollable. Stats stay pinned at the bottom — always mounted with zero chips when idle.
 *
 * No section/column `px-*`: horizontal padding on pitch + stats + selected
 * block only so the coworker strip can span full content width. `/chat` page
 * shell also uses `-m-4` to cancel app-main `p-4` (same as `/chat`);
 * without that the strip stays inset 16px under main padding.
 */
export async function ChatLandingMobile({
  coworkers,
  isOrganizationWorkspace,
  summary,
  userName,
}: ChatLandingMobileProps) {
  const t = await getTranslations("App.Chat.Landing");
  const featured = resolveFeaturedCoworker(coworkers);
  const stats = buildActivityStats(summary, isOrganizationWorkspace, t);

  return (
    <section className="flex size-full min-h-0 min-w-0 flex-1 flex-col items-stretch pt-4 pb-3 text-center">
      <div className="app-scrollbar flex min-h-0 w-full min-w-0 flex-1 flex-col items-stretch overflow-y-auto py-4">
        <div className="my-auto flex w-full min-w-0 flex-col items-stretch">
          <h1 className="text-foreground shrink-0 px-4 text-2xl font-light text-balance tracking-tight">
            {userName
              ? t("greetingWithName", { name: userName })
              : t("greeting")}
          </h1>

          <p className="text-muted-foreground mt-2 shrink-0 px-4 text-sm leading-[1.6]">
            {t("intro")}
          </p>

          {featured ? (
            <OpenCoworkerRoomProvider>
              <LandingCoworkerPicker
                coworkers={coworkers}
                initialSelectedId={featured.id}
                size="compact"
                startChatClassName="w-full"
                showSearchAgents
              />
            </OpenCoworkerRoomProvider>
          ) : null}
        </div>
      </div>

      <div
        className="flex w-full shrink-0 flex-col items-center gap-2 px-4 pt-1"
        data-testid="landing-activity-stats"
      >
        <p className="text-muted-foreground text-xs">{t("stats.recent")}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {stats.map((stat) => (
            <span
              className="bg-card text-muted-foreground inline-flex items-center rounded-full border px-2.5 py-1 text-xs tabular-nums"
              key={stat.label}
            >
              {stat.label}
              <ActivityTrend trend={stat.trend} />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
