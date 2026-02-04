import "server-only";

import { flag } from "flags/next";

import { getSession } from "@/lib/auth/utils";
import { getEmailDomain } from "@/lib/utils/email";

const CHAT_DOMAIN = "nmkr.io";

function isChatDomain(email: string): boolean {
  return getEmailDomain(email) === CHAT_DOMAIN;
}

export const chatUIEnabled = flag({
  key: "chat-ui",
  decide: async () => {
    const session = await getSession();
    if (!session?.user?.email) {
      return false;
    }
    return isChatDomain(session.user.email);
  },
});
