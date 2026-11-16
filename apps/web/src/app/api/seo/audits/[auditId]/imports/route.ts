import { readSeoImportsResponse } from "@/lib/seo/read-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  return readSeoImportsResponse(request, { kind: "audit", id: auditId });
}
