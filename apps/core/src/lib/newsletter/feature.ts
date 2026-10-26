import type { Prisma } from "@sokosumi/database";
import { SOCIAL_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { notFound } from "@/helpers/error";

export const NEWSLETTER_BETA_SCOPE = {
  project: {
    workspace: { organization: { slug: SOCIAL_BETA_ORGANIZATION_SLUG } },
  },
} satisfies Prisma.NewsletterWhereInput;

export function isNewsletterEnabled(): boolean {
  return getEnv().NEWSLETTER_ENABLED;
}

export function assertNewsletterEnabled(): void {
  if (!isNewsletterEnabled()) {
    throw notFound("Newsletter is not enabled");
  }
}
