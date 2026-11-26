import type { Metadata } from "next";

import { AgentLoadingStatusRegion } from "@/app/agents/[agentId]/jobs/components/jobs-loading-status";
import { getCoreAgentById } from "@/lib/agents/core-loaders";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agentId: string }>;
}): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getCoreAgentById(agentId);

  return {
    title: agent?.name ?? agentId,
    description: agent?.description ?? undefined,
  };
}

export default function AgentDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The loading announcement stands here, above the jobs layout, so it is
  // already in the page when Your jobs starts loading from the profile.
  return (
    <>
      {children}
      <AgentLoadingStatusRegion />
    </>
  );
}
