import { seoSiteTrafficResponse } from "@/lib/seo/site-traffic-response";
export const maxDuration = 300;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return seoSiteTrafficResponse(request, {
    kind: "project",
    id: (await params).projectId,
  });
}
