import "server-only";

import { flag } from "flags/next";

import { getSession } from "@/lib/auth/utils";
import { getEmailDomain } from "@/lib/utils/email";

const TASK_MANAGER_DOMAIN = "nmkr.io";
const TASK_MANAGER_EMAIL_ALLOWLIST = new Set([
  "s.kuepers@house-of-communication.com",
]);

function isTaskManagerDomain(email: string): boolean {
  return getEmailDomain(email) === TASK_MANAGER_DOMAIN;
}

function isTaskManagerEmailAllowlisted(email: string): boolean {
  return TASK_MANAGER_EMAIL_ALLOWLIST.has(email.toLowerCase());
}

export const taskManagerMenuEnabled = flag({
  key: "task-manager-menu",
  decide: async () => {
    const session = await getSession();
    if (!session?.user?.email) {
      return false;
    }
    const email = session.user.email;
    return isTaskManagerDomain(email) || isTaskManagerEmailAllowlisted(email);
  },
});
