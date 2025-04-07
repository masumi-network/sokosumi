import { notFound } from "next/navigation";

import { AgentDetails } from "@/components/agents";
import { getAgentById, getAgents } from "@/lib/db/services/agent.service";
import { calculateAgentHumandReadableCreditCost } from "@/lib/db/services/credit.service";

import BackToGallery from "./components/back-to-gallery";

// Next.js will invalidate the cache when a
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

export default async function Page({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const agent = await getAgentById(agentId);

  if (!agent) {
    notFound();
  }

  const agentPrice = await calculateAgentHumandReadableCreditCost(agent);

  return (
    <div className="container mx-auto space-y-8 p-4 pb-16 xl:p-8">
      <BackToGallery />
      <AgentDetails agent={agent} agentPrice={agentPrice} />
    </div>
  );
}
