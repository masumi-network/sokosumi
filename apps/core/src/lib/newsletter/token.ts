import { createHmac, timingSafeEqual } from "node:crypto";

type NewsletterTokenPurpose = "confirm" | "unsubscribe";

export function newsletterTokenSignature(
  payload: string,
  purpose: NewsletterTokenPurpose,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`newsletter-${purpose}\0`)
    .update(payload)
    .digest("base64url");
}

export function verifyNewsletterTokenSignature(
  payload: string,
  given: string,
  purpose: NewsletterTokenPurpose,
  secret: string,
): boolean {
  const actualBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(
    newsletterTokenSignature(payload, purpose, secret),
  );
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
