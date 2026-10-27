import { isIP } from "node:net";

import { allowNewsletterRequest } from "./request-limit";

export async function allowNewsletterSignup(
  newsletterId: string,
  request: Request,
): Promise<boolean> {
  const forwarded = (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")
  )
    ?.split(",")[0]
    ?.trim();
  const ip = forwarded && isIP(forwarded) ? forwarded : "unknown";
  return allowNewsletterRequest(`newsletter:signup:${newsletterId}:${ip}`, 10);
}
