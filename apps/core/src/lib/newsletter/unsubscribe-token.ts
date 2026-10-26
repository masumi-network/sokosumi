import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { badRequest } from "@/helpers/error";

interface NewsletterUnsubscribeClaims {
  newsletterId: string;
  subscriberId: string;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update("newsletter-unsubscribe\0")
    .update(payload)
    .digest("base64url");
}

export function signNewsletterUnsubscribeToken(
  claims: NewsletterUnsubscribeClaims,
  secret: string,
): string {
  const payload = `v1.${claims.newsletterId}.${claims.subscriberId}`;
  return `${payload}.${signature(payload, secret)}`;
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
  const expected = signature(`v1.${newsletterId}.${subscriberId}`, secret);
  const actualBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    throw badRequest("Invalid unsubscribe token");
  }
  return { newsletterId: newsletterId!, subscriberId: subscriberId! };
}
