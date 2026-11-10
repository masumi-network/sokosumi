import { type MarketingStrategy, type Prisma } from "@sokosumi/database";
import {
  type BrandBrain,
  CMO_PRODUCTION_TURN_PREFIX,
  type CmoBrandSectionKey,
  type CmoCalendarEntry,
  type CmoPlanQuestion,
  type CmoStrategySave,
  type CmoStrategySavePart,
  type MarketingStrategyPlan,
  marketingStrategyPlanSchema,
} from "@sokosumi/soko-bot";
import { unprocessableEntity } from "@/helpers/error";
import { keepAnswers } from "@/helpers/question-answers";
import prisma from "@/lib/db/prisma";
import { type PresetRoute } from "@/lib/soko-bot/classifier";
import {
  brandBrainCorrections,
  brandBrainOpenFixes,
  parseBrandBrain,
  requestBrandBrainFix,
} from "@/services/brand-brain.service";
import {
  CmoConflictError,
  CmoNotFoundError,
  type Cuso,
  type CusoTarget,
  cmoRunIsSlow,
  cmoRunnerUserId,
  findCusoForBot,
  requireCuso,
  startCmoTurn,
} from "@/services/cmo-cuso.service";
import { cmoPlanRuleProblems } from "@/services/cmo-plan-review.service";
import {
  approvedMarketingStrategy,
  cmoChangeKind,
  isMarketingFilePiece,
  newestMarketingStrategy,
  parseMarketingPlan,
  planMarketingStrategyPosts,
  STRATEGY_TURN_PREFIX,
  sameTitle,
} from "@/services/marketing-strategy.service";
import { readMarketingPieceText } from "@/services/marketing-strategy-files.service";
import {
  settledTurnStatus,
  TURN_ROW_SELECT,
} from "@/services/soko-bot-turn-progress.service";

