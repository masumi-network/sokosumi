import type { NewsletterSendingDomainStatus } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { getBetterAuthPublicBaseUrl, getEnv } from "@/config/env";
import { conflict, serviceUnavailable } from "@/helpers/error";

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

export interface NewsletterSendingDomainSender {
  fromAddress: string;
  status: NewsletterSendingDomainStatus;
}

export const NEWSLETTER_SENDER_NOT_CONFIGURED_MESSAGE =
  "Connect a sending domain in Newsletter settings before sending";

/**
 * The project's own address once Resend verifies it. Until then the shared
 * `NEWSLETTER_FROM_DOMAIN`, sent "via Sokosumi". Never the transactional
 * sender: with neither, sending is refused.
 */
export function newsletterSenderMailbox(
  sendingDomain: NewsletterSendingDomainSender | null,
): { address: string; viaSokosumi: boolean } {
  if (sendingDomain?.status === "VERIFIED") {
    return { address: sendingDomain.fromAddress, viaSokosumi: false };
  }
  const domain = getEnv().NEWSLETTER_FROM_DOMAIN;
  if (!domain) {
    throw conflict(NEWSLETTER_SENDER_NOT_CONFIGURED_MESSAGE, {
      kind: CORE_API_ERROR_KINDS.NEWSLETTER_SENDER_NOT_CONFIGURED,
    });
  }
  return { address: `newsletter@${domain}`, viaSokosumi: true };
}

export function newsletterSenderOptions(
  newsletter: { senderName: string; replyTo: string },
  sendingDomain: NewsletterSendingDomainSender | null,
) {
  const { address, viaSokosumi } = newsletterSenderMailbox(sendingDomain);
  const name = viaSokosumi
    ? `${newsletter.senderName} via Sokosumi`
    : newsletter.senderName;
  return {
    from: `"${name.replace(/["\\\r\n]/g, " ")}" <${address}>`,
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
