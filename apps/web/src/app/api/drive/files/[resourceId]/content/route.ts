import type { NextRequest } from "next/server";
import { proxyCoreFileContent } from "@/lib/clients/utils/proxy-core-file-content";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resourceId: string }> },
) {
  const { resourceId } = await params;
  const incoming = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams({
    scope: incoming.get("scope") ?? "me",
  });
  const organizationId = incoming.get("organizationId");
  if (organizationId) forwarded.set("organizationId", organizationId);
  if (incoming.get("download") === "true") forwarded.set("download", "true");

  return proxyCoreFileContent(
    request,
    `/drive/resources/${encodeURIComponent(resourceId)}/content?${forwarded.toString()}`,
  );
}
