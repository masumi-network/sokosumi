import { readSeoStatisticsResponse } from "@/lib/seo/read-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  return readSeoStatisticsResponse(request, { kind: "audit", id: auditId });
}
