import type { ProjectSeoObservation } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import type { z } from "zod";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import prisma from "@/lib/db/prisma";
import type { SeoActor, SeoWorkspaceQuery } from "@/schemas/project-seo.schema";
import { matchesSeoPeriod, SEO_RESULT_LIMIT } from "./project-seo-store";
import type { SeoAuditDecisions } from "./seo-audit-decisions";

const decisionFields = publicSeoPayloadSchema.in.pick({
  kind: true,
  pageUrls: true,
  countryCode: true,
  languageCode: true,
  rulebookVersion: true,
  reviewSources: true,
  seasonalIdeas: true,
  strategyDecisions: true,
  decisionSources: true,
  articleDates: true,
  topicLaunches: true,
});
export type DecisionPayload = z.infer<typeof decisionFields>;
export type DecisionObservation = Pick<
  ProjectSeoObservation,
  | "id"
  | "createdAt"
  | "observedAt"
  | "projectId"
  | "auditId"
  | "ownerId"
  | "scopeVersion"
  | "pageIds"
  | "payload"
> & { continuousSince?: Date | null };
const byTime = (a: DecisionObservation, b: DecisionObservation) =>
  b.observedAt.getTime() - a.observedAt.getTime() ||
  b.createdAt.getTime() - a.createdAt.getTime() ||
  b.id.localeCompare(a.id);

/** Only the decision evidence leaves PostgreSQL. Each arm has its own cap, so a busy audit feed cannot evict tracked recommendations. */
export async function loadSeoReviewHistory(
  actor: SeoActor,
  pageIds: string[],
  query: SeoWorkspaceQuery,
  visible: ProjectSeoObservation[],
  trackedOriginIds: string[],
): Promise<DecisionObservation[]> {
  if (!pageIds.length) return [];
  const owner =
    actor.owner.kind === "audit"
      ? PrismaRaw.sql`o."auditId"=${actor.owner.id}::uuid AND o."projectId" IS NULL`
      : PrismaRaw.sql`o."projectId"=${actor.owner.id}::uuid AND o."auditId" IS NULL`;
  const end = query.to
    ? PrismaRaw.sql`AND o."observedAt" <= ${new Date(query.to + "T23:59:59.999Z")}`
    : PrismaRaw.empty;
  const fields = Object.keys(decisionFields.shape);
  const seen = visible.filter((o) => o.kind === "audit_full").map((o) => o.id);
  return prisma.$queryRaw<DecisionObservation[]>`
    WITH eligible AS NOT MATERIALIZED (
      SELECT o.id,o."observedAt",o."createdAt" FROM project_seo_observation o
      WHERE ${owner} AND o."ownerId" IS NULL AND o.kind='audit_full'
        AND o."pageIds" && ${pageIds}::uuid[] AND o.payload->'reviewSources'->0 IS NOT NULL ${end}
    ), recent_candidates AS (
      SELECT * FROM eligible ORDER BY "observedAt" DESC,"createdAt" DESC,id DESC LIMIT ${SEO_RESULT_LIMIT + 1}
    ), recent AS (
      SELECT * FROM recent_candidates ORDER BY "observedAt" DESC,"createdAt" DESC,id DESC LIMIT ${SEO_RESULT_LIMIT}
    ), tracked AS (
      SELECT id FROM eligible WHERE id=ANY(${trackedOriginIds}::uuid[])
      ORDER BY "observedAt" DESC,"createdAt" DESC,id DESC LIMIT ${SEO_RESULT_LIMIT}
    )
    SELECT o.id,o."projectId",o."auditId",o."ownerId",o."scopeVersion",o."pageIds",o."observedAt",o."createdAt",
      CASE WHEN (SELECT count(*) FROM recent_candidates) > ${SEO_RESULT_LIMIT} THEN (SELECT min("observedAt") FROM recent) END AS "continuousSince",
      (SELECT jsonb_object_agg(field,o.payload->field) FROM unnest(${fields}::text[]) AS k(field) WHERE o.payload ? field) AS payload
    FROM project_seo_observation o JOIN (SELECT id FROM recent UNION SELECT id FROM tracked) chosen USING (id)
    WHERE NOT (o.id=ANY(${seen}::uuid[]))`;
}

export function projectSeoReviewHistory(
  decisions: SeoAuditDecisions,
  input: {
    observations: ProjectSeoObservation[];
    reviewHistory?: DecisionObservation[];
    query: SeoWorkspaceQuery;
  },
  selected: Set<string>,
) {
  const visible = input.observations.filter(
    (row) =>
      row.kind === "audit_full" &&
      row.ownerId === null &&
      row.pageIds.some((id) => selected.has(id)),
  );
  const feedIds = new Set(visible.map((row) => row.id));
  const rows = [
    ...visible,
    ...(input.reviewHistory ?? []).filter(
      (row) =>
        !feedIds.has(row.id) &&
        row.ownerId === null &&
        row.pageIds.some((id) => selected.has(id)),
    ),
  ].sort(byTime);
  for (const row of rows) {
    if (
      input.query.to &&
      row.observedAt.toISOString().slice(0, 10) > input.query.to
    )
      continue;
    const parsed = decisionFields.safeParse(row.payload);
    if (parsed.success && parsed.data.kind === "audit_full")
      decisions.append(
        row,
        parsed.data,
        matchesSeoPeriod(row.observedAt, input.query),
        feedIds.has(row.id),
      );
  }
}
