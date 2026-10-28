import { type MarketingStrategy, type Prisma } from "@sokosumi/database";
import {
  CMO_PRODUCTION_TURN_PREFIX,
  type CmoBrandBrain,
  type CmoCalendarEntry,
  type CmoPlanQuestion,
  type CmoStrategy,
  type CmoStrategySave,
  cmoStrategySchema,
} from "@sokosumi/soko-bot";
import { keepAnswers } from "@/helpers/question-answers";
import prisma from "@/lib/db/prisma";
import { type PresetRoute } from "@/lib/soko-bot/classifier";
import { parseBrandBrain } from "@/services/brand-brain.service";
import {
  CmoConflictError,
  type Cuso,
  requireCuso,
  startCmoTurn,
} from "@/services/cmo-cuso.service";
import {
  approvedMarketingStrategy,
  newestMarketingStrategy,
  parseMarketingPlan,
  planMarketingStrategyPosts,
  STRATEGY_TURN_PREFIX,
} from "@/services/marketing-strategy.service";

/**
 * No sandbox on the strategy turn: it plans from the Brand Brain it already
 * has. It writes no drafts or Social posts; after the owner approves, the
 * daily run drafts each piece three days before it goes out.
 */
const CMO_STRATEGY_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  reason: "CMO strategy: plan the next four weeks.",
};

/**
 * Cuso's rhythms and the month's production carry out the approved version;
 * every other turn (a chat, a requested rewrite) works on the newest one.
 */
export function cmoTurnExecutesPlan(turn: {
  source: string;
  clientTurnId: string | null;
}): boolean {
  return (
    turn.source === "SCHEDULE" ||
    (turn.clientTurnId?.startsWith(CMO_PRODUCTION_TURN_PREFIX) ?? false)
  );
}

/**
 * The version a turn reads and builds on: while it executes, the approved
 * one (executing rhythms and production never run without one, so only the
 * approval reminder falls back to the waiting draft); otherwise the newest.
 */
