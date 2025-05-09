import { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAgentById, getAgentDescription, getAgentName } from "@/lib/db";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agentId: string }>;
}): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getAgentById(agentId);
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
    <div className="mx-auto flex max-w-5xl justify-center px-4 py-8">
      {children}
    </div>
  );
}
