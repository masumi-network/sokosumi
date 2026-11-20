import { seoSiteTrafficResponse } from "@/lib/seo/site-traffic-response";
export const maxDuration = 300;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  return seoSiteTrafficResponse(request, {
    kind: "audit",
    id: (await params).auditId,
  });
}
