import { dedupe } from "flags/next";

import { getSession } from "@/lib/auth/auth.server";

/**
 * Entities passed to Vercel Flags for dashboard targeting rules.
 * Keep attributes stable so rules in the Vercel Dashboard stay valid.
 */
export interface FlagEntities {
  user?: {
    id: string;
    email: string;
  };
  organization?: {
    id: string;
  };
}

/**
 * Resolve evaluation context once per request for all Vercel-backed flags.
 */
export const identify = dedupe(async (): Promise<FlagEntities> => {
  const session = await getSession();

  if (!session?.user) {
    return {};
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
    },
    organization: session.session.activeOrganizationId
      ? { id: session.session.activeOrganizationId }
      : undefined,
  };
});
