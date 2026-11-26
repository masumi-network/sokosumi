import { RecordProjectVisit } from "./components/record-project-visit";

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
