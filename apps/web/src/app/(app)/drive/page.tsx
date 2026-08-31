import { connection } from "next/server";

import { DrivePageClient } from "@/app/drive/drive-page-client";
import { getDefaultFilesViewMode } from "@/lib/ui-preferences/files-view-mode.server";

export default async function DrivePage() {
  // Defer before cookies()-bound work so PPR shell probing does not
  // soft-reject dynamic APIs while filling this route.
  await connection();
  const defaultFilesViewMode = await getDefaultFilesViewMode();
  return <DrivePageClient defaultFilesViewMode={defaultFilesViewMode} />;
}
