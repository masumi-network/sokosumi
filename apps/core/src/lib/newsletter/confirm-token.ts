import { z } from "zod";

import { badRequest } from "@/helpers/error";

import {
  newsletterTokenSignature,
  verifyNewsletterTokenSignature,
} from "./token";

interface NewsletterConfirmClaims {
  newsletterId: string;
  subscriberId: string;
  consentAt: number;
}

const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60_000;

export function signNewsletterConfirmToken(
  claims: NewsletterConfirmClaims,
  secret: string,
): string {
  const expiresAt = Date.now() + TOKEN_LIFETIME_MS;
  const payload = `v1.${claims.newsletterId}.${claims.subscriberId}.${claims.consentAt}.${expiresAt}`;
  return `${payload}.${newsletterTokenSignature(payload, "confirm", secret)}`;
}

export function verifyNewsletterConfirmToken(
  token: string,
  secret: string,
): NewsletterConfirmClaims {
  const [
    version,
    newsletterId,
    subscriberId,
    consent,
    expiry,
    given,
    ...extra
  ] = token.split(".");
  const consentAt = Number(consent);
  const expiresAt = Number(expiry);
  if (
    token.length > 512 ||
    version !== "v1" ||
    !given ||
    extra.length ||
    !z.uuid().safeParse(newsletterId).success ||
    !z.uuid().safeParse(subscriberId).success ||
    !/^\d+$/.test(consent ?? "") ||
    !/^\d+$/.test(expiry ?? "") ||
    !Number.isSafeInteger(consentAt) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    !verifyNewsletterTokenSignature(
      `v1.${newsletterId}.${subscriberId}.${consent}.${expiry}`,
      given,
      "confirm",
      secret,
    )
  ) {
    throw badRequest("Invalid or expired confirmation token");
  }
  return {
    newsletterId: newsletterId!,
    subscriberId: subscriberId!,
    consentAt,
  };
}
