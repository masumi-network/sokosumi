import type { Metadata } from "next";

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
  return (
    <div
      data-agent-fullbleed
      className="flex min-h-[calc(100svh-4rem)] flex-1 flex-col pt-20 md:pt-0"
    >
      {children}
    </div>
  );
}
