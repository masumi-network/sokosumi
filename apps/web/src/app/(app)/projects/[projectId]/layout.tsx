import type { Metadata } from "next";

import { RecordProjectVisit } from "./components/record-project-visit";
import { projectPageMetadata } from "./project-page-metadata";

/**
 * The project's name as the tab title for Overview and any page without a
 * title of its own; a section page adds its name in front.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  return projectPageMetadata(projectId);
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
