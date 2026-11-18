import { readSeoResponse } from "@/lib/seo/read-response";
import { seoBriefService } from "@/lib/services/seo-brief.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  const owner = { kind: "audit" as const, id: auditId };
  return readSeoResponse(request, owner, () => seoBriefService.read(owner));
}
