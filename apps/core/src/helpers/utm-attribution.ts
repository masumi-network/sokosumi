import type { Prisma } from "@sokosumi/database";
import type { z } from "zod";

import prisma from "@/lib/db/prisma";
import type { utmAttributionRequestSchema } from "@/schemas/user.schema";

export function recordUtmAttribution(
  userId: string,
  body: z.infer<typeof utmAttributionRequestSchema>,
  tx: Pick<Prisma.TransactionClient, "uTMAttribution"> = prisma,
) {
  const data = {
    utmSource: body.utm_source,
    ...(body.utm_medium !== undefined && { utmMedium: body.utm_medium }),
    ...(body.utm_campaign !== undefined && { utmCampaign: body.utm_campaign }),
    ...(body.utm_term !== undefined && { utmTerm: body.utm_term }),
    ...(body.utm_content !== undefined && { utmContent: body.utm_content }),
    ...(body.referrer !== undefined && { referrer: body.referrer }),
    ...(body.landingPage !== undefined && { landingPage: body.landingPage }),
    capturedAt: new Date(body.capturedAt),
    convertedAt: new Date(),
  };

  return tx.uTMAttribution.upsert({
    where: { userId },
    create: { user: { connect: { id: userId } }, ...data },
    update: data,
  });
}
