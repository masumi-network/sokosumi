import { getProviderData } from "@flags-sdk/vercel";
import { createFlagsDiscoveryEndpoint } from "flags/next";

import { hermesBetaEnabled } from "@/lib/flags/hermes-beta";

/**
 * Flags Explorer discovery endpoint for the Vercel Toolbar.
 * Requires FLAGS_SECRET (pull with `vercel env pull`).
 */
export const GET = createFlagsDiscoveryEndpoint(async () => {
  return getProviderData({ hermesBetaEnabled });
});
