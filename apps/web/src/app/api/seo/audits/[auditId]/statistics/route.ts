import { ensureSeoStatisticsResponse } from "@/lib/seo/automatic-statistics";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  return ensureSeoStatisticsResponse(request, { kind: "audit", id: auditId });
}
