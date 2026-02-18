import { agentRepository } from "@sokosumi/database/repositories";
import { Metadata } from "next";
import { notFound } from "next/navigation";

import prisma from "@/lib/db/prisma";
import { getAgentDescription, getAgentName } from "@/lib/helpers/agent";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agentId: string }>;
}): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await agentRepository.getAgentWithRelationsById(
    agentId,
    prisma,
  );
  if (!agent) {
    notFound();
  }

  return {
    title: getAgentName(agent),
    description: getAgentDescription(agent),
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
      className="flex min-h-[calc(100svh-64px)] flex-1 flex-col pt-20 md:pt-0"
    >
      {children}
    </div>
  );
}
