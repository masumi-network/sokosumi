import type { ProjectSeoObservation } from "@sokosumi/database";
import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import type { SeoStrategyPayload } from "@/schemas/project-seo-strategy.schema";
import { normalizeSeoUrl } from "./project-seo-store";

export function projectSiteStrategy(
  strategy: SeoStrategyPayload,
  data: Pick<PublicSeoPayload, "pageUrls" | "countryCode" | "languageCode">,
  row: Pick<ProjectSeoObservation, "id" | "observedAt">,
  selectedUrls: ReadonlySet<string>,
  recoveryFileId: string | null,
): NonNullable<ProjectSeoWorkspace["strategy"]> {
  const {
    markets,
    marketNote,
    purposeOpportunity,
    demandByIntent,
    missingDemandByIntent,
    ...site
  } = strategy;
  const groups = site.groups.filter(
    (group) =>
      !group.pageUrl || selectedUrls.has(normalizeSeoUrl(group.pageUrl)),
  );
  const wholeReport = data.pageUrls.every((url) =>
    selectedUrls.has(normalizeSeoUrl(url)),
  );
  return {
    ...site,
    ...(wholeReport && markets && { markets }),
    ...(wholeReport && marketNote && { marketNote }),
    ...(wholeReport &&
      !markets &&
      !marketNote &&
      recoveryFileId && { marketRecoveryFileId: recoveryFileId }),
    groups,
    ...(purposeOpportunity &&
      selectedUrls.has(purposeOpportunity.pageUrl) &&
      groups.some(
        (group) =>
          group.pageUrl &&
          normalizeSeoUrl(group.pageUrl) === purposeOpportunity.pageUrl &&
          group.lead === purposeOpportunity.keyword &&
          group.reach === purposeOpportunity.reach,
      ) && { purposeOpportunity }),
    ...(wholeReport && demandByIntent && { demandByIntent }),
    ...(wholeReport && missingDemandByIntent && { missingDemandByIntent }),
    observationId: row.id,
    observedAt: row.observedAt.toISOString(),
    countryCode: data.countryCode || null,
    languageCode: data.languageCode || null,
  };
}
