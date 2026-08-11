import { getFormatter, getTranslations } from "next-intl/server";

import type { Coworker } from "@/app/chat/utils/types";
import { SokosumiIcon } from "@/components/masumi-logos";
import type { TaskActivitySummary } from "@/lib/clients/generated/core";

import { CoworkerStrip } from "./coworker-strip.client";
import {
  buildActivityStats,
  hasReportableActivity,
  resolveFeaturedCoworker,
  selectStripCoworkers,
  toStripCoworker,
} from "./landing-content";
import { StartChatButton } from "./start-chat-button.client";

/**
 * Four teammates plus the 80px featured face fit a 390px viewport with room to
 * breathe. Even, so the flanks balance and Elena stays centred.
 */
const MAX_STRIP_COWORKERS = 4;

interface ChatMobileWelcomeProps {
  coworkers: Coworker[];
  /** True only for an organization workspace, where other humans exist. */
  isOrganizationWorkspace: boolean;
  /** Null when Core could not be reached; the greeting renders without stats. */
  summary: TaskActivitySummary | null;
  userName: null | string;
}

/**
 * The welcome, sized for a 390px column.
 *
 * Owns `/chat` below `md`, the same page the desktop landing owns above it —
 * the room list stays its own surface at `/chat/chats`. Same three zones as
 * desktop (mark, centred pitch, stats), scaled down: 32px mark, an 80px
 * featured face flanked by four at 44px, and a full-width CTA.
 */
export async function ChatMobileWelcome({
  coworkers,
  isOrganizationWorkspace,
  summary,
  userName,
}: ChatMobileWelcomeProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Chat.Landing"),
    getFormatter(),
  ]);
  const featured = resolveFeaturedCoworker(coworkers);
  const others = selectStripCoworkers(coworkers, featured, MAX_STRIP_COWORKERS);
  const stats = buildActivityStats(summary, isOrganizationWorkspace, t);
  const hasAnyActivity = hasReportableActivity(summary);

  return (
    // Same three zones as the desktop landing: the mark holds the top edge, the
    // pitch centres in what is left, and the stats close out the bottom.
    <section className="flex min-h-full w-full flex-col items-center px-4 pt-4 pb-5 text-center">
      <SokosumiIcon
        animated={false}
        className="text-foreground shrink-0"
        height={32}
        width={32}
      />

      <div className="flex w-full flex-1 flex-col items-center justify-center py-6">
        <h1 className="text-foreground text-2xl font-light text-balance">
          {userName ? t("greetingWithName", { name: userName }) : t("greeting")}
        </h1>

        <p className="text-muted-foreground mt-3 max-w-[42ch] text-sm leading-[1.6] text-balance">
          {t("intro")}
        </p>

        {featured ? (
          <>
            <div className="mt-8 w-full">
              <CoworkerStrip
                featured={toStripCoworker(featured)}
                others={others}
                size="compact"
              />
            </div>

            <p className="mt-4 text-lg font-semibold tracking-[-0.01em]">
              {featured.name}
            </p>
            <p className="text-muted-foreground mt-1.5 max-w-[40ch] text-[0.8125rem] leading-[1.5] text-balance">
              {t("role")}
            </p>

            <div className="mt-6 w-full max-w-xs">
              <StartChatButton
                className="w-full"
                coworkerId={featured.id}
                coworkerName={featured.name}
              />
            </div>
          </>
        ) : null}
      </div>

      {summary && hasAnyActivity && stats.length > 0 ? (
        <div className="flex w-full shrink-0 flex-col items-center gap-2.5">
          <p className="text-muted-foreground/70 text-xs">
            {summary.basis === "lastVisit" && summary.since
              ? t("stats.sinceLastVisit", {
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
      ) : null}
    </section>
  );
}
