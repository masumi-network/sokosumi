import "server-only";

import { flag } from "flags/next";
import { getSession } from "@/lib/auth/auth.server";
import {
  type CreditTopUpLookupKey,
  ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY,
} from "@/lib/stripe/credit-topup-pricing";
import { getEmailDomain } from "../utils";

const ZERO_MARGIN_TOP_UP_DOMAINS = new Set([
  "aladin-freelance.com",
  "almamedia.es",
  "almamediaplus.es",
  "avl-se.com",
  "avlberlin.com",
  "bauerserviceplan-external.com",
  "bauerserviceplan.com",
  "beck-health.com",
  "beckco.at",
  "beckco.de",
  "beckhealth.de",
  "best-brands.it",
  "brand-sponsoring.de",
  "brandpr.de",
  "casadellacomunicazione.it",
  "changeserviceplan.pl",
  "equmedia.es",
  "facit-digital.com",
  "facit-digital.de",
  "facit-group.com",
  "fmmc.com",
  "getlouder.pl",
  "gong.pl",
  "gonzales.be",
  "groupone.com.pl",
  "groupone.pl",
  "haus-der-kommunikation.at",
  "haus-der-kommunikation.de",
  "hmmh.de",
  "hoc-france.sip1.openvno.net",
  "hoc-france.sip2.openvno.net",
  "hoc-france.sip3.openvno.net",
  "house-of-communication-external.com",
  "house-of-communication.com",
  "innovationstag.de",
  "linkingbrands.com",
  "liquidcampaign.com",
  "masumi.network",
  "media-plus-crm.de",
  "mediaplus-crm.de",
  "mediaplus-czech.com",
  "mediaplus-external.com",
  "mediaplus-group.com",
  "mediaplus.at",
  "mediaplus.be",
  "mediaplus.com",
  "mediaplus.de",
  "mediaplus.pl",
  "mediaready.pl",
  "mediascale-external.de",
  "mediascale.de",
  "mediascale.eu",
  "mediaservicegmbh.de",
  "mediasyst.de",
  "mediateam360.de",
  "mediaxplain.nl",
  "namoto-films.com",
  "nayokimediaplus.com",
  "neverest-group-external.com",
  "neverest-group.com",
  "neverest.be",
  "neverest.de",
  "neverest.it",
  "nmkr.io",
  "pereiraodell.com",
  "plan-net-external.com",
  "plan-net-group.com",
  "plan-net.ae",
  "plan-net.at",
  "plan-net.be",
  "plan-net.ch",
  "plan-net.com",
  "plan-net.de",
  "pnsuisse.ch",
  "programmatic-exchange.com",
  "publips-serviceplan.es",
  "saint-elmos-external.com",
  "saint-elmos.com",
  "saint-elmos.de",
  "serviceplan-external.com",
  "serviceplan-group.it",
  "serviceplan-health.com",
  "serviceplan-solutions.com",
  "serviceplan-vital.de",
  "serviceplan.at",
  "serviceplan.ch",
  "serviceplan.com",
  "serviceplan.com.ua",
  "serviceplan.de",
  "serviceplangroup.mail.onmicrosoft.com",
  "serviceplangroup.onmicrosoft.com",
  "tacsy.tv",
  "team4tourism.at",
  "tourismusmarketing-external.com",
  "tourismusmarketing.com",
  "ueberlab.de",
  "webrand.space",
  "webuy.de",
  "weframediaplus.com",
  "wiennord.at",
  "wisecrackers.nl",
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
