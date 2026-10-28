import {
  type CmoStrategy,
  type CmoSystemSchedule,
  cmoRoutineSkipReason,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { readDesignMdContent } from "@/lib/design-md-blob";
import {
  compactBrandBrain,
  parseCmoBrandBrain,
} from "@/services/brand-brain.service";
import { isCmoSubscribed } from "@/services/cmo-billing.service";
import { listCmoBrandPictures } from "@/services/cmo-brand-media.service";
import { getCmoHireForBot, listCmoChannels } from "@/services/cmo-cuso.service";
import { listCmoReports } from "@/services/cmo-reports.service";
import {
  CMO_VISIBLE_CALENDAR_DAYS,
  calendarBounds,
  cmoWorkingStrategy,
} from "@/services/cmo-strategy.service";
import {
  approvedMarketingStrategy,
  newestMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";

function calendarWindow(
  strategy: CmoStrategy,
  now: Date,
  days: number,
): CmoStrategy["calendar"] {
  const { from, to } = calendarBounds(now, days);
  return strategy.calendar.filter(
    (entry) => entry.date >= from && entry.date <= to,
  );
}

/**
 * What Cuso sees about the business on every turn: the Brand Brain, the
 * strategy, and the next 31 days of the calendar. Entries outside that
 * window stay in the saved plan. Rhythms and production (`executing`) see
 * only the approved version; other turns see the newest. Null for any bot
 * that is not a CMO bot.
 */
export async function loadCmoMarketingContext(
  sokoBotId: string,
  now: Date = new Date(),
  options: { executing?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const hire = await getCmoHireForBot(sokoBotId);
  if (!hire) return null;
  const version = await cmoWorkingStrategy(
    hire.projectId,
    options.executing ?? false,
  );
  const strategy = parseMarketingPlan(version?.plan);
  const [project, brandPictures] = await Promise.all([
    prisma.project.findUnique({
      where: { id: hire.projectId },
      select: { logo: true, designMdUrl: true },
    }),
    listCmoBrandPictures(hire.projectId),
  ]);
  const designMd = await readDesignMdContent(project?.designMdUrl ?? null);
  const context: MarketingContext = {
    business: {
      name: hire.businessName,
      websiteUrl: hire.websiteUrl,
      marketingProjectId: hire.projectId,
    },
    /** Whether the strategy shown is the approved version Cuso carries out. */
    strategyApproved: version?.approvedAt != null,
    subscriptionActive: await isCmoSubscribed(hire),
    connectedChannels: (await listCmoChannels(hire.projectId)).map(
      (channel) => ({
        provider: channel.provider,
        handle: channel.externalHandle,
        status: channel.status,
        socialConnectionId: channel.id,
      }),
    ),
    brandBrain: compactBrandBrain(parseCmoBrandBrain(hire.brandBrain)),
    /**
     * The Project's logo and DESIGN.md (colours, fonts, type): use them in
     * images and layouts.
     */
    brandLook: {
      logoUrl: project?.logo ?? null,
      designMd: designMd?.slice(0, CMO_DESIGN_MD_CHARS) ?? null,
    },
    /** The brand's own photos, the Project's files: generate_image references. */
    brandPictures: brandPictures.map((picture) => ({
      ...picture,
      alt: picture.alt.slice(0, 80),
    })),
    strategy: strategy
      ? {
          ...strategy,
          // Next 31 days. saveCmoStrategy puts entries outside this window back.
          // Drafts past the first week stay stored: keepCalendarWork restores
          // them when an entry comes back under its id and title without one.
          calendar: calendarWindow(
            strategy,
            now,
            CMO_VISIBLE_CALENDAR_DAYS,
          ).map((entry) =>
            entry.date > draftHorizon(now)
              ? {
                  ...entry,
                  draft: undefined,
                  brief: undefined,
                  why: undefined,
                  hook: undefined,
                  detailsStored: true,
                }
              : entry,
          ),
          calendarTotal: strategy.calendar.length,
        }
      : null,
    recentUpdates: (await listCmoReports(sokoBotId, 3)).map(
      ({ previousVersionId: _previous, ...update }) => update,
    ),
  };
  return fitCmoMarketingContext(context, now);
}

/** Enough DESIGN.md for colours, fonts and type, as Image Studio reads it. */
const CMO_DESIGN_MD_CHARS = 1_600;

/**
 * Bytes Cuso's marketing context may take of the 48 KB packet; the rest is
 * memory, the conversation and the trigger. A big Brand Brain with a made
 * month once pushed the packet past its hard limit and every turn failed.
 */
export const CMO_CONTEXT_BUDGET_BYTES = 32 * 1_024;

type MarketingContext = Record<string, unknown> & {
  brandBrain?: Record<string, unknown> | null;
  strategy?: (Record<string, unknown> & { calendar?: unknown[] }) | null;
};

/**
 * Sheds detail, least needed first, until the context fits its budget.
 * Everything shed stays stored: saves merge into what is there, and a piece
 * sent back under its id and title keeps its words.
 */
export function fitCmoMarketingContext(
  context: MarketingContext,
  now: Date,
  budget: number = CMO_CONTEXT_BUDGET_BYTES,
): MarketingContext {
  const soon = new Date(now.getTime() + 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const later = (entry: Record<string, unknown>) =>
    typeof entry.date === "string" && entry.date > soon;
  const calendar = (
    current: MarketingContext,
    shed: (entry: Record<string, unknown>) => Record<string, unknown>,
  ): MarketingContext =>
    current.strategy
      ? {
          ...current,
          strategy: {
            ...current.strategy,
            calendar: (current.strategy.calendar ?? []).map((entry) =>
              later(entry as Record<string, unknown>)
                ? shed(entry as Record<string, unknown>)
                : entry,
            ),
          },
        }
      : current;
  const without = (
    current: MarketingContext,
    part: "brandBrain" | "strategy",
    keys: string[],
  ): MarketingContext => {
    const value = current[part];
    if (!value) return current;
    const kept = Object.fromEntries(
      Object.entries(value).filter(([key]) => !keys.includes(key)),
    );
    const stored = [
      ...((value.storedNotShown as string[] | undefined) ?? []),
      ...keys,
    ];
    return { ...current, [part]: { ...kept, storedNotShown: stored } };
  };
  const steps: ((current: MarketingContext) => MarketingContext)[] = [
    (current) =>
      calendar(current, ({ draft: _draft, ...entry }) => ({
        ...entry,
        detailsStored: true,
      })),
    (current) => without(current, "strategy", ["previews", "weeks"]),
    (current) =>
      calendar(current, ({ brief: _b, why: _w, hook: _h, ...entry }) => ({
        ...entry,
        detailsStored: true,
      })),
    (current) =>
      current.brandBrain
        ? {
            ...current,
            brandBrain: {
              ...current.brandBrain,
              profile: Object.fromEntries(
                Object.entries(
                  (current.brandBrain.profile ?? {}) as Record<
                    string,
                    Record<string, unknown>
                  >,
                ).map(([key, section]) => [
                  key,
                  { headline: section.headline, answer: section.answer },
                ]),
              ),
            },
          }
        : current,
    (current) =>
      without(current, "strategy", [
        "alternatives",
        "beforeAfter",
        "measurement",
        "proposals",
        "changes",
      ]),
    (current) =>
      without(current, "brandBrain", ["reveal", "alternatives", "channels"]),
    (current) =>
      calendar(current, ({ pillar: _p, campaignId: _c, ...entry }) => entry),
  ];
  let fitted = context;
  for (const step of steps) {
    if (Buffer.byteLength(JSON.stringify(fitted)) <= budget) break;
    fitted = step(fitted);
  }
  return fitted;
}

/** The last day a turn sees full drafts for. */
function draftHorizon(now: Date): string {
  return new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
}

/** The packet appended to a CMO rhythm's prompt. */
export async function buildCmoBeatPacket(
  sokoBotId: string,
  now: Date,
  key: CmoSystemSchedule["key"],
): Promise<{ packet: string; skip: boolean }> {
  const hire = await getCmoHireForBot(sokoBotId);
  if (!hire) return { packet: "", skip: true };
  // Nothing runs without a reason: no approved strategy, no Brand Brain,
  // or not the reminder's one slot. A skipped run costs no turn.
  const [approved, newest] = await Promise.all([
    approvedMarketingStrategy(hire.projectId),
    newestMarketingStrategy(hire.projectId),
  ]);
  const skipReason = cmoRoutineSkipReason(key, {
    brandBrain: parseCmoBrandBrain(hire.brandBrain) !== null,
    strategySavedAt: newest?.updatedAt ?? null,
    strategyApproved: approved !== null,
    now,
  });
  if (skipReason) return { packet: "", skip: true };
  // A rhythm carries out the approved version, never a draft.
  const context = await loadCmoMarketingContext(sokoBotId, now, {
    executing: true,
  });
  if (!context) return { packet: "", skip: true };
  const posts = hire
    ? await prisma.socialPost.findMany({
        where: {
          projectId: hire.projectId,
          updatedAt: { gte: new Date(now.getTime() - 14 * 86_400_000) },
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          provider: true,
          status: true,
          scheduledAt: true,
          publishedAt: true,
          publishedUrl: true,
          text: true,
        },
      })
    : [];
  const lines = [
    `## Execution: ${
      !context.strategyApproved
        ? "waiting for the owner to approve the strategy (draft only)"
        : context.subscriptionActive
          ? "active"
          : "paused: no CMO subscription (draft only)"
    }`,
    `## Connected channels: ${JSON.stringify(context.connectedChannels)}`,
    "",
    // Every turn's context already carries both in full; repeating them here
    // pushed a full four-week plan past the 20,000-character message limit.
    "## Brand Brain and strategy: workspace.marketing in your context. Its calendar is the next 31 days; entries outside that window stay when you save_strategy.",
    "",
    "## Social posts, last 14 days",
    ...(posts.length
      ? posts.map(
          (post) =>
            `- ${post.status} · ${post.provider} · ${post.scheduledAt?.toISOString() ?? post.publishedAt?.toISOString() ?? "unscheduled"} · "${post.text.replace(/\s+/g, " ").slice(0, 80)}" (id ${post.id})${post.publishedUrl ? ` ${post.publishedUrl}` : ""}`,
        )
      : ["- none"]),
  ];
  return { packet: lines.join("\n"), skip: false };
}
