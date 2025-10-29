import { getEnvPublicConfig } from "@/config/env.public";
import { JobShare } from "@/prisma/generated/client";

export function getJobShareUrl(share: JobShare): string | null {
  if (!share.token) return null;
  return `${getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL}/share/jobs/${share.token}`;
}
