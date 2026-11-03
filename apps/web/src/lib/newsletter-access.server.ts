import "server-only";

import { cache } from "react";

import { newsletterService } from "@/lib/services/newsletter.service";

/** A failed availability read must not prevent the app chrome from rendering. */
export const isNewsletterEnabled = cache(() =>
  newsletterService.isEnabled().catch(() => false),
);
