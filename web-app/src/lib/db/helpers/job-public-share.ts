import { getEnvPublicConfig } from "@/config/env.public";
import { JobPublicShare } from "@/prisma/generated/client";

export function getJobPublicShareUrl(publicShare: JobPublicShare): string {
  return `${getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL}/share/jobs/${publicShare.token}`;
}
