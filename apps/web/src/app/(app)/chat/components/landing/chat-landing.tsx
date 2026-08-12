import { getFormatter, getTranslations } from "next-intl/server";

import type { Coworker } from "@/app/chat/utils/types";
import { SokosumiIcon } from "@/components/masumi-logos";
import type { TaskActivitySummary } from "@/lib/clients/generated/core";

import { CoworkerStrip } from "./coworker-strip.client";
import {
  buildActivityStats,
  featuredCoworkerRole,
  hasReportableActivity,
  resolveFeaturedCoworker,
  selectStripCoworkers,
  toStripCoworker,
} from "./landing-content";
import { StartChatButton } from "./start-chat-button.client";
import { OpenCoworkerRoomProvider } from "./use-open-coworker-room";

/**
 * Enough to read as a team without the row wrapping on a laptop. Kept even so
 * the flanks balance and the featured coworker stays optically centred.
 */
const MAX_STRIP_COWORKERS = 6;

interface ChatLandingProps {
  coworkers: Coworker[];
  /** True only for an organization workspace, where other humans exist. */
  isOrganizationWorkspace: boolean;
  /** Null when Core could not be reached; the greeting renders without stats. */
  summary: TaskActivitySummary | null;
  userName: null | string;
}

/**
 * Desktop composition of the `/chat` welcome (`chat-landing.tsx`).
 *
 * Pair of {@link ChatLandingMobile} (`chat-landing.mobile.tsx`): same content
 * decisions from `landing-content`, larger strip and type. Owns `/chat` at
 * `md` and up.
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
  const others = selectStripCoworkers(coworkers, featured, MAX_STRIP_COWORKERS);
  const featuredRole = featured
    ? featuredCoworkerRole(featured, t("role"))
    : null;
  const stats = buildActivityStats(summary, isOrganizationWorkspace, t);
  const hasAnyActivity = hasReportableActivity(summary);

  return (
    // Three zones: the mark keeps the page's top edge aligned with every other
    // route, the pitch centres in whatever height is left, and the stats close
    // out the bottom.
    <div className="flex min-h-full w-full flex-col items-center">
      <SokosumiIcon
        animated={false}
        className="text-foreground shrink-0"
        height={48}
        width={48}
      />

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center py-10 text-center">
        {/* Same treatment as the agents page heading. */}
        <h1 className="text-foreground text-2xl font-light text-balance md:text-4xl">
          {userName ? t("greetingWithName", { name: userName }) : t("greeting")}
        </h1>

        <p className="text-muted-foreground mx-auto mt-5 max-w-[62ch] text-base leading-[1.65] text-balance md:text-lg">
          {t("intro")}
        </p>

        {featured ? (
          <OpenCoworkerRoomProvider>
            <div className="mt-12 w-full">
              <CoworkerStrip
                featured={toStripCoworker(featured)}
                others={others}
              />
            </div>

            <p className="mt-5 text-xl font-semibold tracking-[-0.01em]">
              {featured.name}
            </p>
            {featuredRole ? (
              <p className="text-muted-foreground mx-auto mt-2 max-w-[46ch] text-[0.9375rem] leading-[1.55] text-balance">
                {featuredRole}
              </p>
            ) : null}

            <div className="mt-6">
              <StartChatButton
                coworkerId={featured.id}
                coworkerName={featured.name}
              />
            </div>
          </OpenCoworkerRoomProvider>
        ) : null}
      </div>

      {summary && hasAnyActivity && stats.length > 0 ? (
        <div className="flex w-full shrink-0 flex-col items-center gap-4">
          <p className="text-muted-foreground/70 text-[0.8125rem]">
            {summary.basis === "lastVisit"
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
      ) : null}
    </div>
  );
}
