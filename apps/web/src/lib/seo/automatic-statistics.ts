import "server-only";

import { z } from "zod";
import { seoFilterQuerySchema } from "@/app/seo/seo-query";
import type { SeoOwner } from "@/lib/seo/owner";
import { readSeoResponse } from "@/lib/seo/read-response";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";

// Validate the proxy input shape. Core owns property, scope, period and permission validation.
const automaticSchema = z.object({
  ...seoFilterQuerySchema.shape,
  auditTaskId: z.never().optional(),
  provider: z.enum(["ga4", "search_console"]),
  propertyId: z.string(),
  pageId: z.never().optional(),
  pageIds: z.array(z.uuid()).optional(),
  expectedScopeVersion: z.number().int().positive().optional(),
  from: z.iso.date(),
  to: z.iso.date(),
  automatic: z.literal(true),
});

const inputSchema = z.union([
  automaticSchema,
  z
    .strictObject({
      auditTaskId: z.uuid(),
      includePropertyTotals: z.literal(true).optional(),
      includePageDiscovery: z.literal(true).optional(),
    })
    .refine(
      (input) => !input.includePageDiscovery || input.includePropertyTotals,
      "Page discovery requires property performance access",
    ),
]);

/** Background Google reads use HTTP so they cannot delay the user's Server Actions. */
export function ensureSeoStatisticsResponse(request: Request, owner: SeoOwner) {
  return readSeoResponse(request, owner, async () =>
    seoServiceNoRedirect.syncStatistics(
      owner,
      inputSchema.parse(await request.json()),
    ),
  );
}
