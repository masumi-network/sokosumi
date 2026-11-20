import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  ClipboardList,
  Gauge,
  Link2,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoResearchStatus } from "./seo-audit-coverage";
import { SeoDiscoveryActions } from "./seo-audit-discovery";
import { pageSpeedSummary, SeoPageSpeed } from "./seo-page-speed";
import {
  SEO_ROW_LIST_CLASS,
  SeoDate,
  SeoFoldSummary,
  SeoSection,
} from "./seo-shared";
import { SeoSiteEvidence } from "./seo-site-evidence";
import { lastAuditResearch } from "./seo-summary-model";

function ResearchRow({
  icon: Icon,
  title,
  summary,
  children,
}: {
  icon: LucideIcon;
  title: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <li>
      <details>
        <SeoFoldSummary className="min-h-12 gap-3 px-3 py-2 text-sm hover:bg-accent">
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col gap-x-3 sm:flex-row sm:items-baseline sm:justify-between">
            <span className="font-medium">{title}</span>
            <span className="line-clamp-2 min-w-0 break-words text-xs text-muted-foreground sm:max-w-3/5 sm:text-end">
              {summary}
            </span>
          </span>
        </SeoFoldSummary>
        <div className="min-w-0 space-y-2 border-t px-3 py-3 text-sm">
          {children}
        </div>
      </details>
    </li>
  );
}

export function SeoAuditResearch({
  workspace,
  discovery,
}: {
  workspace: ProjectSeoWorkspace;
  discovery?: NonNullable<
    ProjectSeoWorkspace["auditSearchConsole"]
  >[number]["discovery"];
}) {
  const t = useSeoResultTranslations("App.Seo");
  const audit = lastAuditResearch(workspace);
  const research = audit?.checklistBreakdown?.research;
  const full = workspace.observations.find((row) => row.kind === "audit_full");
  const speed = full?.pageSpeed;
  const site = workspace.siteEvidence;
  const consoleItems = discovery
    ? discovery.actions.length + discovery.changes.length
    : 0;
  if (!research?.length && !speed?.length && !site && !consoleItems)
    return null;
  const partial = research
    ?.flatMap((entry) => entry.stages)
    .find((stage) => stage.status === "partial");
  const dates = [
    audit?.observedAt,
    speed?.length ? full?.observedAt : null,
    site?.observedAt,
    consoleItems ? discovery?.checkedAt : null,
  ].flatMap((value) => (value ? [new Date(value).getTime()] : []));
  return (
    <SeoSection
      lang="en"
      title={t("summary.researchTitle")}
      actions={
        dates.length > 0 && (
          <span className="self-center text-xs text-muted-foreground">
            {t("research.latest")}{" "}
            <SeoDate report day value={new Date(Math.max(...dates))} />
          </span>
        )
      }
    >
      <ul className={SEO_ROW_LIST_CLASS}>
        {audit && research?.length ? (
          <ResearchRow
            icon={ClipboardList}
            title={t("research.checks")}
            summary={
              partial
                ? t("research.incomplete", {
                    stage: t(`summary.stage.${partial.name}`),
                  })
                : t("research.checkCount", {
                    count: research.reduce(
                      (count, row) => count + row.stages.length,
                      0,
                    ),
                  })
            }
          >
            <SeoResearchStatus data={research} observedAt={audit.observedAt} />
          </ResearchRow>
        ) : null}
        {full && speed?.length ? (
          <ResearchRow
            icon={Gauge}
            title={t("pageSpeed.title")}
            summary={pageSpeedSummary(speed, t)}
          >
            <SeoPageSpeed rows={speed} at={full.observedAt} />
          </ResearchRow>
        ) : null}
        {site && (
          <ResearchRow
            icon={Link2}
            title={t("siteEvidence.heading")}
            summary={
              site.coverage
                ? t("research.coverage", {
                    verified:
                      site.coverage.discovered - site.coverage.deferredCount,
                    total: site.coverage.discovered,
                    deferred: site.coverage.deferredCount,
                  })
                : t("research.targets", { count: site.targets.length })
            }
          >
            <SeoSiteEvidence evidence={site} />
          </ResearchRow>
        )}
        {discovery && consoleItems > 0 && (
          <ResearchRow
            icon={ListChecks}
            title={t("discovery.actionsHeading")}
            summary={
              consoleItems === 1
                ? discovery.actions[0]?.evidence ||
                  discovery.changes[0]?.text ||
                  discovery.actions[0]?.action
                : t("research.console", {
                    actions: discovery.actions.length,
                    changes: discovery.changes.length,
                  })
            }
          >
            <SeoDiscoveryActions evidence={discovery} />
          </ResearchRow>
        )}
      </ul>
    </SeoSection>
  );
}
