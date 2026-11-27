import type { PublicSeoPayload } from "@/helpers/project-seo-report";

import { issueIdentity } from "./project-seo-check-identity";

type Check = PublicSeoPayload["checks"][number];

/** One stored audit the recheck reads. */
export interface RecheckAudit {
  id: string;
  observedAt: Date;
  payload: PublicSeoPayload;
}

export type RecheckOutcome = "closed" | "still_fired" | "not_compared";
export type RecheckStatus = "done" | "partial" | "open" | "not_compared";

/** One page rule an action names, and what the newer audit says about it. */
export interface RecheckPair {
  pageUrl: string;
  rowId: string;
  device: string | null;
  outcome: RecheckOutcome;
  baselineObservationId: string | null;
  baselineObservedAt: string | null;
  /** The audit whose row gave the outcome. */
  checkedObservationId: string | null;
  ruleKey: string | null;
  finalUrl: string | null;
}

export interface ActionRecheck {
  observationId: string;
  actionId: string;
  status: RecheckStatus;
  pairs: RecheckPair[];
}

/** The stored status of an action from an earlier recheck. */
export type PriorRecheck = Pick<ActionRecheck, "status" | "pairs">;

const pairKey = (pair: Pick<RecheckPair, "pageUrl" | "rowId" | "device">) =>
  JSON.stringify([pair.pageUrl, pair.rowId, pair.device]);

/** A pass or a fired row is a read of the rule; a blocked or not checked row is none. */
const isRead = (check: Check) =>
  check.result === "pass" || check.result === "fired";

function checksByIssue(audit: RecheckAudit) {
  const checks = new Map<string, Check>();
  for (const check of audit.payload.checks) {
    const key = issueIdentity(audit.payload, check);
    if (!checks.has(key)) checks.set(key, check);
  }
  return checks;
}

function outcome(
  baseline: { audit: RecheckAudit; check: Check },
  next: { audit: RecheckAudit; check: Check },
): RecheckOutcome {
  const before = baseline.check,
    after = next.check;
  // Only a rule read on the page alone, with the same rule and the same final address, shows the owner's fix.
  if (
    before.result === "fired" &&
    after.result === "pass" &&
    before.pageOnly &&
    after.pageOnly &&
    before.ruleKey &&
    before.ruleKey === after.ruleKey &&
    before.finalUrl &&
    before.finalUrl === after.finalUrl
  )
    return "closed";
  if (after.result !== "fired") return "not_compared";
  if (before.ruleKey && after.ruleKey)
    return before.ruleKey === after.ruleKey ? "still_fired" : "not_compared";
  // A report from before rule keys: the same rulebook is the same rule.
  return !before.ruleKey &&
    !after.ruleKey &&
    baseline.audit.payload.rulebookVersion ===
      next.audit.payload.rulebookVersion
    ? "still_fired"
    : "not_compared";
}

function actionStatus(pairs: RecheckPair[]): RecheckStatus {
  const closed = pairs.filter((pair) => pair.outcome === "closed").length;
  if (closed && closed === pairs.length) return "done";
  if (closed) return "partial";
  return pairs.some((pair) => pair.outcome === "still_fired")
    ? "open"
    : "not_compared";
}

/**
 * What the newer audit `next` says about each action of the earlier audits. A pair's baseline is the newest audit
 * before `next`, from the action's own audit on, that read the rule (pass or fired). The issue identity binds the page,
 * rule, device and market, so a row of another country or language never pairs. `prior` gives an action's stored
 * status: a done action is left out, and a pair an earlier recheck closed stays closed until its rule fires again.
 */
export function recheckSeoAuditActions(
  next: RecheckAudit,
  earlier: RecheckAudit[],
  prior: (
    observationId: string,
    actionId: string,
  ) => PriorRecheck | undefined = () => undefined,
): ActionRecheck[] {
  const audits = earlier
    .filter((audit) => audit.observedAt < next.observedAt)
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  const checks = new Map(audits.map((audit) => [audit, checksByIssue(audit)]));
  const nextChecks = checksByIssue(next);
  return audits.flatMap((audit, index) => {
    const findings = new Map(
      audit.payload.findings.map((finding) => [finding.id, finding]),
    );
    // The audits from the action's own one up to `next`, newest first.
    const since = audits.slice(0, index + 1);
    return audit.payload.actions.flatMap((action) => {
      const stored = prior(audit.id, action.id);
      if (stored?.status === "done") return [];
      const closedBefore = new Map(
        (stored?.pairs ?? [])
          .filter((pair) => pair.outcome === "closed")
          .map((pair) => [pairKey(pair), pair]),
      );
      const pairs = new Map<string, RecheckPair>();
      for (const id of action.findingIds) {
        const finding = findings.get(id);
        if (!finding) continue;
        const key = issueIdentity(audit.payload, finding);
        if (pairs.has(key)) continue;
        const pair: RecheckPair = {
          pageUrl: finding.pageUrl,
          rowId: finding.rowId,
          device: finding.device,
          outcome: "not_compared",
          baselineObservationId: null,
          baselineObservedAt: null,
          checkedObservationId: null,
          ruleKey: null,
          finalUrl: null,
        };
        pairs.set(key, pair);
        const baseline = since
          .map((item) => ({ audit: item, check: checks.get(item)!.get(key) }))
          .find(
            (item): item is { audit: RecheckAudit; check: Check } =>
              !!item.check && isRead(item.check),
          );
        const after = nextChecks.get(key);
        // A finding without a device names no one row.
        if (!finding.device || !baseline || !after) continue;
        pair.baselineObservationId = baseline.audit.id;
        pair.baselineObservedAt = baseline.audit.observedAt.toISOString();
        pair.ruleKey = after.ruleKey ?? baseline.check.ruleKey ?? null;
        pair.finalUrl = after.finalUrl ?? null;
        pair.checkedObservationId = next.id;
        pair.outcome = outcome(baseline, { audit: next, check: after });
      }
      const list = [...pairs.values()].map((pair) => {
        const closed = closedBefore.get(pairKey(pair));
        return closed && pair.outcome !== "still_fired" ? closed : pair;
      });
      return [
        {
          observationId: audit.id,
          actionId: action.id,
          status: actionStatus(list),
          pairs: list,
        },
      ];
    });
  });
}