export async function cmoWorkingStrategy(
  projectId: string,
  executing: boolean,
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategy | null> {
  return (
    (executing ? await approvedMarketingStrategy(projectId, db) : null) ??
    (await newestMarketingStrategy(projectId, db))
  );
}

function tomorrow(now: Date = new Date()): string {
  return new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
}

/**
 * The owner's monthly ad budget: stored on the plan as theirs, then Cuso
 * plans the ads (and what they should bring) around exactly that amount.
 * Zero turns paid ads off.
 */
export async function setCmoAdBudget(input: {
  userId: string;
  monthly: number;
  currency: string;
}): Promise<{ turnId: string }> {
  const cuso = await requireCuso({ userId: input.userId });
  const strategy = parseMarketingPlan(
    (await newestMarketingStrategy(cuso.projectId))?.plan,
  );
  if (!strategy) {
    throw new CmoConflictError("Cuso has not written the strategy yet");
  }
  const currency = input.currency.toUpperCase();
  const started = await requestCmoStrategy({
    userId: input.userId,
    note:
      input.monthly > 0
        ? `My ad budget is ${currency} ${input.monthly} a month. Plan the ads around exactly that amount and say what it should bring.`
        : "I don't want to spend on ads this month. Leave paid ads out and make the plan work without them.",
  });
  // The owner's budget is the version Cuso's re-plan completes: his turn's
  // saves update it, so a budget writes one version.
  // shortcut: a turn that saves before this create adds a second version;
  // its first save takes a model call, so upgrade only if that ever shows.
  await prisma.marketingStrategy.create({
    data: {
      projectId: cuso.projectId,
      authorUserId: input.userId,
      turnId: started.turnId,
      plan: {
        ...strategy,
        ads: {
          expect: "Cuso is updating what this brings.",
          without: "The plan runs on posts, search and email alone.",
          ...strategy.ads,
          monthly: input.monthly,
          currency,
          setByOwner: true,
        },
      },
    },
  });
  return started;
}

/**
 * Asks Cuso for a new one-month strategy: he writes a new version, which an
 * owner or admin approves; the approved one keeps running until then.
 */
export async function requestCmoStrategy(input: {
  userId: string;
  note?: string;
}): Promise<{ turnId: string }> {
  const cuso = await requireCuso({ userId: input.userId });
  const brain = parseBrandBrain(cuso.brandBrain);
  if (!brain) {
    throw new CmoConflictError("Cuso is still building the Brand Brain");
  }
  // Named up front: a goal such as "More leads" once pulled whole plans onto
  // a side product or feature with the same word in it.
  const main = brain.offers?.[0];
  const sells = `${brain.reveal?.positioning ?? brain.summary}${main ? ` Main offer: ${main.name} (${main.price}).` : ""}`;
  return startCmoTurn(cuso, input.userId, {
    clientTurnId: `${STRATEGY_TURN_PREFIX}${cuso.sokoBotId}:${Date.now()}`,
    message: (input.note
      ? [
          `Change ${cuso.businessName}'s marketing strategy. The owner asked: ${input.note}`,
          "",
          "Start from the strategy in your packet and change only what the request needs. Every entry you do not change stays exactly as it is: same id, date, time and title. To move a piece, change the date on the same id; never add a copy. List each difference in changes, in plain words.",
          "Save with save_strategy: part plan for changes to the strategy (send the whole plan with your changes), part calendar for changes to the calendar (send the whole calendar). Each part leaves the other as saved.",
        ]
      : [
          `Write ${cuso.businessName}'s marketing strategy for the next four weeks, starting ${tomorrow()}.`,
          `What ${cuso.businessName} sells, from the Brand Brain: ${sells} The plan sells this main offer to its main buyers. A single product or feature may carry one campaign, never the whole plan.`,
          "Set the one result the business most needs from selling the main offer, from the Brand Brain, and lead the plan's goals with it.",
          ...ownerAnswers(brain),
          "Before you save, read your summary, focus, offer and pillars against the main offer above: if they drift to a narrower product or feature the owner did not name, or away from the one the owner did name, rewrite them.",
          "",
          "Follow your strategy skill exactly. Use the Brand Brain and the channels in your packet.",
          "This is the plan, not the posts. Save it in two short calls of save_strategy: first part plan (idea, alternatives, ladder, summary, why, goals, objective, barrier, mix, pillars, focus, offer, channels, pace, ads, funnel with plays and measure, beforeAfter, improvements, proposals, campaigns, weeks, measurement, questions); then part calendar, the day-by-day calendar (date, time, channel, format, approach, pillar, title, brief, why and campaignId) whose approach shares match the mix. Each part leaves the other as saved. Write no drafts, hooks or previews: after the owner approves and pays, you make the whole month at once.",
        ]
    )
      .concat([
        "Do not create Social posts or images yet; that starts after the owner approves.",
        "Then tell the owner in one or two sentences what the plan does first. The strategy card is your report: do not call report_update, and never mention tools, Social posts or what you did not do.",
      ])
      .join("\n"),
    route: CMO_STRATEGY_ROUTE,
  });
}

/** The owner's answers, for the strategy request; none when nothing was answered. */
function ownerAnswers(brain: CmoBrandBrain): string[] {
  const answered = brain.questions.filter(
    (question) => question.answer && question.answer !== "unsure",
  );
  if (answered.length === 0) return [];
  return [
    "The owner answered your Brand Brain questions. A yes confirms the statement; a no overrides your reading, and its note says what is true instead:",
    ...answered.map(
      (question) =>
        `- ${question.question} ${question.answer}${question.note ? `: ${question.note}` : ""}`,
    ),
  ];
}

/** Matches the calendar slice in the turn packet. A full plan with drafts does not fit. */
export const CMO_VISIBLE_CALENDAR_DAYS = 31;
const CMO_CALENDAR_LIMIT = 120;

export function calendarBounds(
  now: Date,
  days: number,
): { from: string; to: string } {
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

/**
 * A bot turn only sees the next 31 days. Put back entries outside that window
 * so save_strategy cannot delete them. An incoming entry with the same id, or
 * the same day and channel, still wins. Owner saves pass no turn id and replace
 * the calendar outright.
 */
function withHiddenCalendar(
  previous: CmoStrategy["calendar"],
  incoming: CmoStrategy["calendar"],
  now: Date,
): CmoStrategy["calendar"] {
  const { from, to } = calendarBounds(now, CMO_VISIBLE_CALENDAR_DAYS);
  const seen = new Set(incoming.map((entry) => entry.id));
  const covered = new Set(
    incoming.map((entry) => `${entry.date}\0${entry.channel}`),
  );
  const hidden = previous.filter(
    (entry) =>
      !seen.has(entry.id) &&
      (entry.date < from || entry.date > to) &&
      !covered.has(`${entry.date}\0${entry.channel}`),
  );
  const room = CMO_CALENDAR_LIMIT - incoming.length;
  if (room <= 0 || hidden.length === 0) return incoming;
  const kept = hidden
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-room);
  return [...incoming, ...kept].sort((left, right) =>
    left.date === right.date
      ? left.id.localeCompare(right.id)
      : left.date.localeCompare(right.date),
  );
}

function sameTitle(left: string, right: string): boolean {
  const squash = (text: string) => text.toLowerCase().replace(/\W+/g, "");
  return squash(left) === squash(right);
}

/**
 * Guards a bot's save against the two ways a revision loses work: an entry
 * kept under the same id and title without its draft gets the draft back,
 * and an entry left in its old slot while a copy moved to a new day is
 * dropped, so a moved piece shows once.
 */
export function keepCalendarWork(
  previous: CmoStrategy["calendar"],
  incoming: CmoStrategy["calendar"],
): CmoStrategy["calendar"] {
  const before = new Map(previous.map((entry) => [entry.id, entry]));
  // Entries past the first week reach Cuso without their words (the
  // packet's detailsStored); sent back under the same title, they keep them.
  const withDrafts = incoming.map((entry) => {
    const old = before.get(entry.id);
    if (!old || !sameTitle(old.title, entry.title)) return entry;
    return {
      ...entry,
      draft: entry.draft ?? old.draft,
      brief: entry.brief ?? old.brief,
      why: entry.why ?? old.why,
      hook: entry.hook ?? old.hook,
    };
  });
  return withDrafts.filter((entry) => {
    const old = before.get(entry.id);
    const untouched = old?.date === entry.date;
    if (!untouched) return true;
    const moved = withDrafts.some(
      (other) =>
        other !== entry &&
        other.channel === entry.channel &&
        other.date !== entry.date &&
        sameTitle(other.title, entry.title) &&
        // A series ("Tip of the week") repeats the title, not the words.
        ((!!other.hook && other.hook === entry.hook) ||
          (!!other.draft && other.draft === entry.draft)) &&
        before.get(other.id)?.date !== other.date,
    );
    return !moved;
  });
}

const DASH = /\s*[—–]\s*/g;

/**
 * Cuso's copy goes out under the brand's name; em and en dashes read as AI
 * writing. Number ranges ("3–5") keep a plain hyphen.
 */
export function withoutDashes<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
      .replace(DASH, ", ") as T;
  }
  if (Array.isArray(value)) return value.map(withoutDashes) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withoutDashes(item)]),
    ) as T;
  }
  return value;
}

