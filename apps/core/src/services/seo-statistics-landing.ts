import {
  assertGa4LandingHost,
  ga4LandingHostArguments,
  ga4LandingOutcomeArguments,
  ga4LandingPageArguments,
  ga4LandingPlan,
  normalizeGa4LandingOutcomes,
  normalizeGa4LandingPages,
} from "@/lib/seo/native-ga4-landing";
import {
  type NativeStatisticsQuery,
  previousSeoPeriod,
  unwrapNativeStatistics,
} from "@/lib/seo/native-statistics";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { sha256 } from "./project-seo-store";
import {
  connectionVersion,
  type SeoStatisticsIntegration,
} from "./seo-connections.service";
import { investigateLandingGoal } from "./seo-statistics-landing-goal";

/** Use the original account identity scheme so retained owner receipts remain comparable. */
export function landingOutcomeAccountKey(
  integration: SeoStatisticsIntegration,
) {
  return sha256(
    JSON.stringify([
      integration.entityId,
      integration.composioAccountId,
      integration.connectionRevision,
    ]),
  );
}
export async function collectLandingPages(
  query: NativeStatisticsQuery,
  landingPlan: ReturnType<typeof ga4LandingPlan> | null,
  actor: SeoActor,
  pages: { id: string; url: string }[],
  integration: SeoStatisticsIntegration,
  read: (args: Record<string, unknown>) => Promise<unknown>,
) {
  if (!landingPlan?.query.pageUrls.length) return null;
  const verifiedLanding = async ({
    from,
    to,
  }: {
    from: string;
    to: string;
  }) => {
    const selected = { ...landingPlan.query, from, to };
    const hosts = unwrapNativeStatistics(
      await read(ga4LandingHostArguments(selected)),
      ["metricHeaders"],
    );
    assertGa4LandingHost(query, hosts);
    const raw = unwrapNativeStatistics(
      await read(ga4LandingPageArguments(selected)),
      ["metricHeaders"],
    );
    return {
      ...normalizeGa4LandingPages(selected, raw, landingPlan.skippedUrls),
      verifiedHost: new URL(query.pageUrls[0]!).hostname,
    };
  };
  const landingPages = await verifiedLanding(query);
  const priorWindow = previousSeoPeriod(query.from, query.to);
  // The prior aggregate uses pageLocation. Compare reading depth only with a separate, exact landing read.
  // At most one host inventory and one landing read. Their failure preserves the current observation.
  const canCompare =
    landingPages.channel === "organic" &&
    landingPages.timeZone &&
    !landingPlan.skippedUrls.length &&
    landingPages.rows.length === query.pageUrls.length &&
    landingPages.rows.every(
      (row) => Number.isSafeInteger(row.sessions) && row.sessions > 0,
    );
  const previousLanding = canCompare
    ? await verifiedLanding(priorWindow).catch(() => undefined)
    : undefined;
  const evidence = landingPages.timeZone
    ? {
        landingEngagementEvidence: {
          connectionVersion: connectionVersion(integration),
          ...(previousLanding?.timeZone
            ? {
                previous: {
                  ...priorWindow,
                  landingPages: previousLanding,
                },
              }
            : canCompare
              ? { previousUnavailable: true as const }
              : {}),
        },
      }
    : {};
  // A property without these events (or a failed event read) still has measured sessions and generic key events.
  if (actor.sokoBotId || landingPages.channel !== "organic")
    return { landingPages, ...evidence, outcomes: undefined };
  const named = await read(ga4LandingOutcomeArguments(landingPlan.query))
    .then((raw) =>
      normalizeGa4LandingOutcomes(
        landingPlan.query,
        unwrapNativeStatistics(raw, ["metricHeaders"]),
      ),
    )
    .catch(() => null);
  // Retain observed named counts if their calendar cannot support the optional comparison.
  const sameCalendar =
    !named?.rows.length || named.timeZone === landingPages.timeZone;
  const goalInvestigation =
    sameCalendar &&
    previousLanding &&
    (await investigateLandingGoal({
      query,
      actor,
      pages,
      before: previousLanding,
      after: landingPages,
      read,
    }).catch(() => undefined));
  if (!named?.rows.length && !goalInvestigation)
    return { landingPages, ...evidence, outcomes: undefined };
  return {
    landingPages,
    ...evidence,
    outcomes: {
      version: 1 as const,
      channel: "organic" as const,
      accountKey: landingOutcomeAccountKey(integration),
      propertyId: query.propertyId,
      verifiedHost: landingPages.verifiedHost,
      from: query.from,
      to: query.to,
      timeZone: goalInvestigation
        ? goalInvestigation.timeZone
        : named!.timeZone,
      rows: named?.rows ?? [],
      ...(goalInvestigation && { goalInvestigation }),
    },
  };
}
