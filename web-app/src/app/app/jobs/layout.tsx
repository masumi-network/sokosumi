import { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { requireAuthentication } from "@/lib/auth/utils";
import { getAgents } from "@/lib/db/services/agent.service";
import { getJobs } from "@/lib/db/services/job.service";

import JobsTable from "./@right/components/jobs-table";

export async function generateStaticParams() {
  const agents = await getAgents();
  return agents.map((agent) => ({
    agentId: String(agent.id),
  }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Jobs");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function JobLayout({
  right,
}: {
  children: React.ReactNode;
  right: React.ReactNode;
}) {
  const { session } = await requireAuthentication();

  const headerList = await headers();
  const pathname = headerList.get("x-current-path");
  const pathnameArray = pathname?.split("/");
  let currentIds: string[] | undefined = undefined;
  if (pathnameArray?.length === 4) {
    currentIds = [pathnameArray[3]];
  }
  const jobs = await getJobs(session.user.id);

  return (
    <div className="flex h-full flex-1 flex-col p-4 lg:p-6 xl:p-8">
      <div className="mt-6 flex flex-1 flex-col justify-center gap-4 lg:flex-row lg:overflow-hidden">
        <JobsTable jobs={jobs} highlightedJobIds={currentIds} />
        {right}
      </div>
    </div>
  );
}
