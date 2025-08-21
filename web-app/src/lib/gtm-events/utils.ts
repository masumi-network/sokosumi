import { sendGTMEvent } from "@next/third-parties/google";

import { getEnvPublicConfig } from "@/config/env.public";

import { GTMEvent } from "./types";

export function fireEvent(event: GTMEvent) {
  if (typeof window !== "undefined") {
    sendGTMEvent(event);
  }
}

/**
 * After Agent Hired Call the api webhook with user's email.
 * @param email - The email of the user.
 */
export async function afterAgentHiredWebHook(email: string): Promise<boolean> {
  const res = await fetch(
    getEnvPublicConfig().NEXT_PUBLIC_AFTER_AGENT_HIRED_WEB_HOOK,
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
  );
  return res.ok;
}
