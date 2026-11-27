import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";

import { issueKey, issueStates, type Selected } from "./project-seo-run-diff";

type Action = ProjectSeoWorkspace["actions"][number];

/** The checks that test the rules of a page. */
const PAGE_RULE_KINDS = new Set(["page_check", "audit_lite", "audit_full"]);

/** An issue a fix names: its `issueKey`, its check's rulebook, and the devices its rule failed on in that check. */
export interface SeoFixIssue {
  key: string;
  rulebook: PublicSeoPayload["rulebookVersion"];
  devices: string[];
}

/** A stored check a later fix result can come from. */
export interface SeoFixCheck {
  kind: string;
  observedAt: Date;
  payload: PublicSeoPayload;
}

/**
 * The issues a fix names in its own check. A finding without a device is open on every device a row of its rule fired
 * or failed on there; with no such row, no later check can answer it.
 */
export function seoFixIssues(
  payload: PublicSeoPayload,
  findings: Array<{ pageUrl: string; rowId: string; device: string | null }>,
  selected: Selected,
): SeoFixIssue[] {
  const states = issueStates(payload, selected);
  return findings.map((finding) => {
    const key = issueKey(payload, finding);
    const rulebook = payload.rulebookVersion;
    if (finding.device) return { key, rulebook, devices: [finding.device] };
    const devices = new Set<string>();
    for (const device of [
      ...(states.fired.get(key) ?? []),
      ...(states.failed.get(key) ?? []),
    ])
      if (device) devices.add(device);
    return { key, rulebook, devices: [...devices] };
  });
}

type Answer = { result: "failing" | "fixed"; at: Date } | undefined;

/**
 * Each fix with the result of its issues in the page checks after its own. For each issue and device the newest such
 * check that read the rule there decides: it failed, or it passed. A proposal fixed on every device leaves, as one an
 * exact later pass ends. `checks` holds the checks of the selected period.
 */
export function withSeoLastCheckResults(
  actions: Action[],
  checks: SeoFixCheck[],
  selected: Selected,
  workOf: (
    action: Action,
  ) => { issues: SeoFixIssue[]; observedAt: Date } | undefined,
) {
  const ruleChecks = checks
    .filter((check) => PAGE_RULE_KINDS.has(check.kind))
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  return actions.flatMap((action) => {
    const work = workOf(action);
    if (!work?.issues.length) return [action];
    const later = ruleChecks.filter(
      (check) => check.observedAt > work.observedAt,
    );
    const answer = ({ key, rulebook }: SeoFixIssue, device: string): Answer => {
      for (const check of later) {
        const states = issueStates(check.payload, selected);
        // A finding without a device fails the rule on every device.
        const failed = states.failed.get(key);
        if (failed?.has(device) || failed?.has(null))
          return { result: "failing", at: check.observedAt };
        // A pass ends a fix only under the rulebook that found the issue, as an exact later pass does.
        if (check.payload.rulebookVersion !== rulebook) continue;
        // A note without a device says the rule was read, not on which device: only a row or a note there counts.
        const passed = states.passed.get(key);
        if (
          passed?.has(device) ||
          passed?.has(null) ||
          states.noted.get(key)?.has(device)
        )
          return { result: "fixed", at: check.observedAt };
      }
      return undefined;
    };
    const answers = work.issues.flatMap((issue) =>
      issue.devices.length
        ? issue.devices.map((device) => answer(issue, device))
        : [undefined],
    );
    const failing = answers.filter((item) => item?.result === "failing");
    const deciding = failing.length
      ? failing
      : answers.every((item) => item?.result === "fixed")
        ? answers
        : [];
    if (!deciding.length) return [action];
    const result = deciding[0]!.result;
    if (result === "fixed" && action.status === "recommended") return [];
    const at = Math.max(...deciding.map((item) => item!.at.getTime()));
    return [
      {
        ...action,
        lastCheckResult: result,
        lastCheckAt: new Date(at).toISOString(),
      },
    ];
  });
}
