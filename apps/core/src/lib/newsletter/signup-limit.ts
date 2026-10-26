import { isIP } from "node:net";

import { allowNewsletterRequest } from "./request-limit";

/**
 * Ten confirmation requests per newsletter in a window, counted per client
 * IP, or per Soko Bot when a bot adds people on its owner's word.
 */
export async function allowNewsletterSignup(
  newsletterId: string,
  requester: Request | { sokoBotId: string },
): Promise<boolean> {
  if (!(requester instanceof Request))
    return allowNewsletterRequest(
      `newsletter:signup:${newsletterId}:soko-bot:${requester.sokoBotId}`,
      10,
    );
  const forwarded = (
    requester.headers.get("x-vercel-forwarded-for") ??
    requester.headers.get("x-forwarded-for")
  )
    ?.split(",")[0]
    ?.trim();
  const ip = forwarded && isIP(forwarded) ? forwarded : "unknown";
  return allowNewsletterRequest(`newsletter:signup:${newsletterId}:${ip}`, 10);
}
