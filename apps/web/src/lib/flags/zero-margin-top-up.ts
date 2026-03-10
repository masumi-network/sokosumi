import "server-only";

import { flag } from "flags/next";

import { getSession } from "@/lib/auth/utils";
import {
  type CreditTopUpLookupKey,
  ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY,
} from "@/lib/stripe/credit-topup-pricing";
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

export function resolveZeroMarginTopUpLookupKey(
  email: string | null | undefined,
): CreditTopUpLookupKey | undefined {
  if (!email || !isZeroMarginTopUpDomain(email)) {
    return undefined;
  }

  return ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY;
}

export const zeroMarginTopUpEnabled = flag({
  key: "zero-margin-top-up-enabled",
  decide: async () => {
    const session = await getSession();
    return resolveZeroMarginTopUpLookupKey(session?.user?.email) !== undefined;
  },
});
