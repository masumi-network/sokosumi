import { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import DefaultLoading from "@/components/default-loading";
import { requireAuthentication } from "@/lib/auth/utils";
import {
  getAgentById,
  getAgentDescription,
  getAgentLegal,
  getAgentName,
  getJobsByAgentId,
} from "@/lib/db";
import {
  getAgentCreditsPrice,
  getOrCreateFavoriteAgentList,
} from "@/lib/services";

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
    title: getAgentName(agent),
    description: getAgentDescription(agent),
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
  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  const favoriteAgentList = await getOrCreateFavoriteAgentList(session.user.id);
  const jobs = await getJobsByAgentId(agentId);

  return (
    <div className="flex h-full flex-col p-4 lg:h-[calc(100svh-64px)] lg:p-6 xl:p-8">
      <Header
        agent={agent}
        agentCreditsPrice={agentCreditsPrice}
        favoriteAgentList={favoriteAgentList}
        jobs={jobs}
      />
      <div className="mt-6 flex flex-1 flex-col justify-center gap-4 lg:flex-row lg:overflow-hidden">
        {children}
        {right}
      </div>
      <Footer legal={getAgentLegal(agent)} />
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
