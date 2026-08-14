import { permanentRedirect } from "next/navigation";

import { buildJobHref } from "@/lib/utils/job-href";

interface NestedJobRightPageParams {
  agentId: string;
  jobId: string;
}

/** Legacy nested Job right slot — permanent redirect to canonical `/jobs/{jobId}`. */
export default async function NestedJobRightRedirectPage({
  params,
}: {
  params: Promise<NestedJobRightPageParams>;
}) {
  const { jobId } = await params;
  permanentRedirect(buildJobHref(jobId));
}
