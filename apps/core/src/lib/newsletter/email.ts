import { getBetterAuthPublicBaseUrl, getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";

import { signNewsletterUnsubscribeToken } from "./unsubscribe-token";

export function newsletterPublicUrl(action: "confirm" | "unsubscribe"): URL {
  const url = new URL(
    `/v1/public/newsletter/${action}`,
    getBetterAuthPublicBaseUrl(),
  );
  if (url.protocol !== "https:") {
    throw serviceUnavailable(
      "Newsletter links require a public HTTPS Core URL",
    );
  }
  return url;
}

export function newsletterSenderOptions(newsletter: {
  senderName: string;
  replyTo: string;
}) {
  const domain = getEnv().NEWSLETTER_FROM_DOMAIN;
  if (!domain) {
    throw serviceUnavailable(
      "NEWSLETTER_FROM_DOMAIN is required to send newsletters",
    );
  }
  return {
    from: `"${newsletter.senderName.replace(/["\\\r\n]/g, " ")}" <newsletter@${domain}>`,
    replyTo: newsletter.replyTo,
  };
}

export function newsletterUnsubscribeOptions(claims: {
  newsletterId: string;
  subscriberId: string;
}) {
  const url = newsletterPublicUrl("unsubscribe");
  url.searchParams.set(
    "token",
    signNewsletterUnsubscribeToken(claims, getEnv().BETTER_AUTH_SECRET),
  );
  return {
    unsubscribeUrl: url.href,
    headers: {
      "List-Unsubscribe": `<${url.href}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
