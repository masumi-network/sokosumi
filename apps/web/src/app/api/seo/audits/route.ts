import { readSeoAuditListResponse } from "@/lib/seo/read-response";

export function GET(request: Request) {
  return readSeoAuditListResponse(request);
}
