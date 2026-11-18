import { readSeoBriefSuggestionResponse } from "@/lib/seo/read-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  return readSeoBriefSuggestionResponse(request, {
    kind: "audit",
    id: auditId,
  });
}
