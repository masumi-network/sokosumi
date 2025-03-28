// Next.js will invalidate the cache when a

import { Loader2 } from "lucide-react";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { getAgentById, getAgents } from "@/lib/db/services/agent.service";

import Footer from "./components/footer";
import Header, { HeaderSkeleton } from "./components/header";
import { JobTable } from "./components/job-table";

// request comes in, at most once every 1 hour (3600 seconds).
export const revalidate = 3600;

// We'll prerender only the params from `generateStaticParams` at build time.
// If a request comes in for a path that hasn't been generated,
// Next.js will server-render the page on-demand.
export const dynamicParams = true; // or false, to 404 on unknown paths

interface JobLayoutParams {
  agentId: string;
}

export async function generateStaticParams() {
  const agents = await getAgents();
  return agents.map((agent) => ({
    agentId: String(agent.id),
  }));
}

// generateMetadata is streamed by default

export async function generateMetadata({
  params,
}: {
  params: Promise<JobLayoutParams>;
}): Promise<Metadata> {
  const { agentId } = await params;
  let agent: AgentDTO | undefined = undefined;
  try {
    agent = await getAgentById(agentId);
  } catch {
    notFound();
  }

  return {
    title: agent?.name ?? "",
    description: agent?.description ?? "",
  };
}

export default async function JobLayout({
  params,
  children,
}: {
  params: Promise<JobLayoutParams>;
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<JoLayoutSkeleton />}>
      <JobInnerLayout params={params}>{children}</JobInnerLayout>
    </Suspense>
  );
}

async function JobInnerLayout({
  params,
  children,
}: {
  params: Promise<JobLayoutParams>;
  children: React.ReactNode;
}) {
  const { agentId } = await params;
  let agent: AgentDTO;
  try {
    agent = await getAgentById(agentId);
  } catch {
    return null;
  }

  return (
    <div className="flex h-full flex-1 flex-col p-4 lg:p-6 xl:p-8">
      <Header agent={agent} />
      <div className="mt-6 flex flex-1 flex-col justify-center gap-4 lg:flex-row lg:overflow-hidden">
        <JobTable />
        {children}
      </div>
      <Footer legal={agent.legal} />
    </div>
  );
}

function JoLayoutSkeleton() {
  return (
    <div className="flex flex-1 flex-col p-4 xl:p-8">
      <HeaderSkeleton />
      <div className="mt-6 flex flex-1 justify-center py-12">
        <Loader2 className="mr-2 h-8 w-8 animate-spin" />
      </div>
    </div>
  );
}
