import { getTranslations } from "next-intl/server";

import { requireAuthentication } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { sleep } from "@/lib/utils";

import JobsTable from "./components/jobs-table";

// We'll prerender only at build time, refresh every 1 hour
export const revalidate = 3600;

// Fetch all jobs for the current user
async function getUserJobs(userId: string) {
  const jobs = await prisma.job.findMany({
    where: {
      userId,
    },
    include: {
      agent: true,
      user: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return jobs;
}

export default async function Jobs() {
  await sleep(1000);
  const t = await getTranslations("App.Jobs");
  const { session } = await requireAuthentication();
  const jobs = await getUserJobs(session.user.id);

  return (
    <div className="flex flex-col items-start gap-6 p-8 sm:p-20">
      <h1 className="text-3xl font-bold">{t("title")}</h1>

      <JobsTable jobs={jobs} />
    </div>
  );
}
