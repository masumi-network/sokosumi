import "server-only";

import { flag } from "flags/next";

import { getSession } from "@/lib/auth/utils";
import { getEmailDomain } from "@/lib/utils/email";

const ZERO_MARGIN_TOP_UP_DOMAINS = new Set([
  "house-of-communication.com",
  "masumi.network",
  "nmkr.io",
]);

function isZeroMarginTopUpDomain(email: string): boolean {
  const domain = getEmailDomain(email);
  return domain !== null && ZERO_MARGIN_TOP_UP_DOMAINS.has(domain);
}

export const zeroMarginTopUpEnabled = flag({
  key: "zero-margin-top-up-enabled",
  decide: async () => {
    const session = await getSession();
    const email = session?.user?.email;

    if (!email) {
      return false;
    }

    return isZeroMarginTopUpDomain(email);
  },
});
