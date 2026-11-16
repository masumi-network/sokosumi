import { readSeoWorkspaceResponse } from "@/lib/seo/read-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  return readSeoWorkspaceResponse(request, { kind: "audit", id: auditId });
}