/**
 * No sandbox on the strategy turn: it plans from the Brand Brain it already
 * has. It writes no drafts or Social posts; once the owner approves and pays,
 * production makes the whole month (cmo-production.service).
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

const DAY_MS = 86_400_000;

/** The four weeks a new plan covers: tomorrow through 27 days later. */
export function planWindow(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const day = (offset: number) =>
    new Date(now.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
  return { start: day(1), end: day(28) };
}

/**
 * The owner's monthly ad budget: stored on the plan as theirs, then Cuso
 * plans the ads (and what they should bring) around exactly that amount.
 * Zero turns paid ads off.
 */
export async function setCmoAdBudget(
  input: CusoTarget & {
    monthly: number;
    currency: string;
  },
): Promise<{ turnId: string }> {
  const cuso = await requireCuso(input);
  const strategy = parseMarketingPlan(
    (await newestMarketingStrategy(cuso.projectId))?.plan,
  );
  if (!strategy) {
    throw new CmoConflictError("Cuso has not written the strategy yet");
  }
  const currency = input.currency.toUpperCase();
  const started = await requestStrategyForCuso(cuso, {
    userId: input.userId,
    patch: true,
    note:
      input.monthly > 0
        ? `My ad budget is ${currency} ${input.monthly} a month. Plan the ads around exactly that amount and say what it should bring.`
        : "I don't want to spend on ads this month. Leave paid ads out and make the plan work without them.",
  });
  // The owner's budget is the version Cuso's patch completes: his turn's
  // saves update it, so a budget writes one version.
  // shortcut: a turn that saves before this create adds a second version;
  // its first save takes a model call, so upgrade only if that ever shows.
  await prisma.marketingStrategy.create({
    data: {
      projectId: cuso.projectId,
      authorUserId: input.userId,
      authorTurnId: started.turnId,
      plan: {
        ...strategy,
        // This version is the budget's patch: nothing struck through yet.
        changes: [],
        patched: [],
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

/** Cuso's newest strategy turn, whatever its state. */
function newestStrategyTurn(sokoBotId: string) {
  return prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId,
      clientTurnId: { startsWith: STRATEGY_TURN_PREFIX },
    },
    orderBy: { createdAt: "desc" },
    select: TURN_ROW_SELECT,
  });
}

/** The strategy turn still running, if any. */
async function strategyTurnRunning(sokoBotId: string, now: Date) {
  const turn = await newestStrategyTurn(sokoBotId);
  return turn && (await settledTurnStatus(turn, now)) === "running"
    ? turn
    : null;
}

/**
 * Asks Cuso for a new one-month strategy: he writes a new version, which an
 * owner or admin approves; the approved one keeps running until then. With
 * `patch`, the note changes only the entries it touches (a no, the pace, an
 * ad budget) in a short turn. While a plan is being written, asking again
 * returns that turn ("Looks like us" starts nothing), a change or patch is
 * refused (the screen holds it until the plan lands), and `restart`
 * replaces a run past twice the usual time.
 */
export async function requestCmoStrategy(
  input: CusoTarget & {
    note?: string;
    patch?: boolean;
    restart?: boolean;
  },
  now: Date = new Date(),
): Promise<{ turnId: string }> {
  return requestStrategyForCuso(await requireCuso(input), input, now);
}

/**
 * The guard every plan request goes through, the ad budget's and the plan
 * answers' too: a change waits until the plan being written lands.
 */
async function requestStrategyForCuso(
  cuso: Cuso,
  input: { userId: string; note?: string; patch?: boolean; restart?: boolean },
  now: Date = new Date(),
): Promise<{ turnId: string }> {
  const writing = await strategyTurnRunning(cuso.sokoBotId, now);
  // A fix or patch is a short turn, never the plan: wait for it to land.
  if (writing && cmoChangeKind(writing.clientTurnId) !== null) {
    throw new CmoConflictError("Cuso is finishing a change");
  }
  if (writing) {
    if (input.note) {
      throw new CmoConflictError("Cuso is still writing the plan");
    }
    if (!input.restart || !cmoRunIsSlow("strategy", writing.createdAt, now)) {
      return { turnId: writing.id };
    }
    const { sokoBotControlPlane } = await import(
      "@/services/soko-bot-control-plane.service"
    );
    await sokoBotControlPlane.expireTurn(writing.id);
  }
  return startCmoStrategy(
    cuso,
    input.userId,
    input.note ? { note: input.note, patch: input.patch ?? false } : null,
    now,
  );
}

/**
 * The first plan starts once the research turn ends with the essentials
 * saved, not when the founder confirms the brand: the founder reads the
 * Brand Brain while Cuso writes. Core runs one turn per bot at a time, so it
 * cannot start while the research turn that saved them still runs. Starts
 * nothing once a plan was started or written; null when nothing started.
 */
export async function startCmoPlanAfterResearch(input: {
  sokoBotId: string;
  /** Who asked for the research; Cuso's runner when they are gone. */
  userId: string | null;
}): Promise<{ turnId: string } | null> {
  const cuso = await findCusoForBot(input.sokoBotId);
  if (!cuso || !parseBrandBrain(cuso.brandBrain)) return null;
  const [turn, version] = await Promise.all([
    newestStrategyTurn(cuso.sokoBotId),
    newestMarketingStrategy(cuso.projectId),
  ]);
  // A fix that ran first is no plan; a plan already started is.
  if (version || (turn && cmoChangeKind(turn.clientTurnId) === null))
    return null;
  const userId = input.userId ?? (await cmoRunnerUserId(cuso));
  if (!userId) return null;
  return startCmoStrategy(cuso, userId, null, new Date());
}

/**
 * After any foreground turn of Cuso ends: the first plan when the research
 * is in, otherwise the next brand fix the owner asked for meanwhile.
 */
export async function afterCmoTurn(input: {
  sokoBotId: string;
  userId: string | null;
}): Promise<{ turnId: string } | null> {
  return (
    (await startCmoPlanAfterResearch(input)) ??
    (await startNextCmoChange(input))
  );
}

/**
 * The owner says one Brand Brain section is wrong. The fix is stored on the
 * section at once, so it is never lost, and a short turn rewrites that
 * section (and patches the plan it touches). While Cuso is busy the fix
 * waits, and starts when his turn ends.
 */
export async function fixCmoBrandSection(
  input: CusoTarget & { section: CmoBrandSectionKey; note: string },
  now: Date = new Date(),
): Promise<{ turnId: string } | { queued: true }> {
  const cuso = await requireCuso(input);
  const brandBrain = await requestBrandBrainFix(cuso.projectId, {
    section: input.section,
    note: input.note,
    at: now,
  });
  try {
    const started = await startNextCmoChange(
      { sokoBotId: cuso.sokoBotId, userId: input.userId },
      now,
      { ...cuso, brandBrain },
    );
    return started ?? { queued: true };
  } catch (error) {
    // Out of credits is the owner's to see; a busy bot only means later.
    if (error instanceof CmoConflictError) throw error;
    return { queued: true };
  }
}

/**
 * Starts the fix turn for the Brand Brain sections the owner fixed, unless
 * Cuso is still writing. A fix turn that ended had its go at every fix asked
 * before it started, so it never loops on one it could not make.
 */
export async function startNextCmoChange(
  input: { sokoBotId: string; userId: string | null },
  now: Date = new Date(),
  known?: Cuso,
): Promise<{ turnId: string } | null> {
  const cuso = known ?? (await findCusoForBot(input.sokoBotId));
  const brain = parseBrandBrain(cuso?.brandBrain);
  if (!cuso || !brain) return null;
  const open = brandBrainOpenFixes(brain);
  if (open.length === 0) return null;
  const last = await newestStrategyTurn(cuso.sokoBotId);
  if (last && (await settledTurnStatus(last, now)) === "running") return null;
  // The last fix turn was sent every fix asked up to the time in its id.
  const sent =
    last && cmoChangeKind(last.clientTurnId) === "fix"
      ? Number(last.clientTurnId?.split(":").at(-1))
      : Number.NaN;
  if (open.every((fix) => Date.parse(fix.at) <= sent)) return null;
  const userId = input.userId ?? (await cmoRunnerUserId(cuso));
  if (!userId) return null;
  const newest = Math.max(...open.map((fix) => Date.parse(fix.at)));
  return startStrategyTurn(cuso, { userId, kind: "fix", sent: newest });
}

async function startCmoStrategy(
  cuso: Cuso,
  userId: string,
  change: { note: string; patch: boolean } | null,
  now: Date,
): Promise<{ turnId: string }> {
  try {
    return await startStrategyTurn(
      cuso,
      change
        ? change.patch
          ? { userId, kind: "patch", note: change.note }
          : { userId, kind: "plan", note: change.note }
        : { userId, kind: "plan" },
    );
  } catch (error) {
    // One turn per bot: a plan another request started first is this one;
    // a fix or patch is not.
    const writing = change
      ? null
      : await strategyTurnRunning(cuso.sokoBotId, now);
    if (writing && cmoChangeKind(writing.clientTurnId) === null)
      return { turnId: writing.id };
    throw error;
  }
}

/**
 * The patch a short turn saves: only the entries and plan fields it changes,
 * with the rules still kept.
 */
const PATCH_LINES = [
  "Change only the calendar entries and plan fields this touches, and nothing else. Save them with save_strategy part patch: each entry you change goes whole under its id (a new id adds one, status skipped drops one); a plan field you change goes whole; leave out every entry and field you keep, and they stay exactly as they are. The calendar must still hold at least 16 pieces whose approach and pillar shares are within 7 points of the mix and the pillars. List each difference in changes, in plain words.",
  "Do not write a new plan, research again or touch the Brand Brain.",
];

type StrategyTurn =
  | { userId: string; kind: "plan"; note?: string }
  | { userId: string; kind: "patch"; note: string }
  /** sent: the newest fix the turn is sent, so it never retries them. */
  | { userId: string; kind: "fix"; sent: number };

/** A short turn's message: a patch for the owner's note, or a brand fix. */
function changeMessage(
  cuso: Cuso,
  brain: BrandBrain,
  input: Exclude<StrategyTurn, { kind: "plan" }>,
  planned: boolean,
): string {
  const lines =
    input.kind === "patch"
      ? [
          `Patch ${cuso.businessName}'s marketing plan. The owner asked: ${input.note}`,
          ...PATCH_LINES,
          "Then tell the owner in one sentence what changed.",
        ]
      : [
          ...fixLines(cuso.businessName, brain),
          ...(planned
            ? [
                "",
                "Then patch the plan for this correction, as a change note, not a new plan.",
                ...PATCH_LINES,
              ]
            : ["Do not write a plan."]),
          "Then tell the owner in one sentence what you fixed.",
        ];
  return lines.join("\n");
}

async function startStrategyTurn(
  cuso: Cuso,
  input: StrategyTurn,
): Promise<{ turnId: string }> {
  const brain = parseBrandBrain(cuso.brandBrain);
  if (!brain) {
    throw new CmoConflictError("Cuso is still building the Brand Brain");
  }
  const id = `${STRATEGY_TURN_PREFIX}${cuso.sokoBotId}:`;
  if (input.kind !== "plan") {
    const planned = (await newestMarketingStrategy(cuso.projectId)) !== null;
    if (input.kind === "patch" && !planned) {
      throw new CmoConflictError("Cuso has not written the strategy yet");
    }
    return startCmoTurn(cuso, input.userId, {
      clientTurnId:
        input.kind === "fix"
          ? `${id}fix:${Date.now()}:${input.sent}`
          : `${id}patch:${Date.now()}`,
      message: changeMessage(cuso, brain, input, planned),
      route: CMO_STRATEGY_ROUTE,
    });
  }
  // Named up front: a goal such as "More leads" once pulled whole plans onto
  // a side product or feature with the same word in it.
  const main = brain.offers?.[0];
  const sells = `${brain.reveal?.positioning ?? brain.summary}${main ? ` Main offer: ${main.name} (${main.price}).` : ""}`;
  // A plan for a Zurich restaurant's German site once posted in English.
  const { detectSiteLanguage } = await import("@/lib/site-platform");
  const siteLanguage = input.note
    ? null
    : await detectSiteLanguage(cuso.websiteUrl);
  const span = planWindow();
  return startCmoTurn(cuso, input.userId, {
    clientTurnId: `${id}${Date.now()}`,
    message: brandCorrections(brain)
      .concat(
        input.note
          ? [
              `Change ${cuso.businessName}'s marketing strategy. The owner asked: ${input.note}`,
              "",
              "Start from the strategy in your packet and change only what the request needs. Every entry you do not change stays exactly as it is: same id, date, time and title. To move a piece, change the date on the same id; never add a copy. List each difference in changes, in plain words.",
              "Save with save_strategy: part plan for changes to the strategy (send the whole plan with your changes), part calendar for changes to the calendar (send the whole calendar). Each part leaves the other as saved.",
            ]
          : [
              `Write ${cuso.businessName}'s marketing strategy for the four weeks from ${span.start} to ${span.end}. No calendar entry after ${span.end}.`,
              ...seasonLines(span),
              `What ${cuso.businessName} sells, from the Brand Brain: ${sells} The plan sells this main offer to its main buyers. A single product or feature may carry one campaign, never the whole plan.`,
              "Set the one result the business most needs from selling the main offer, from the Brand Brain, and lead the plan's goals with it.",
              ...(siteLanguage
                ? [
                    `The website is written in ${siteLanguage}: set contentLanguage to ${siteLanguage}, the language its customers read, even though this plan is in the owner's language, unless the owner asked for another.`,
                  ]
                : []),
              ...ownerAnswers(brain),
              "Before you save, read your summary, focus, offer and pillars against the main offer above: if they drift to a narrower product or feature the owner did not name, or away from the one the owner did name, rewrite them.",
              "",
              "Follow your strategy skill exactly. Use the Brand Brain and the channels in your packet.",
              "This is the plan, not the posts. Save it in two short calls of save_strategy, so the owner reads the plan while you write the calendar: first part plan (idea, alternatives, ladder, summary, why, goals, objective, barrier, mix, pillars with their shares, focus, offer, channels, pace, ads, funnel with plays and measure, beforeAfter, improvements, proposals, campaigns, weeks, measurement, questions); then part calendar, the day-by-day calendar whose approach shares match the mix and whose pillar shares match the pillars. Week one in full (date, time, channel, format, approach, pillar, title, brief, why, campaignId, and story for each LinkedIn piece); weeks two to four as titles (date, time, channel, format, approach, pillar, title, campaignId, and story for each LinkedIn piece; no brief or why). Each part leaves the other as saved. save_strategy refuses a save that breaks a hard rule and says which: a summary of at most 20 words, at least 16 pieces, and approach and pillar shares within 7 points. Write no drafts, hooks or previews: after the owner approves and pays, you make the whole month at once.",
            ],
      )
      .concat([
        "Do not create Social posts or images yet; that starts after the owner approves.",
        "Then tell the owner in one or two sentences what the plan does first. The strategy card is your report: do not call report_update, and never mention tools, Social posts or what you did not do.",
      ])
      .join("\n"),
    route: CMO_STRATEGY_ROUTE,
  });
}

/**
 * Plans once ignored the season (no Christmas for a restaurant, no Black
 * Friday for a shop in November) and repeated one fact a dozen times.
 */
function seasonLines(span: { start: string; end: string }): string[] {
  return [
    `Before the calendar, list the dates between ${span.start} and ${span.end} that matter to this business's buyers where they live (the Brand Brain's headquarters and markets) and in its trade: public holidays, shopping days (Black Friday, Cyber Monday), seasons and gift moments (Advent, Christmas, Valentine's Day, back to school), and its industry's events. Build pieces and campaigns around the ones its buyers act on, starting a week or two before, and name the date in each such entry's why. Never invent a discount for one: a sale only when the Brand Brain shows one, otherwise suggest it under improvements. On a holiday the business is closed or its buyers are away, post only about that day, or not at all.`,
    "Vary the calendar: every entry carries its own message, and one fact, number or story (a founding year, a price, a product name) appears in at most two entries of the month.",
  ];
}

/**
 * Each Brand Brain section the owner said is wrong, as one line: a fix they
 * wrote on the section, or a no to one of Cuso's questions.
 */
function correctionLines(brain: BrandBrain): string[] {
  const fixes = brandBrainOpenFixes(brain);
  const fixed = new Set(fixes.map((fix) => fix.section));
  return [
    ...fixes.map(
      (fix) =>
        `- ${fix.section}: you wrote "${brain.profile[fix.section]?.answer ?? ""}". True instead: ${fix.note}`,
    ),
    ...brandBrainCorrections(brain)
      .filter((question) => !fixed.has(question.section))
      .map(
        (question) =>
          `- ${question.section}: you wrote "${question.statement}". ${question.note ? `True instead: ${question.note}` : 'The owner says this is not true: say the opposite plainly, never "unconfirmed" or "unclear".'}`,
      ),
  ];
}

const SECTION_SAVE =
  "Call save_brand_brain once, with sections holding only these sections. Rewrite each one's answer (and its headline, if it says the same) so it states what is true and never repeats what the owner rejected; keep everything else the answer says that still holds, and send findings empty to keep them.";

/**
 * First the Brand Brain: each section the owner said no to is rewritten
 * before the plan is built on it. None when every no is already in.
 */
function brandCorrections(brain: BrandBrain): string[] {
  const lines = correctionLines(brain);
  if (lines.length === 0) return [];
  return [
    "First correct the Brand Brain. The owner said no to what you wrote:",
    ...lines,
    `${SECTION_SAVE} Then plan from the corrected Brand Brain.`,
    "",
  ];
}

/** A short turn that rewrites only the sections the owner fixed. */
function fixLines(businessName: string, brain: BrandBrain): string[] {
  return [
    `Fix ${businessName}'s Brand Brain. The owner corrected what you wrote:`,
    ...correctionLines(brain),
    `${SECTION_SAVE} The owner's words are the source: do not research again.`,
  ];
}

/** The owner's answers, for the strategy request; none when nothing was answered. */
function ownerAnswers(brain: BrandBrain): string[] {
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
  previous: MarketingStrategyPlan["calendar"],
  incoming: MarketingStrategyPlan["calendar"],
  now: Date,
): MarketingStrategyPlan["calendar"] {
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

/**
 * Guards a bot's save against the two ways a revision loses work: an entry
 * kept under the same id and title without its draft gets the draft back,
 * and an entry left in its old slot while a copy moved to a new day is
 * dropped, so a moved piece shows once.
 */
export function keepCalendarWork(
  previous: MarketingStrategyPlan["calendar"],
  incoming: MarketingStrategyPlan["calendar"],
): MarketingStrategyPlan["calendar"] {
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
 * A piece that is a Project file (an image ad) keeps its visual on the
 * approved plan's entry, where Core's media maker reads it; a Social post
 * keeps it on the post.
 */
async function keepFileVisuals(
  db: Prisma.TransactionClient,
  approved: MarketingStrategy,
  sent: CmoCalendarEntry[],
): Promise<MarketingStrategy> {
  const visuals = new Map(
    sent
      .filter((entry) => isMarketingFilePiece(entry) && entry.visual)
      .map((entry) => [entry.id, entry]),
  );
  const plan = parseMarketingPlan(approved.plan);
  if (visuals.size === 0 || !plan) return approved;
  const calendar = plan.calendar.map((entry) => {
    const sentEntry = visuals.get(entry.id);
    return sentEntry
      ? {
          ...entry,
          visual: sentEntry.visual,
          visualFileIds: sentEntry.visualFileIds ?? entry.visualFileIds,
          slides: sentEntry.slides ?? entry.slides,
        }
      : entry;
  });
  return db.marketingStrategy.update({
    where: { id: approved.id },
    data: { plan: { ...plan, calendar } },
  });
}

/**
 * Saves the strategy as a version of the Project's Marketing strategy. A
 * turn's first save adds a version and its later saves complete it (a plan
 * goes in two calls) until it is approved; no save changes another version.
 * Pieces fill in the approved version's Social posts; the runtime then
 * writes the other pieces (ads, articles, newsletters) as Project files. A
 * patch changes only what it sends and keeps each changed entry as it was.
 */
export async function saveCmoStrategy(
  where: CusoTarget | { sokoBotId: string },
  save: CmoStrategySave,
  options: {
    turnId?: string;
    now?: Date;
    /**
     * pieces: only the entries Cuso changed, merged by id into the approved
     * version; patch: only the entries and fields sent, into the newest.
     */
    part?: CmoStrategySavePart;
    /** A rhythm or production turn: it builds on the approved version. */
    executing?: boolean;
    /** Cuso's own save: one that breaks a hard rule saves nothing. */
    rules?: boolean;
  } = {},
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategy> {
  const cuso = await requireCuso(where, db);
  // What the last patch changed is Core's to say.
  const { patched: _patched, ...strategy } = save;
  if (options.part === "pieces") {
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
    return keepFileVisuals(
      db,
      approved,
      (strategy.calendar ?? []) as CmoCalendarEntry[],
    );
  }
  const own = options.turnId
    ? await db.marketingStrategy.findFirst({
        where: {
          projectId: cuso.projectId,
          authorTurnId: options.turnId,
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
  const ownerAds =
    options.turnId && before?.ads?.setByOwner ? before.ads : undefined;
  const keepOwnerAds = <T extends MarketingStrategyPlan>(plan: T): T =>
    ownerAds
      ? {
          ...plan,
          ads: {
            ...(plan.ads ?? ownerAds),
            monthly: ownerAds.monthly,
            currency: ownerAds.currency,
            setByOwner: true,
          },
        }
      : plan;
  let stored: MarketingStrategyPlan;
  if (options.part === "patch") {
    if (!before) throw new CmoConflictError("There is no plan to patch yet");
    const sent = options.turnId
      ? withoutDashes({ ...strategy, calendar: strategy.calendar ?? [] })
      : { ...strategy, calendar: strategy.calendar ?? [] };
    stored = keepOwnerAds(
      patchPlan(before, withLineBreaks(sent), own ? before.patched : []),
    );
  } else {
    const whole = marketingStrategyPlanSchema.parse({
      ...before,
      ...Object.fromEntries(
        Object.entries(strategy).filter(([, value]) => value !== undefined),
      ),
      calendar: strategy.calendar ?? before?.calendar ?? [],
      patched: [],
    });
    // A channel the plan now runs is no longer a proposal.
    const running = new Set(whole.channels.map((channel) => channel.channel));
    // The ad budget the owner set is theirs: Cuso's saves plan around it.
    const parsed = keepOwnerAds({
      ...whole,
      questions: keepAnswers(whole.questions, before?.questions ?? []),
      proposals: whole.proposals.filter(
        (proposal) => !running.has(proposal.channel),
      ),
    });
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
    stored = options.turnId ? withoutDashes(withLineBreaks(merged)) : merged;
  }
  if (options.rules) {
    // A plan part saved before its calendar is checked with the calendar.
    const sendsCalendar =
      options.part === "patch" || strategy.calendar !== undefined;
    const broken = cmoPlanRuleProblems(
      sendsCalendar ? stored : { ...stored, calendar: [] },
    );
    if (broken.length > 0) {
      throw unprocessableEntity(
        [
          "save_strategy saved nothing: the plan breaks a hard rule. Fix each one and save again.",
          ...broken.map((problem) => `- ${problem}`),
        ].join("\n"),
      );
    }
  }
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
      authorTurnId: options.turnId ?? null,
      ...("sokoBotId" in where
        ? { authorSokoBotId: cuso.sokoBotId }
        : { authorUserId: where.userId }),
    },
  });
}

/**
 * A patch on a plan: each sent entry replaces its own (keeping what it
 * leaves out, such as a draft), a new id is added, and every other entry and
 * plan field stays as it was. Each entry it changed keeps how it was before,
 * the first time across one turn's saves.
 */
export function patchPlan(
  before: MarketingStrategyPlan,
  sent: CmoStrategySave & { calendar: CmoStrategySave["calendar"] & {} },
  earlier: MarketingStrategyPlan["patched"],
): MarketingStrategyPlan {
  const { calendar: entries, changes, ...fields } = sent;
  const old = new Map(before.calendar.map((entry) => [entry.id, entry]));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const calendar = [
    ...before.calendar.map((entry) => {
      const next = byId.get(entry.id);
      return next ? { ...entry, ...next } : entry;
    }),
    ...entries.filter((entry) => !old.has(entry.id)),
  ] as CmoCalendarEntry[];
  // The first time across one turn's saves is how the entry was.
  const patched = new Map(earlier.map((item) => [item.id, item]));
  for (const entry of calendar) {
    const was = old.get(entry.id);
    if (
      byId.has(entry.id) &&
      !patched.has(entry.id) &&
      JSON.stringify(was) !== JSON.stringify(entry)
    )
      patched.set(entry.id, { id: entry.id, was: was ?? null });
  }
  return marketingStrategyPlanSchema.parse({
    ...before,
    ...fields,
    calendar,
    changes: changes ?? [],
    patched: [...patched.values()],
  });
}

/**
 * A model sometimes writes line breaks as the two characters "\\n" inside a
 * draft; they would show up literally in a post.
 */
export function withLineBreaks<
  T extends { calendar: MarketingStrategyPlan["calendar"] },
>(strategy: T): T {
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

/** Cuso patches the plan where the owner's answers say it was wrong. */
export async function applyCmoPlanAnswers(
  target: CusoTarget,
): Promise<{ turnId: string }> {
  const cuso = await requireCuso(target);
  const newest = await newestCmoStrategy(cuso);
  const note = cmoPlanAnswerNote(
    parseMarketingPlan(newest.plan)?.questions ?? [],
  );
  if (!note) throw new CmoConflictError("Your answers confirm the plan");
  return requestStrategyForCuso(cuso, {
    userId: target.userId,
    note,
    patch: true,
  });
}

/**
 * The owner pauses one calendar entry from Up next: its Social post (the
 * entry's id) is canceled so it cannot go out; one already going out is
 * refused (409). Any other piece is a Project file the owner uses
 * themselves, so nothing goes out to pause: it is refused too.
 */
export async function pauseCmoCalendarEntry(
  input: CusoTarget & {
    entryId: string;
  },
): Promise<void> {
  const cuso = await requireCuso(input);
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

/**
 * The words of one approved piece that lives in the Project's Files (an
 * article, a page fix, ad copy, a newsletter issue), for its sheet in CMO.
 */
export async function readCmoPieceText(
  input: CusoTarget & {
    entryId: string;
  },
): Promise<string> {
  const cuso = await requireCuso(input);
  const approved = await approvedMarketingStrategy(cuso.projectId);
  const text = approved
    ? await readMarketingPieceText(approved, input.entryId)
    : null;
  if (text === null)
    throw new CmoNotFoundError("This piece is not written yet");
  return text;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
