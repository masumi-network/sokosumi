import { permanentRedirect } from "next/navigation";

import { buildJobHref } from "@/lib/utils/job-href";

interface NestedJobModalPageParams {
  agentId: string;
  jobId: string;
}

/** Legacy nested Job modal slot — permanent redirect to canonical `/jobs/{jobId}`. */
export default async function NestedJobModalRedirectPage({
  params,
}: {
  params: Promise<NestedJobModalPageParams>;
}) {
  const { jobId } = await params;
  permanentRedirect(buildJobHref(jobId));
}
