import "server-only";

import { flag } from "flags/next";

import { getSession } from "@/lib/auth/utils";
import { getEmailDomain } from "@/lib/utils/email";

const NEW_CHAT_EXPERIMENTAL_DOMAIN = "nmkr.io";

export function isNewChatExperimentalAllowedEmail(
  email: string | null | undefined,
): boolean {
  if (!email) {
    return false;
  }
  const domain = getEmailDomain(email);
  return domain === NEW_CHAT_EXPERIMENTAL_DOMAIN;
}

export const newChatExperimentalEnabled = flag({
  key: "new-chat-experimental-enabled",
  decide: async () => {
    const session = await getSession();
    return isNewChatExperimentalAllowedEmail(session?.user?.email);
  },
});
