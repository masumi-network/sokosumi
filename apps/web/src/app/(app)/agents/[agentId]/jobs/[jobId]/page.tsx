import { permanentRedirect } from "next/navigation";

import { buildJobHref } from "@/lib/utils/job-href";

interface NestedJobDetailPageParams {
  agentId: string;
  jobId: string;
}

/** Legacy nested Job URL — permanent redirect to canonical `/jobs/{jobId}`. */
export default async function NestedJobDetailRedirectPage({
  params,
}: {
  params: Promise<NestedJobDetailPageParams>;
}) {
  const { jobId } = await params;
  permanentRedirect(buildJobHref(jobId));
}
