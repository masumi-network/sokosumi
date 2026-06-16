import type { JobShare } from "@sokosumi/utils";

import { getEnvPublicConfig } from "@/config/env.public";

export function getJobShareUrl(share: JobShare): string | null {
  if (!share.token) return null;
  return `${getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL}/share/${share.token}`;
}
