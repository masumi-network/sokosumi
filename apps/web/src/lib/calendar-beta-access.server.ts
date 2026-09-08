import "server-only";

import { cache } from "react";

import { hasCalendarBetaAccess } from "@/lib/beta-access";
import { userService } from "@/lib/services";

export const hasCurrentUserCalendarBetaAccess = cache(async () => {
  const memberships = await userService
    .getMyMembersWithOrganizations()
    .catch(() => []);

  return hasCalendarBetaAccess(memberships);
});
