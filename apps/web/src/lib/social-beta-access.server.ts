import "server-only";

import { cache } from "react";

import { hasSocialBetaAccess } from "@/lib/beta-access";
import { userService } from "@/lib/services/user.service";

/** Social is still limited to the beta workspace; Calendar is open to all. */
export const hasCurrentUserSocialBetaAccess = cache(async () => {
  const memberships = await userService
    .getMyMembersWithOrganizations()
    .catch(() => []);

  return hasSocialBetaAccess(memberships);
});
