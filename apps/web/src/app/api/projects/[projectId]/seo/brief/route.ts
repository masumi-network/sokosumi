import { readSeoResponse } from "@/lib/seo/read-response";
import { seoBriefService } from "@/lib/services/seo-brief.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const owner = { kind: "project" as const, id: projectId };
  return readSeoResponse(request, owner, () => seoBriefService.read(owner));
}
