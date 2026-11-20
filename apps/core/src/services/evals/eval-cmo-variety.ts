import type { MarketingStrategyPlan, ScenarioCheck } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import { cmoInfographicCap } from "@/services/cmo-media-maker.service";
import { cmoRepeatedMessages } from "@/services/cmo-plan-review.service";
import type { EvalLaneRecord } from "@/services/evals/eval-lanes.service";
import {
  newestMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";

/**
 * The owner says the buyer Cuso planned for is wrong (cmo-v8): a no to
 * ballcaps once changed the goal and left caps in the funnel and a question.
 */
export const CMO_CORRECTION_CASE_ID = "cmo-correction-everywhere";

const REJECTED = /revenue[- ]?(?:operations|ops|teams?|leaders?)|\brevops\b/i;
const CORRECTED = /recruit|hiring|interview|candidate/i;
const HISTORY = new Set(["changes", "patched", "previews", "alternatives"]);

function texts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(texts);
  return [];
}

/** Where a saved strategy still says something: its fields and planned pieces. */
function placesSaying(plan: MarketingStrategyPlan, pattern: RegExp): string[] {
  return [
    ...Object.entries(plan)
      .filter(([key]) => key !== "calendar" && !HISTORY.has(key))
      .filter(([, value]) => texts(value).some((text) => pattern.test(text)))
      .map(([key]) => key),
    ...plan.calendar
      .filter(
        (entry) =>
          entry.status !== "skipped" &&
          [entry.title, entry.brief, entry.story, entry.claim].some(
            (text) => text && pattern.test(text),
          ),
      )
      .map((entry) => entry.id),
  ];
}

/** The saved strategy after the correction: the old buyer gone, the new one in. */
export async function correctionChecks(
  lane: EvalLaneRecord,
): Promise<ScenarioCheck[]> {
  const saved = await newestMarketingStrategy(lane.cusoProjectId);
  const plan = parseMarketingPlan(saved?.plan) as MarketingStrategyPlan | null;
  if (!plan)
    return [{ label: "A strategy is saved", pass: false, actual: "none" }];
  const still = placesSaying(plan, REJECTED);
  const core = [plan.summary, ...texts(plan.goals), ...texts(plan.focus)];
  return [
    {
      label: "Nothing in the strategy names revenue operations any more",
      pass: still.length === 0,
      actual: still.length ? `still in ${still.join(", ")}` : "gone",
    },
    {
      label: "The summary, goals or focus name recruiting teams",
      pass: core.some((text) => CORRECTED.test(text)),
      actual: plan.summary.slice(0, 200),
    },
    {
      label: "The funnel names recruiting teams",
      pass: texts(plan.funnel).some((text) => CORRECTED.test(text)),
      actual:
        texts(plan.funnel)
          .find((text) => CORRECTED.test(text))
          ?.slice(0, 160) ?? "not in the funnel",
    },
  ];
}

/**
 * A one-pillar month's pieces each argue their own point: an entry's claim,
 * or its title where it has none (a Cuso before cmo-v8).
 */
export async function claimChecks(
  strategy: MarketingStrategyPlan,
): Promise<ScenarioCheck[]> {
  const pieces = strategy.calendar.filter(
    (entry) => entry.status !== "skipped" && !entry.videoOf,
  );
  const missing = pieces.filter((entry) => !entry.claim?.trim());
  const repeats = await cmoRepeatedMessages(strategy.calendar);
  return [
    {
      label: "Every piece names the one claim it argues",
      pass: pieces.length > 0 && missing.length === 0,
      actual: `${pieces.length - missing.length} of ${pieces.length} with a claim`,
    },
    {
      label: "No point argued twice in a week or more than three times a month",
      pass: repeats.problems.length === 0,
      actual: repeats.problems.length
        ? repeats.problems.join(" · ").slice(0, 600)
        : `${pieces.length} pieces, no repeats`,
    },
  ];
}

/** The pictures of a month: every kind of print they took, in order per network. */
export async function pictureVarietyChecks(
  strategyId: string,
  projectId: string,
): Promise<ScenarioCheck[]> {
  const posts = await prisma.socialPost.findMany({
    where: { marketingStrategyId: strategyId, projectId },
    select: { id: true, provider: true, scheduledAt: true, planning: true },
  });
  const styled = posts.flatMap((post) => {
    const id = (post.planning as { styleReferenceId?: unknown } | null)
      ?.styleReferenceId;
    return typeof id === "string" ? [{ ...post, reference: id }] : [];
  });
  const kinds = new Map(
    (
      await prisma.referenceImage.findMany({
        where: { id: { in: styled.map((post) => post.reference) } },
        select: { id: true, kind: true },
      })
    ).map((row) => [row.id, row.kind]),
  );
  const kindOf = (post: (typeof styled)[number]) =>
    kinds.get(post.reference) ?? "unknown";
  const infographics = styled.filter(
    (post) => kindOf(post) === "infographic",
  ).length;
  const cap = cmoInfographicCap(styled.length);
  const byNetwork = new Map<string, typeof styled>();
  for (const post of styled)
    byNetwork.set(post.provider, [
      ...(byNetwork.get(post.provider) ?? []),
      post,
    ]);
  const sameNeighbours = [...byNetwork.entries()].flatMap(([network, list]) => {
    const ordered = [...list].sort(
      (left, right) =>
        (left.scheduledAt?.getTime() ?? 0) -
        (right.scheduledAt?.getTime() ?? 0),
    );
    return ordered
      .slice(1)
      .flatMap((post, index) =>
        kindOf(post) === kindOf(ordered[index]!)
          ? [`${network}: ${kindOf(post)} twice`]
          : [],
      );
  });
  const mix = [...new Set(styled.map(kindOf))]
    .map(
      (kind) =>
        `${kind} ${styled.filter((post) => kindOf(post) === kind).length}`,
    )
    .join(", ");
  return [
    {
      label: "At most one picture in four is an infographic",
      pass: styled.length > 0 && infographics <= cap,
      actual: `${infographics} of ${styled.length} (${mix || "no styled pictures"})`,
    },
    {
      label: "Neighbouring pictures on a network take different kinds of print",
      pass: styled.length > 0 && sameNeighbours.length === 0,
      actual: sameNeighbours.join(", ") || "all different",
    },
  ];
}

const HOOK_RULE = /^The first two lines/;

/** Jev's read of each LinkedIn post: its first two lines make people tap "see more". */
export function linkedInOpeningChecks(
  posts: readonly {
    id: string;
    provider: string;
    text: string;
    planning: unknown;
  }[],
  writing: Record<string, { missed: string[] }>,
): ScenarioCheck[] {
  const readOf = (post: (typeof posts)[number]) => {
    const id = (post.planning as { id?: unknown } | null)?.id;
    return (
      writing[post.id] ?? (typeof id === "string" ? writing[id] : undefined)
    );
  };
  const linkedIn = posts.filter(
    (post) => post.provider.toLowerCase() === "linkedin" && readOf(post),
  );
  const missed = linkedIn.filter((post) =>
    readOf(post)?.missed.some((rule) => HOOK_RULE.test(rule)),
  );
  return [
    {
      label:
        "Every LinkedIn post opens on a result, a number, a customer or a decision",
      pass: linkedIn.length > 0 && missed.length === 0,
      actual: missed.length
        ? missed
            .map((post) => `"${post.text.split("\n")[0]?.slice(0, 90)}"`)
            .join(" · ")
        : `${linkedIn.length} read, none missed`,
    },
  ];
}
