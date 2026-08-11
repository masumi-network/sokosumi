import { getFormatter, getTranslations } from "next-intl/server";

import {
  findDefaultCoworker,
  getCoworkerImageUrl,
} from "@/app/chat/utils/coworker-utils";
import type { Coworker } from "@/app/chat/utils/types";
import { SokosumiIcon } from "@/components/masumi-logos";
import { canUseNextImageSrc } from "@/config/next-image";
import type { TaskActivitySummary } from "@/lib/services/task.service";

import { CoworkerStrip, type StripCoworker } from "./coworker-strip.client";
import { StartChatButton } from "./start-chat-button.client";

/**
 * Elena fronts the product: she is the coworker who takes a goal and turns it
 * into work, which is the idea this screen exists to land.
 */
const FEATURED_COWORKER_SLUG = "elena";

/**
 * Enough to read as a team without the row wrapping on a laptop. Kept even so
 * the flanks balance and the featured coworker stays optically centred.
 */
const MAX_STRIP_COWORKERS = 6;

interface ChatLandingProps {
  coworkers: Coworker[];
  /** True only for an organization workspace, where other humans exist. */
  isOrganizationWorkspace: boolean;
  /** Null on a first-ever visit, which switches the stats caption. */
  lastSeenAt: Date | null;
  summary: TaskActivitySummary;
  userName: null | string;
}

function resolveFeaturedCoworker(coworkers: Coworker[]): Coworker | null {
  const featured = coworkers.find(
    (coworker) => coworker.slug?.toLowerCase() === FEATURED_COWORKER_SLUG,
  );

  // Elena is not guaranteed: `scope=available` is whitelist ∪ granted access,
  // and chat additionally needs a runnable endpoint. Lead with whoever is there.
  return featured ?? findDefaultCoworker(coworkers);
}

function toStripCoworker(coworker: Coworker): StripCoworker {
  // Keyed by SLUG on purpose: the static fallback map is slug-keyed, so
  // passing the id (as most call sites do) silently yields null.
  const imageUrl = getCoworkerImageUrl(coworker.slug ?? "", coworker.avatar);

  return {
    id: coworker.id,
    // Vendors host avatars wherever they like; an unconfigured hostname makes
    // next/image throw and takes the whole page down, so fall back to initials.
    imageUrl: imageUrl && canUseNextImageSrc(imageUrl) ? imageUrl : null,
    name: coworker.name,
    title: coworker.caption ?? null,
  };
}

export async function ChatLanding({
  coworkers,
  isOrganizationWorkspace,
  lastSeenAt,
  summary,
  userName,
}: ChatLandingProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Chat.Landing"),
    getFormatter(),
  ]);
  const featured = resolveFeaturedCoworker(coworkers);

  const otherCoworkers = featured
    ? coworkers.filter((coworker) => coworker.id !== featured.id)
    : [];
  // Drop the odd one out rather than seat it on one side, which would shove the
  // featured face off centre.
  const stripCount = Math.min(
    MAX_STRIP_COWORKERS,
    otherCoworkers.length - (otherCoworkers.length % 2),
  );
  const others = otherCoworkers.slice(0, stripCount).map(toStripCoworker);

  const stats = [
    ...(summary.completed > 0
      ? [t("stats.completed", { count: summary.completed })]
      : []),
    ...(summary.workedMinutes > 0
      ? [t("stats.worked", { minutes: summary.workedMinutes })]
      : []),
    ...(summary.awaitingInput > 0
      ? [t("stats.awaiting", { count: summary.awaitingInput })]
      : []),
    // Always in an organization, even at zero: "what my teammates added" is a
    // question the row should answer rather than silently omit.
    ...(isOrganizationWorkspace
      ? [t("stats.byTeammates", { count: summary.createdByOtherHumans })]
      : []),
  ];

  // A brand-new account has nothing to report, and a lone "0 tasks from your
  // team" chip is worse than no row at all.
  const hasAnyActivity =
    summary.completed > 0 ||
    summary.workedMinutes > 0 ||
    summary.awaitingInput > 0 ||
    summary.createdByOtherHumans > 0;

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
          <>
            <div className="mt-12 w-full">
              <CoworkerStrip
                featured={toStripCoworker(featured)}
                others={others}
              />
            </div>

            <p className="mt-5 text-xl font-semibold tracking-[-0.01em]">
              {featured.name}
            </p>
            <p className="text-muted-foreground mx-auto mt-2 max-w-[46ch] text-[0.9375rem] leading-[1.55] text-balance">
              {t("role")}
            </p>

            <div className="mt-6">
              <StartChatButton
                coworkerId={featured.id}
                coworkerName={featured.name}
              />
            </div>
          </>
        ) : null}
      </div>

      {hasAnyActivity && stats.length > 0 ? (
        <div className="flex w-full shrink-0 flex-col items-center gap-4">
          <p className="text-muted-foreground/70 text-[0.8125rem]">
            {summary.basis === "lastVisit" && lastSeenAt
              ? t("stats.sinceLastVisit", {
                  when: format.relativeTime(lastSeenAt),
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
