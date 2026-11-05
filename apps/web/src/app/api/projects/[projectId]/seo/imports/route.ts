import { readSeoImportsResponse } from "@/lib/seo/read-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  return readSeoImportsResponse(request, { kind: "project", id: projectId });
}