/**
 * Saves the strategy as a version of the Project's Marketing strategy. A
 * turn's first save adds a version and its later saves complete it (a plan
 * goes in two calls) until it is approved; no save changes another version.
 * Pieces fill in the approved version's Social posts and nothing else:
 * entries on other channels (ads, articles, newsletters) are not produced.
 */
export async function saveCmoStrategy(
  where: { userId: string } | { sokoBotId: string },
  strategy: CmoStrategySave,
  options: {
    turnId?: string;
    now?: Date;
    /** The calendar sent is only the pieces Cuso changed: merge them by id. */
    pieces?: boolean;
    /** A rhythm or production turn: it builds on the approved version. */
    executing?: boolean;
  } = {},
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategy> {
  const cuso = await requireCuso(where, db);
  if (options.pieces) {
    // Pieces write the approved version's Social posts and never a plan.
    const approved = await approvedMarketingStrategy(cuso.projectId, db);
    if (!approved) {
      throw new CmoConflictError(
        "Pieces fill in the approved strategy; no version is approved yet",
      );
    }
    await planMarketingStrategyPosts(db, {
      version: approved,
      workspaceId: cuso.workspaceId,
      entries: (strategy.calendar ?? []) as CmoCalendarEntry[],
      creator:
        "sokoBotId" in where
          ? { sokoBotId: cuso.sokoBotId }
          : { userId: where.userId },
    });
    return approved;
  }
  const own = options.turnId
    ? await db.marketingStrategy.findFirst({
        where: {
          projectId: cuso.projectId,
          turnId: options.turnId,
          approvedAt: null,
        },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const base =
    own ??
    (await cmoWorkingStrategy(cuso.projectId, options.executing ?? false, db));
  // What a save leaves out stays as stored; the merged plan must be whole.
  const before = parseMarketingPlan(base?.plan);
  const whole = cmoStrategySchema.parse({
    ...before,
    ...Object.fromEntries(
      Object.entries(strategy).filter(([, value]) => value !== undefined),
    ),
    calendar: strategy.calendar ?? before?.calendar ?? [],
  });
  // A channel the plan now runs is no longer a proposal.
  const running = new Set(whole.channels.map((channel) => channel.channel));
  // The ad budget the owner set is theirs: Cuso's saves plan around it.
  const ownerAds =
    options.turnId && before?.ads?.setByOwner ? before.ads : undefined;
  const parsed = {
    ...whole,
    questions: keepAnswers(whole.questions, before?.questions ?? []),
    proposals: whole.proposals.filter(
      (proposal) => !running.has(proposal.channel),
    ),
    ...(ownerAds
      ? {
          ads: {
            ...(whole.ads ?? ownerAds),
            monthly: ownerAds.monthly,
            currency: ownerAds.currency,
            setByOwner: true,
          },
        }
      : {}),
  };
  const previous = options.turnId ? before : null;
  const merged = previous
    ? {
        ...parsed,
        calendar: withHiddenCalendar(
          previous.calendar,
          keepCalendarWork(previous.calendar, parsed.calendar),
          options.now ?? new Date(),
        ),
        // An empty previews list keeps the stored samples.
        previews:
          parsed.previews.length > 0 ? parsed.previews : previous.previews,
      }
    : parsed;
  const stored = options.turnId
    ? withoutDashes(withLineBreaks(merged))
    : merged;
  if (own) {
    return db.marketingStrategy.update({
      where: { id: own.id },
      data: { plan: stored },
    });
  }
  return db.marketingStrategy.create({
    data: {
      projectId: cuso.projectId,
      plan: stored,
      turnId: options.turnId ?? null,
      ...("sokoBotId" in where
        ? { authorSokoBotId: cuso.sokoBotId }
        : { authorUserId: where.userId }),
    },
  });
}

/**
 * A model sometimes writes line breaks as the two characters "\\n" inside a
 * draft; they would show up literally in a post.
 */
export function withLineBreaks<T extends { calendar: CmoStrategy["calendar"] }>(
  strategy: T,
): T {
  return {
    ...strategy,
    calendar: strategy.calendar.map((entry) =>
      entry.draft?.includes("\\n")
        ? { ...entry, draft: entry.draft.replace(/\\n/g, "\n") }
        : entry,
    ),
  };
}

/** The newest version CMO shows, or "Cuso has not written it yet". */
async function newestCmoStrategy(
  cuso: Pick<Cuso, "projectId">,
): Promise<MarketingStrategy> {
  const newest = await newestMarketingStrategy(cuso.projectId);
  if (!newest) throw new CmoConflictError("There is no strategy yet");
  return newest;
}

/**
 * What the owner's answers change: each no, with what is true instead. A
 * yes confirms the plan as written and "not sure" leaves Cuso's guess.
 */
export function cmoPlanAnswerNote(questions: CmoPlanQuestion[]): string | null {
  const changes = questions
    .filter((question) => question.answer === "no")
    .map(
      (question) =>
        `- "${question.question}" No.${question.note ? ` What is true: ${question.note}` : ""} (You had assumed: ${question.statement})`,
    );
  return changes.length > 0
    ? [
        "The owner answered your questions about the plan. Change the plan where an answer says your assumption was wrong; keep everything else.",
        ...changes,
      ].join("\n")
    : null;
}

/** Cuso revises the plan to fit the owner's answers. */
export async function applyCmoPlanAnswers(
  userId: string,
): Promise<{ turnId: string }> {
  const cuso = await requireCuso({ userId });
  const newest = await newestCmoStrategy(cuso);
  const note = cmoPlanAnswerNote(
    parseMarketingPlan(newest.plan)?.questions ?? [],
  );
  if (!note) throw new CmoConflictError("Your answers confirm the plan");
  return requestCmoStrategy({ userId, note });
}

/**
 * The owner pauses one calendar entry from Up next: its Social post (the
 * entry's id) is canceled so it cannot go out; one already going out is
 * refused (409). Only Social posts are produced, so any other entry is
 * refused too and the approved plan stays as it is.
 */
export async function pauseCmoCalendarEntry(input: {
  userId: string;
  entryId: string;
}): Promise<void> {
  const cuso = await requireCuso({ userId: input.userId });
  const post = UUID.test(input.entryId)
    ? await prisma.socialPost.findFirst({
        where: { id: input.entryId, projectId: cuso.projectId },
        select: { status: true, revision: true },
      })
    : null;
  if (!post) {
    throw new CmoConflictError("Only a planned Social post can be paused");
  }
  if (post.status === "CANCELED") return;
  const { cancelSocialPost } = await import("@/services/social-posts.service");
  await cancelSocialPost({
    projectId: cuso.projectId,
    workspaceId: cuso.workspaceId,
    userId: input.userId,
    postId: input.entryId,
    revision: post.revision,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
