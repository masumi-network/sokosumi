import "server-only";

import { flag } from "flags/next";

import { getSession } from "@/lib/auth/utils";
import { getEmailDomain } from "@/lib/utils/email";

const TASK_MANAGER_DOMAIN = "nmkr.io";

function isTaskManagerDomain(email: string): boolean {
  return getEmailDomain(email) === TASK_MANAGER_DOMAIN;
}

export const taskManagerMenuEnabled = flag({
  key: "task-manager-menu",
  decide: async () => {
    const session = await getSession();
    if (!session?.user?.email) {
      return false;
    }
    return isTaskManagerDomain(session.user.email);
  },
});
