import { getEnvPublicConfig } from "@/config/env.public";
import { JobShare } from "@/prisma/generated/client";

export function getJobShareUrl(jobShare: JobShare): string {
  return `${getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL}/share/jobs/${jobShare.token}`;
}
