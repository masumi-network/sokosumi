import { RecordProjectVisit } from "./components/record-project-visit";

export default async function ProjectDetailLayout({
  children,
  modal,
  params,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <>
      <RecordProjectVisit key={projectId} projectId={projectId} />
      {children}
      {modal}
    </>
  );
}
