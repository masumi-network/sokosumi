import "server-only";
import { z } from "zod";
import { SEO_SEARCH_TYPES } from "@/app/seo/components/seo-traffic-model";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";
import type { SeoOwner } from "./owner";
import { readSeoResponse } from "./read-response";

const query = z
  .object({
    scope: z.enum(["site", "selected"]),
    propertyId: z.string().min(1).max(500),
    pageIds: z.array(z.uuid()).min(1).max(10),
    from: z.iso.date(),
    to: z.iso.date(),
    searchType: z.enum(SEO_SEARCH_TYPES),
  })
  .strict();
export function seoSiteTrafficResponse(request: Request, owner: SeoOwner) {
  return readSeoResponse(request, owner, async () =>
    seoServiceNoRedirect.siteTraffic(owner, query.parse(await request.json())),
  );
}
