import type { ProjectSeoObservation } from "@sokosumi/database";
import {
  type PublicSeoPayload,
  publicSeoPayloadSchema,
} from "@/helpers/project-seo-report";
import { normalizeSeoUrl } from "./project-seo-store";

/** The newest of some days. */
export function latestDate(dates: Date[]): Date {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

/**
 * The check that confirms a completed Task fixed its action: for each finding, the first check in
 * `observations` order (newest first) after the Task completed that read the same row on the same
 * device, under the same rulebook. Every one must pass;
 * the day is the last of those checks. Null while any finding has no such pass.
 */
export function actionVerifiedAt(
  task: { status: string; completedAt: Date | null } | undefined,
  observations: ProjectSeoObservation[],
  source: PublicSeoPayload,
  action: PublicSeoPayload["actions"][number],
): Date | null {
  const completedAt = task?.completedAt;
  if (task?.status !== "COMPLETED" || !completedAt || !action.findingIds.length)
    return null;
  const passes: Date[] = [];
  for (const id of action.findingIds) {
    const finding = source.findings.find((item) => item.id === id);
    if (!finding?.device) return null;
    const pass = passAfter(observations, source, finding, completedAt);
    if (!pass) return null;
    passes.push(pass);
  }
  return latestDate(passes);
}

/** The day of the first check after `after` that read this finding's row, when it passed. */
function passAfter(
  observations: ProjectSeoObservation[],
  source: PublicSeoPayload,
  finding: PublicSeoPayload["findings"][number],
  after: Date,
): Date | null {
  for (const observation of observations) {
    if (
      observation.ownerId ||
      observation.kind === "metrics" ||
      observation.observedAt <= after ||
      observation.createdAt <= after
    )
      continue;
    const parsed = publicSeoPayloadSchema.safeParse(observation.payload);
    if (!parsed.success) continue;
    const data = parsed.data;
    if (
      data.countryCode !== source.countryCode ||
      data.languageCode !== source.languageCode ||
      data.rulebookVersion !== source.rulebookVersion
    )
      continue;
    const check = data.checks.find(
      (row) =>
        normalizeSeoUrl(row.pageUrl) === normalizeSeoUrl(finding.pageUrl) &&
        row.rowId === finding.rowId &&
        row.device === finding.device,
    );
    if (check) return check.result === "pass" ? observation.observedAt : null;
  }
  return null;
}
