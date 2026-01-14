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
  return children;
}
