import { getEnvPublicConfig } from "@/config/env.public";
import type { JobShare } from "@/lib/types/core-dto";

export function getJobShareUrl(share: JobShare): string | null {
  if (!share.token) return null;
  return `${getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL}/share/${share.token}`;
}
