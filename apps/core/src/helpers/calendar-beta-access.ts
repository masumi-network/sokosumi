import type { Prisma } from "@sokosumi/database";
import { CALENDAR_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";

import { forbidden } from "@/helpers/error";

type CalendarBetaAccessClient = Pick<Prisma.TransactionClient, "member">;

export const CALENDAR_BETA_USER_WHERE = {
  members: {
    some: { organization: { slug: CALENDAR_BETA_ORGANIZATION_SLUG } },
  },
} satisfies Prisma.UserWhereInput;

export async function hasCalendarBetaAccess(
  userId: string,
  tx: CalendarBetaAccessClient,
): Promise<boolean> {
  const member = await tx.member.findFirst({
    where: {
      userId,
      organization: { slug: CALENDAR_BETA_ORGANIZATION_SLUG },
    },
    select: { id: true },
  });

  return member != null;
}

export async function requireCalendarBetaAccess(
  userId: string,
  tx: CalendarBetaAccessClient,
): Promise<void> {
  if (!(await hasCalendarBetaAccess(userId, tx))) {
    throw forbidden("Calendar is only available to utxo AG workspace members");
  }
}
