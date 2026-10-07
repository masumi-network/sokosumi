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
    utmMedium: body.utm_medium,
    utmCampaign: body.utm_campaign,
    utmTerm: body.utm_term,
    utmContent: body.utm_content,
    referrer: body.referrer,
    landingPage: body.landingPage,
    capturedAt: new Date(body.capturedAt),
    convertedAt: new Date(),
  };

  return tx.uTMAttribution.upsert({
    where: { userId },
    create: { user: { connect: { id: userId } }, ...data },
    update: data,
  });
}
