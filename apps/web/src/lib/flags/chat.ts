import "server-only";

import { flag } from "flags/next";

import { getSession } from "@/lib/auth/utils";
import { getEmailDomain } from "@/lib/utils/email";

const CHAT_DOMAIN = "nmkr.io";
const CHAT_EMAIL_ALLOWLIST = new Set(["s.kuepers@house-of-communication.com"]);

function isChatDomain(email: string): boolean {
  return getEmailDomain(email) === CHAT_DOMAIN;
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
