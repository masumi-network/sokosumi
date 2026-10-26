import { z } from "zod";

import { badRequest } from "@/helpers/error";

import {
  newsletterTokenSignature,
  verifyNewsletterTokenSignature,
} from "./token";

interface NewsletterUnsubscribeClaims {
  newsletterId: string;
  subscriberId: string;
}

export function signNewsletterUnsubscribeToken(
  claims: NewsletterUnsubscribeClaims,
  secret: string,
): string {
  const payload = `v1.${claims.newsletterId}.${claims.subscriberId}`;
  return `${payload}.${newsletterTokenSignature(payload, "unsubscribe", secret)}`;
}

export function verifyNewsletterUnsubscribeToken(
  token: string,
  secret: string,
): NewsletterUnsubscribeClaims {
  const [version, newsletterId, subscriberId, given, ...extra] =
    token.split(".");
  if (
    token.length > 512 ||
    version !== "v1" ||
    !given ||
    extra.length ||
    !z.uuid().safeParse(newsletterId).success ||
    !z.uuid().safeParse(subscriberId).success
  ) {
    throw badRequest("Invalid unsubscribe token");
  }
  if (
    !verifyNewsletterTokenSignature(
      `v1.${newsletterId}.${subscriberId}`,
      given,
      "unsubscribe",
      secret,
    )
  ) {
    throw badRequest("Invalid unsubscribe token");
  }
  return { newsletterId: newsletterId!, subscriberId: subscriberId! };
}
