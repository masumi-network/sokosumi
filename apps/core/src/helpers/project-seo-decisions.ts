import { createHash } from "node:crypto";
import {
  OPEN_STRATEGY,
  type PublicSeoDecision,
  publicSeoDecisionSchema,
  withinStrategyLimit,
} from "@/schemas/project-seo-action.schema";
import { auditedSeoPageKey } from "./project-seo-site-findings";

export function readPublicSeoDecisions(
  raw: unknown,
  destinations: string[],
  snapshots: readonly { url: string; snapshotId: string }[] = [],
) {
  if (!Array.isArray(raw) || !withinStrategyLimit(raw)) return undefined;
  const pages = new Map(
    destinations.map((url) => [auditedSeoPageKey(url), url]),
  );
  const accepted = new Map<string, PublicSeoDecision | null>();
  for (const row of raw) {
    const parsed = publicSeoDecisionSchema.safeParse(row);
    if (!parsed.success) continue;
    const targetUrl = pages.get(auditedSeoPageKey(parsed.data.targetUrl));
    if (!targetUrl) continue;
    if (
      parsed.data.kind === OPEN_STRATEGY &&
      !parsed.data.observations.every((citation) => {
        if (!pages.has(citation.url)) return false;
        const sources = snapshots.filter((page) => page.url === citation.url);
        return (
          sources.length === 1 && sources[0]?.snapshotId === citation.snapshotId
        );
      })
    )
      continue;
    const key = JSON.stringify([targetUrl, parsed.data.id]);
    const decision = { ...parsed.data, targetUrl };
    const prior = accepted.get(key);
    if (prior === undefined) accepted.set(key, decision);
    else if (JSON.stringify(prior) !== JSON.stringify(decision))
      accepted.set(key, null);
  }
  const decisions = [...accepted.values()].filter(
    (row): row is PublicSeoDecision => row !== null,
  );
  return decisions.length ? decisions : undefined;
}

export function publicDecisionAction(
  d: PublicSeoDecision,
  country: string,
  language: string,
) {
  const identity = JSON.stringify([
    country,
    language,
    auditedSeoPageKey(d.targetUrl),
    d.kind,
    d.id,
  ]);
  return {
    id: "decision:" + createHash("sha256").update(identity).digest("hex"),
    pageUrl: d.targetUrl,
    title: d.action,
    why: d.reason,
    expectedEffect: d.nextCheck,
    edit: null,
    effort: "unknown" as const,
    kind: "opportunity" as const,
    findingIds: [],
    evidence:
      d.kind === OPEN_STRATEGY
        ? d.observations.map((o) => `"${o.quote}" (${o.url})`)
        : d.evidence,
    decision: {
      kind: d.kind,
      alternative: d.alternative,
      nextCheck: d.nextCheck,
    },
  };
}
