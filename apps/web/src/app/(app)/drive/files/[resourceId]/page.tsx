import { connection } from "next/server";
import { Suspense } from "react";
import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
import { FileDetailClient } from "@/app/drive/files/[resourceId]/file-detail-client";

interface FileDetailPageProps {
  params: Promise<{ resourceId: string }>;
}

async function FileDetailContent({ params }: FileDetailPageProps) {
  // Defer before any cookies()/headers()-bound work so PPR shell probing does
  // not soft-reject dynamic APIs while filling this Suspense hole.
  await connection();
  const { resourceId } = await params;
  return <FileDetailClient resourceId={resourceId} />;
}

/**
 * The shell reads nothing from the URL: the resource id is handed to a
 * Suspense-wrapped child, so navigating between two files renders the shell
 * instantly instead of blocking on the route params.
 */
export default function FileDetailPage({ params }: FileDetailPageProps) {
  return (
    <Suspense fallback={<DriveListSkeleton viewMode="list" />}>
      <FileDetailContent params={params} />
    </Suspense>
  );
}
