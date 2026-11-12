import type { CmoOverview } from "@sokosumi/core-client";

import { AGENT_NAME } from "../../lib/agent";
import { type BrandSectionKey, brandProfile } from "../../lib/brand-sections";
import { planWeeks } from "../../lib/calendar";
import { channelKey } from "../../lib/channels";
import type { SkippedStep } from "../../lib/skipped-steps";
import { strategyApproved } from "../../lib/strategy";
import { liveLine, planWriting, researchGroups } from "./live";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

/** The seven stages on the bar, in order. */
export type StageId =
  | "website"
  | "research"
  | "brand"
  | "plan"
  | "briefing"
  | "golive"
  | "month";

export const STAGES: { id: StageId; label: string; who: "You" | "Cuso" }[] = [
  { id: "website", label: "Website", who: "You" },
  { id: "research", label: "Research", who: "Cuso" },
  { id: "brand", label: "Brand check", who: "You" },
  { id: "plan", label: "Plan", who: "Cuso" },
  { id: "briefing", label: "Briefing", who: "You" },
  { id: "golive", label: "Go live", who: "You" },
  { id: "month", label: "Your month", who: "Cuso" },
];

/** The bar before the hire: the website is the stage, the rest is to come. */
export function websiteMarks(): StageMark[] {
  return STAGES.map((stage, index) => ({
    ...stage,
    state: index === 0 ? "now" : "next",
    who: stage.who,
  }));
}

/** What "Next" says on a phone, for each stage. */
export const NEXT_LINE: Record<StageId, string> = {
  website: "Next: I read your site",
  research: "Next: a few questions",
  brand: "Next: your briefing",
  plan: "Next: your briefing",
  briefing: "Next: go live",
  golive: "Next: your month",
  month: "",
};

/** A briefing step the person went past on this device (Core keeps no record). */
export type BriefDone = "plan" | "pace" | "ads" | "checks";

/** What the web knows that the overview does not. */
export interface BriefLocal {
  /** Sounds right, Keep, Yes to the budget, or a Later on the checks. */
  briefed: BriefDone[];
  /** From CMO's cookie: "questions" when the brand questions were left for later. */
  skipped: SkippedStep[];
  /** Launch was pressed in this session. */
  launched: boolean;
  /** The read ended with Cuso asking something in words. */
  askedInWords: boolean;
  /** The time so far against the usual: past it, or past twice it. */
  slow: "none" | "slow" | "stuck";
}

const researching = (overview: CmoOverview) =>
  overview.work?.kind === "research" && overview.work.status === "running";

const strategyRunning = (overview: CmoOverview) =>
  overview.work?.kind === "strategy" && overview.work.status === "running";

/** Where the person is on the bar, from the overview and this device. */
export function briefStage(overview: CmoOverview, local: BriefLocal): StageId {
  if (!overview.brandBrain || researching(overview)) return "research";
  if (strategyApproved(overview)) return local.launched ? "month" : "golive";
  if (!overview.brandBrainConfirmedAt) return "brand";
  const strategy = overview.strategy;
  if (!strategy || strategy.calendar.length === 0 || planWriting(overview)) {
    return "plan";
  }
  // Approval belongs to Go live: the briefing ends with its last step.
  return briefingLeft(overview, local).length > 0 ? "briefing" : "golive";
}

export interface StageMark {
  id: StageId;
  label: string;
  /** done: ink. now: Iris. background: dashed, Cuso works on it behind. */
  state: "done" | "now" | "background" | "next";
  /** Who acts, under the label. */
  who: string;
}

/** The seven stages as the bar draws them. */
export function stageMarks(
  overview: CmoOverview,
  local: BriefLocal,
): StageMark[] {
  const stage = briefStage(overview, local);
  const at = STAGES.findIndex((candidate) => candidate.id === stage);
  // Core starts the plan when the read ends: it writes behind the brand
  // check, and may be written before the brand is confirmed.
  const planBehind = stage === "brand" && strategyRunning(overview);
  const planWritten =
    stage === "brand" &&
    !planBehind &&
    (overview.strategy?.calendar.length ?? 0) > 0;
  return STAGES.map((candidate, index) => {
    if (index < at) return { ...candidate, state: "done", who: "done" };
    if (index === at) {
      return {
        ...candidate,
        state: "now",
        who: nowWho(overview, local, stage),
      };
    }
    if (candidate.id === "plan" && planWritten) {
      return { ...candidate, state: "done", who: "done" };
    }
    if (candidate.id === "plan" && planBehind) {
      return {
        ...candidate,
        state: "background",
        who: `${AGENT_NAME} · writing`,
      };
    }
    return { ...candidate, state: "next", who: candidate.who };
  });
}

