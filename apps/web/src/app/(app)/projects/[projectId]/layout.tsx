import type { Metadata } from "next";

import { RecordProjectVisit } from "./components/record-project-visit";
import { loadProjectOverviewData } from "./project-overview-data";

/**
 * The project's name as the tab title on every project page; a page with
 * its own title, such as Edit, keeps it. The route announcer reads the
 * title out after each navigation. Same private-cached read as Overview.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  const data = await loadProjectOverviewData(projectId);
  return data ? { title: data.project.name } : {};
}

export default async function ProjectDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <>
      <RecordProjectVisit key={projectId} projectId={projectId} />
      {children}
    </>
  );
}
