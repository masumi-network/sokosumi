import { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import DefaultLoading from "@/components/default-loading";
import { requireAuthentication } from "@/lib/auth/utils";
import { getDescription, getLegal, getName } from "@/lib/db/extension/agent";
import { getAgentById } from "@/lib/db/services/agent.service";
import { getOrCreateFavoriteAgentList } from "@/lib/db/services/agentList.service";
import { calculateAgentHumandReadableCreditCost } from "@/lib/db/services/credit.service";

import Footer from "./components/footer";
import Header, { HeaderSkeleton } from "./components/header";

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
    title: getName(agent),
    description: getDescription(agent),
  };
}

interface JobLayoutProps {
  children: React.ReactNode;
  right: React.ReactNode;
  params: Promise<{ agentId: string }>;
}

export default async function JobLayout({
  children,
  right,
  params,
}: JobLayoutProps) {
  return (
    <Suspense fallback={<JobLayoutSkeleton />}>
      <JobLayoutInner right={right} params={params}>
        {children}
      </JobLayoutInner>
    </Suspense>
  );
}

async function JobLayoutInner({ right, params, children }: JobLayoutProps) {
  const { agentId } = await params;
  const agent = await getAgentById(agentId);
  if (!agent) {
    console.warn("agent not found in job layout");
    return notFound();
  }

  const { session } = await requireAuthentication();
  const agentPrice = await calculateAgentHumandReadableCreditCost(agent);
  const favoriteAgentList = await getOrCreateFavoriteAgentList(session.user.id);

  return (
    <div className="flex h-full flex-1 flex-col p-4 lg:p-6 xl:p-8">
      <Header
        agent={agent}
        agentPricing={agentPrice}
        favoriteAgentList={favoriteAgentList}
      />
      <div className="mt-6 flex flex-1 flex-col justify-center gap-4 lg:flex-row lg:overflow-hidden">
        {children}
        {right}
      </div>
      <Footer legal={getLegal(agent)} />
    </div>
  );
}

function JobLayoutSkeleton() {
  return (
    <div className="flex flex-1 flex-col p-4 xl:p-8">
      <HeaderSkeleton />
      <div className="mt-6 flex flex-1 justify-center py-12">
        <DefaultLoading />
      </div>
    </div>
  );
}
