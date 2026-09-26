import { connection } from "next/server";

import { FileDetailClient } from "@/app/drive/files/[resourceId]/file-detail-client";

export default async function FileDetailPage({
  params,
}: {
  params: Promise<{ resourceId: string }>;
}) {
  // Defer before session-bound work so PPR shell probing does not soft-reject
  // dynamic APIs while filling this route, matching /drive.
  await connection();
  const { resourceId } = await params;
  return <FileDetailClient resourceId={resourceId} />;
}
