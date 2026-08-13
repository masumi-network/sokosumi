import { getFormatter, getTranslations } from "next-intl/server";

import type { Coworker } from "@/app/chat/utils/types";
import { SokosumiIcon } from "@/components/masumi-logos";
import type { TaskActivitySummary } from "@/lib/clients/generated/core";

import { buildActivityStats, resolveFeaturedCoworker } from "./landing-content";
import { LandingCoworkerPicker } from "./landing-coworker-picker.client";
import { OpenCoworkerRoomProvider } from "./use-open-coworker-room";

interface ChatLandingMobileProps {
  coworkers: Coworker[];
  /** True only for an organization workspace, where other humans exist. */
  isOrganizationWorkspace: boolean;
  /** Null when Core could not be reached; chips still render as zeros. */
  summary: TaskActivitySummary | null;
  userName: null | string;
}

/**
 * Mobile composition of the `/chat` welcome (`chat-landing.mobile.tsx`).
 *
 * Pair of {@link ChatLanding} (`chat-landing.tsx`): same three zones (mark,
 * pitch, stats) scaled for a narrow column. Middle column is top-aligned so
 * Start chat stays put across coworker selection. Stats stay pinned at the
 * bottom — always mounted with zero chips when idle.
 */
export async function ChatLandingMobile({
  coworkers,
  isOrganizationWorkspace,
  summary,
  userName,
}: ChatLandingMobileProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Chat.Landing"),
    getFormatter(),
  ]);
  const featured = resolveFeaturedCoworker(coworkers);
  const stats = buildActivityStats(summary, isOrganizationWorkspace, t);

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col items-stretch px-4 pt-4 pb-3 text-center">
      <SokosumiIcon
        animated={false}
        className="text-foreground shrink-0 self-center"
        height={32}
        width={32}
      />

      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-stretch justify-start overflow-y-auto py-4">
        <h1 className="text-foreground shrink-0 text-2xl font-light text-balance">
          {userName ? t("greetingWithName", { name: userName }) : t("greeting")}
        </h1>

        <p className="text-muted-foreground mx-auto mt-2 max-w-[42ch] shrink-0 text-sm leading-[1.6] text-balance">
          {t("intro")}
        </p>

        {featured ? (
          <OpenCoworkerRoomProvider>
            <LandingCoworkerPicker
              coworkers={coworkers}
              initialSelectedId={featured.id}
              size="compact"
              startChatClassName="w-full"
            />
          </OpenCoworkerRoomProvider>
        ) : null}
      </div>

      <div
        className="flex w-full shrink-0 flex-col items-center gap-2 pt-1"
        data-testid="landing-activity-stats"
      >
        <p className="text-muted-foreground/70 text-xs">
          {summary?.basis === "lastVisit"
            ? t("stats.sinceLastActivity", {
                when: format.relativeTime(summary.since),
              })
            : t("stats.recent")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {stats.map((stat) => (
            <span
              className="bg-card text-muted-foreground rounded-full border px-2.5 py-1 text-xs tabular-nums"
              key={stat}
            >
              {stat}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
