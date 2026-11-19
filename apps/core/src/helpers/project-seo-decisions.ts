import { createHash } from "node:crypto";
import {
  MAX_STRATEGY_DECISIONS,
  type PublicSeoDecision,
  publicSeoDecisionSchema,
} from "@/schemas/project-seo-action.schema";
import { auditedSeoPageKey } from "./project-seo-site-findings";

export function readPublicSeoDecisions(raw: unknown, destinations: string[]) {
  if (!Array.isArray(raw) || raw.length > MAX_STRATEGY_DECISIONS)
    return undefined;
  const pages = new Map(
    destinations.map((url) => [auditedSeoPageKey(url), url]),
  );
  const accepted = new Map<string, PublicSeoDecision | null>();
  for (const row of raw) {
    const parsed = publicSeoDecisionSchema.safeParse(row);
    if (!parsed.success) continue;
    const targetUrl = pages.get(auditedSeoPageKey(parsed.data.targetUrl));
    if (!targetUrl) continue;
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
    evidence: d.evidence,
    decision: {
      kind: d.kind,
      alternative: d.alternative,
      nextCheck: d.nextCheck,
    },
  };
}
