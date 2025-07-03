import { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAgentDescription, getAgentName } from "@/lib/db";
import { retrieveAgentWithRelationsById } from "@/lib/db/repositories";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agentId: string }>;
}): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await retrieveAgentWithRelationsById(agentId);
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
