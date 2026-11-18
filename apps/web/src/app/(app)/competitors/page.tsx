import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ProjectScopeRequired } from "@/app/components/project-scope/project-scope-required";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { CmoProjectBanner } from "@/components/cmo-project-banner";
import { loadCompetitorsPage } from "./competitors-page-data";
import { CompetitorsCheckCard } from "./components/competitors-check-card";
import { CompetitorsFindings } from "./components/competitors-findings";
import { CompetitorsScoreboard } from "./components/competitors-scoreboard";
import { CompetitorsThisWeek } from "./components/competitors-this-week";
import { CompetitorsWatchList } from "./components/competitors-watch-list";

// Wait for the current session and project access before rendering.
export const instant = false;

interface CompetitorsPageProps {
  searchParams: Promise<{ projectId?: string | string[] }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Competitors");
  return { title: t("title") };
}

/**
 * A Project's competitors: who it watches, the weekly check, and what the
 * checks found. Competitors belong to one project, so the page reads
 * `?projectId=` like Ads and Social, and asks for a project without one.
 * A CMO Project shows here and is changed in CMO.
 */
export default async function CompetitorsPage({
  searchParams,
}: CompetitorsPageProps) {
  const t = await getTranslations("App.Competitors");
  const { projectId: raw } = await searchParams;
  const projectId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const page = projectId ? await loadCompetitorsPage(projectId) : null;

  if (!page) {
    return (
      <WorkspacePageShell title={t("title")}>
        <ProjectScopeRequired
          body={projectId ? t("pickUnavailable") : t("pickBody")}
          testId="competitors-no-project"
          title={t("pickTitle")}
        />
      </WorkspacePageShell>
    );
  }

  const { project, competitors } = page;
  const readOnly = project.cmo;

  return (
    <WorkspacePageShell title={t("title")}>
      <div className="flex flex-col gap-4">
        {readOnly ? <CmoProjectBanner projectId={project.id} /> : null}
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
            <CompetitorsThisWeek data={competitors} />
            <CompetitorsFindings data={competitors} />
            <CompetitorsScoreboard data={competitors} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <CompetitorsCheckCard
              check={competitors.check}
              competitorCount={competitors.competitors.length}
              projectId={project.id}
              readOnly={readOnly}
            />
            <CompetitorsWatchList
              competitors={competitors.competitors}
              limit={competitors.limit}
              projectId={project.id}
              readOnly={readOnly}
            />
          </div>
        </div>
      </div>
    </WorkspacePageShell>
  );
}
