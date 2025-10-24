import { getEnvPublicConfig } from "@/config/env.public";
import { JobShare } from "@/prisma/generated/client";

export function getJobShareUrl(share: JobShare): string {
  return `${getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL}/share/jobs/${share.token}`;
}
