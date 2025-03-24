// Next.js will invalidate the cache when a

import { notFound } from "next/navigation";

import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { getAgentById, getAgents } from "@/lib/db/services/agent.service";

// request comes in, at most once every 1 hour (3600 seconds).
export const revalidate = 3600;

// We'll prerender only the params from `generateStaticParams` at build time.
// If a request comes in for a path that hasn't been generated,
// Next.js will server-render the page on-demand.
export const dynamicParams = true; // or false, to 404 on unknown paths

export async function generateStaticParams() {
  const agents = await getAgents();
  return agents.map((agent) => ({
    agentId: String(agent.id),
  }));
}

export default async function JobLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  let agent: AgentDTO;
  try {
    agent = await getAgentById(agentId);
  } catch {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col p-4 lg:p-8">
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
