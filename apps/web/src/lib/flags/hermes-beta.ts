import { flag } from "flags/next";

import { getSession } from "@/lib/auth/utils";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";

export const hermesBetaEnabled = flag({
  key: "hermes-beta-enabled",
  decide: async () => {
    const session = await getSession();
    return isHermesBetaAccessEmail(session?.user?.email);
  },
});
