import "server-only";

import { flag } from "flags/next";

import { getSession } from "@/lib/auth/utils";
import { getEmailDomain } from "@/lib/utils/email";

const CHAT_DOMAIN = "nmkr.io";
const CHAT_EMAIL_ALLOWLIST = new Set(["s.kuepers@house-of-communication.com"]);

function isTaskRailDomain(email: string): boolean {
  const domain = getEmailDomain(email);
  return domain !== null && domain === CHAT_DOMAIN;
}

function isTaskRailAllowlisted(email: string): boolean {
  return CHAT_EMAIL_ALLOWLIST.has(email.toLowerCase());
}

export const taskRailEnabled = flag({
  key: "task-rail-enabled",
  decide: async () => {
    const session = await getSession();
    if (!session?.user?.email) {
      return false;
    }

    const email = session.user.email;
    return isTaskRailDomain(email) || isTaskRailAllowlisted(email);
  },
});

export async function getDefaultAppPath(): Promise<"/tasks" | "/chat"> {
  return (await taskRailEnabled()) ? "/tasks" : "/chat";
}
