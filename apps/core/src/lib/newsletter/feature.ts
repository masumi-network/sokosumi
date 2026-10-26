import { getEnv } from "@/config/env";
import { notFound } from "@/helpers/error";

export function isNewsletterEnabled(): boolean {
  return getEnv().NEWSLETTER_ENABLED;
}

export function assertNewsletterEnabled(): void {
  if (!isNewsletterEnabled()) {
    throw notFound("Newsletter is not enabled");
  }
}
