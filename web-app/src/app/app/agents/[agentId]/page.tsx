import { notFound } from "next/navigation";

import { AgentDetails } from "@/components/agents";
import { requireAuthentication } from "@/lib/auth/utils";
import { getAgentById, getAgents } from "@/lib/db/services/agent.service";
import { getOrCreateFavoriteAgentList } from "@/lib/db/services/agentList.service";
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
  const { session } = await requireAuthentication();
  const agentList = await getOrCreateFavoriteAgentList(session.user.id);
  const agentPrice = await calculateAgentHumandReadableCreditCost(agent);
  return (
    <div className="w-full space-y-8 px-4 py-4 sm:px-8 xl:px-16">
      <BackToGallery />
      <AgentDetails
        agent={agent}
        agentList={agentList}
        agentPrice={agentPrice}
      />
    </div>
  );
}
