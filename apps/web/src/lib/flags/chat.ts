import "server-only";

import { flag } from "flags/next";

import { getSession } from "@/lib/auth/utils";
import { getEmailDomain } from "@/lib/utils/email";

const CHAT_DOMAINS = new Set(["nmkr.io", "house-of-communication.com"]);
const CHAT_EMAIL_ALLOWLIST = new Set(["thinkngrowcrypto@gmail.com"]);

function isChatDomain(email: string): boolean {
  const domain = getEmailDomain(email);
  return domain !== null && CHAT_DOMAINS.has(domain);
}

function isChatEmailAllowlisted(email: string): boolean {
  return CHAT_EMAIL_ALLOWLIST.has(email.toLowerCase());
}

export const chatUIEnabled = flag({
  key: "chat-ui",
  decide: async () => {
    const session = await getSession();
    if (!session?.user?.email) {
      return false;
    }
    const email = session.user.email;
    return isChatDomain(email) || isChatEmailAllowlisted(email);
  },
});
