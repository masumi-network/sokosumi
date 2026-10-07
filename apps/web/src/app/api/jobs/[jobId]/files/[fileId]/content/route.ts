import type { NextRequest } from "next/server";
import { proxyCoreFileContent } from "@/lib/clients/utils/proxy-core-file-content";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; fileId: string }> },
) {
  const { jobId, fileId } = await params;
  const query =
    request.nextUrl.searchParams.get("download") === "true"
      ? "?download=true"
      : "";
  return proxyCoreFileContent(
    request,
    `/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}/content${query}`,
  );
}