function nowWho(
  overview: CmoOverview,
  local: BriefLocal,
  stage: StageId,
): string {
  if (stage !== "research") {
    return STAGES.find((candidate) => candidate.id === stage)?.who ?? "";
  }
  if (researching(overview)) {
    return overview.brandBrain ? `${AGENT_NAME} · finishing` : AGENT_NAME;
  }
  return local.askedInWords
    ? `${AGENT_NAME} · waiting`
    : `${AGENT_NAME} · stopped`;
}

/** One thing the chat asks. */
export type Ask =
  | { kind: "research-reply" }
  | { kind: "research-retry" }
  | { kind: "brand-question"; id: string; index: number; total: number }
  | { kind: "brand-check" }
  | { kind: "plan-retry" }
  | { kind: "briefing-plan" }
  | { kind: "briefing-week" }
  | { kind: "plan-question"; id: string; index: number; total: number }
  | { kind: "plan-apply" }
  | { kind: "briefing-ads" }
  | { kind: "approve"; canApprove: boolean }
  | { kind: "connect" };

const isAdChannel = (channel: string) => {
  const key = channelKey(channel);
  return key === "google_ads" || key === "meta_ads";
};

/** The plan's ad pieces, in date order. */
export function adEntries(strategy: Strategy): Entry[] {
  return strategy.calendar
    .filter((entry) => isAdChannel(entry.channel) && entry.status !== "skipped")
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The briefing's steps for this plan: Ads only when the plan has ads. */
export function briefSteps(
  overview: CmoOverview,
): ("plan" | "week" | "checks" | "ads")[] {
  const strategy = overview.strategy;
  if (!strategy) return [];
  return [
    "plan",
    "week",
    ...((strategy.questions ?? []).length > 0 ? (["checks"] as const) : []),
    ...(strategy.ads && adEntries(strategy).length > 0
      ? (["ads"] as const)
      : []),
  ];
}

/** A no on the plan's checks that Cuso has not fitted the plan to yet. */
export function planUnfitted(overview: CmoOverview): boolean {
  const strategy = overview.strategy;
  return (
    (strategy?.questions ?? []).some((question) => question.answer === "no") &&
    (strategy?.changes ?? []).length === 0
  );
}

/**
 * Everything that needs the person, in the order the chat asks it. The page
 * never asks; the chat shows the first of these.
 */
export function briefAsks(overview: CmoOverview, local: BriefLocal): Ask[] {
  const stage = briefStage(overview, local);
  const brain = overview.brandBrain;

  if (stage === "research" && !brain) {
    if (researching(overview)) {
      return local.slow === "stuck" ? [{ kind: "research-retry" }] : [];
    }
    return [
      local.askedInWords
        ? { kind: "research-reply" }
        : { kind: "research-retry" },
    ];
  }

  if (stage === "research" || stage === "brand") {
    const open = local.skipped.includes("questions")
      ? []
      : (brain?.questions ?? []).filter((question) => !question.answer);
    const total = (brain?.questions ?? []).length;
    const asks: Ask[] = open.map((question) => ({
      kind: "brand-question",
      id: question.id,
      index: (brain?.questions ?? []).indexOf(question),
      total,
    }));
    if (stage === "brand") asks.push({ kind: "brand-check" });
    return asks;
  }

  if (stage === "plan") {
    const running = strategyRunning(overview);
    return running && local.slow !== "stuck" ? [] : [{ kind: "plan-retry" }];
  }

  const approve: Ask = {
    kind: "approve",
    canApprove: overview.viewerCanApprove,
  };
  if (stage === "briefing") {
    // The next question waits until a change lands.
    if (strategyRunning(overview)) return [];
    // Approval is Go live's question; it counts here as the one after.
    const left = briefingLeft(overview, local);
    return planUnfitted(overview) ? left : [...left, approve];
  }

  if (stage === "golive") {
    if (strategyApproved(overview)) return [{ kind: "connect" }];
    return strategyRunning(overview) ? [] : [approve];
  }
  return [];
}

/**
 * What the briefing still needs: the plan, week one, the plan's checks (and
 * fitting the nos), then the ads. Once a plan was approved, the briefing is
 * over on every device: a newer draft only fits its nos.
 */
function briefingLeft(overview: CmoOverview, local: BriefLocal): Ask[] {
  const unfitted = planUnfitted(overview);
  if (overview.approvedStrategy)
    return unfitted ? [{ kind: "plan-apply" }] : [];
  const strategy = overview.strategy as Strategy;
  const asks: Ask[] = [];
  if (!local.briefed.includes("plan")) asks.push({ kind: "briefing-plan" });
  if (!local.briefed.includes("pace")) asks.push({ kind: "briefing-week" });
  const questions = strategy.questions ?? [];
  const open = local.briefed.includes("checks")
    ? []
    : questions.filter((question) => !question.answer);
  for (const question of open) {
    asks.push({
      kind: "plan-question",
      id: question.id,
      index: questions.indexOf(question),
      total: questions.length,
    });
  }
  // All the nos become one patch once every check is answered.
  if (unfitted && open.length === 0) asks.push({ kind: "plan-apply" });
  if (
    briefSteps(overview).includes("ads") &&
    !local.briefed.includes("ads") &&
    !strategy.ads?.setByOwner
  ) {
    asks.push({ kind: "briefing-ads" });
  }
  return asks;
}

/** The working bar: Core's own count, what Cuso does, what it means for you. */
export interface WorkingStatus {
  count: string;
  title: string;
  now: string;
  foot: string;
}

const CLOSE_TAB = "Nothing needs you. You can close this tab.";

export function workingStatus(
  overview: CmoOverview,
  local: BriefLocal,
): WorkingStatus {
  const stage = briefStage(overview, local);
  const live = liveLine(overview);
  const now = live ? `Now: ${live.label}` : "";
  if (stage === "month") {
    const { written, total } = overview.production;
    return {
      count: total > 0 ? `${written} of ${total} written` : "",
      title: `Onboarding is done. I keep making your month in the background.`,
      now: "",
      foot: "",
    };
  }
  const work = overview.work;
  if (work?.kind === "strategy" && work.status === "running" && work.change) {
    return {
      count: "",
      title:
        work.change === "fix"
          ? "Fixing your Brand Brain"
          : "Changing your plan",
      now,
      foot: "Your next question waits until this lands.",
    };
  }
  if (stage === "plan" || (stage === "brand" && strategyRunning(overview))) {
    const pieces = overview.strategy?.calendar.length ?? 0;
    return {
      count: pieces > 0 ? `${pieces} pieces so far` : "",
      title: "Writing your plan",
      now,
      foot: "Nothing needs you. I'll open the chat when your briefing is ready.",
    };
  }
  const groups = researchGroups(overview) ?? [];
  const done = groups.filter((group) => group.state === "done").length;
  const slow = local.slow !== "none";
  return {
    count: groups.length > 0 ? `${done} of ${groups.length} groups` : "",
    title: slow
      ? "Taking longer than usual"
      : groups.length > 0
        ? `Reading your site and ${groups.length} places around it`
        : "Reading your site",
    now,
    foot: slow
      ? "Everything I've read is saved. You can still close this tab."
      : CLOSE_TAB,
  };
}

/**
 * A fix Cuso has not rewritten yet: the whole Brand Brain's (a general
 * correction) or one section's; null when none waits.
 */
export function brandFixPending(
  overview: CmoOverview,
): { section: BrandSectionKey | null; note: string } | null {
  const brain = overview.brandBrain;
  if (!brain) return null;
  if (brain.fix && !brain.fix.fixed) {
    return { section: null, note: brain.fix.note };
  }
  const profile = brandProfile(brain);
  const key = (Object.keys(profile) as BrandSectionKey[]).find(
    (candidate) => profile[candidate]?.fix && !profile[candidate]?.fix?.fixed,
  );
  const fix = key ? profile[key]?.fix : undefined;
  return key && fix ? { section: key, note: fix.note } : null;
}

/** What Cuso does while the chat asks; null when he is idle. */
export function meanwhile(overview: CmoOverview): string | null {
  const work = overview.work;
  if (work?.status !== "running") return null;
  if (work.kind === "research") {
    return `Meanwhile ${AGENT_NAME} is wrapping up the research`;
  }
  if (work.change === "fix") {
    return `Meanwhile ${AGENT_NAME} is fixing your Brand Brain`;
  }
  if (work.change === "patch") {
    return `Meanwhile ${AGENT_NAME} is changing your plan`;
  }
  const fixWaits = brandFixPending(overview) !== null;
  return fixWaits
    ? `Meanwhile ${AGENT_NAME} is writing your plan · the fix waits its turn, then joins it`
    : `Meanwhile ${AGENT_NAME} is writing your plan`;
}

/** The plan's first week of pieces, in date and time order. */
export function weekOne(calendar: Entry[]): Entry[] {
  const days = new Set(planWeeks(calendar)[0]?.days ?? []);
  return calendar
    .filter((entry) => days.has(entry.date) && entry.status !== "skipped")
    .sort((a, b) =>
      `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`),
    );
}

/** Which week of the plan a date falls in, from 1; null without one. */
export function adWeek(strategy: Strategy, date: string | undefined) {
  const start = planWeeks(strategy.calendar)[0]?.start;
  if (!date || !start) return null;
  const days =
    (new Date(`${date}T00:00:00Z`).getTime() -
      new Date(`${start}T00:00:00Z`).getTime()) /
    86_400_000;
  return Math.floor(days / 7) + 1;
}

/**
 * The piece a plan question changes: the first of its `entryIds` on the
 * calendar. Core does not check them (the plan part saves before its
 * pieces), so an id may not resolve; null then, and the statement shows.
 */
export function questionEntry(
  strategy: Strategy,
  question: NonNullable<Strategy["questions"]>[number],
): Entry | null {
  for (const id of question.entryIds ?? []) {
    const entry = strategy.calendar.find((candidate) => candidate.id === id);
    if (entry) return entry;
  }
  return null;
}
