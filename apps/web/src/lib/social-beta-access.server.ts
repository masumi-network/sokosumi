import "server-only";

import { cache } from "react";

import { hasSocialBetaAccess } from "@/lib/beta-access";
import { userService } from "@/lib/services/user.service";

/** Ads-only beta access; Social scheduling and Calendar are public. */
export const hasCurrentUserSocialBetaAccess = cache(async () => {
  const memberships = await userService
    .getMyMembersWithOrganizations()
    .catch(() => []);

  return hasSocialBetaAccess(memberships);
});
