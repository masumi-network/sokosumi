import { ensureSeoStatisticsResponse } from "@/lib/seo/automatic-statistics";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  return ensureSeoStatisticsResponse(request, {
    kind: "project",
    id: projectId,
  });
}
