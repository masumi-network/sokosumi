import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ProjectScopeRequired } from "@/app/components/project-scope/project-scope-required";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { CmoProjectBanner } from "@/components/cmo-project-banner";
import { loadCompetitorsPage } from "./competitors-page-data";
import { CompetitorsCheckBar } from "./components/competitors-check-bar";
import { CompetitorsFindings } from "./components/competitors-findings";
import { CompetitorsScoreboard } from "./components/competitors-scoreboard";
import { CompetitorsStart } from "./components/competitors-start";
import { CompetitorsThisWeek } from "./components/competitors-this-week";
import { showsExample } from "./components/competitors-view";
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
 * A Project's competitors: what the weekly check found, who it watches, and
 * the check's switch in one line. Before anybody is watched it shows what the
 * check gives and one action, finding competitors. While Findings can only
 * show the example, Watching comes first, so the competitors just added are
 * not below the fold on a phone; on wide screens it stays on the right.
 * Competitors belong to one project, so the page reads `?projectId=` like
 * Ads and Social, and asks for a project without one.
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
  const watchingFirst = showsExample(competitors);
  const watchList = (
    <CompetitorsWatchList
      className={watchingFirst ? "xl:order-last" : undefined}
      competitors={competitors.competitors}
      limit={competitors.limit}
      projectId={project.id}
      projectName={project.name}
      readOnly={readOnly}
    />
  );

  return (
    <WorkspacePageShell title={t("title")}>
      <div className="flex flex-col gap-4">
        {readOnly ? <CmoProjectBanner projectId={project.id} /> : null}
        {competitors.competitors.length === 0 && !readOnly ? (
          <CompetitorsStart
            creditsPerCompetitor={competitors.check.creditsPerCompetitor}
            limit={competitors.limit}
            projectId={project.id}
            projectName={project.name}
          />
        ) : (
          <>
            <CompetitorsCheckBar
              check={competitors.check}
              competitorCount={competitors.competitors.length}
              projectId={project.id}
              readOnly={readOnly}
            />
            <div className="grid items-start gap-4 xl:grid-cols-3">
              {watchingFirst ? watchList : null}
              <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
                <CompetitorsThisWeek data={competitors} />
                <CompetitorsFindings data={competitors} />
                <CompetitorsScoreboard data={competitors} />
              </div>
              {watchingFirst ? null : watchList}
            </div>
          </>
        )}
      </div>
    </WorkspacePageShell>
  );
}
