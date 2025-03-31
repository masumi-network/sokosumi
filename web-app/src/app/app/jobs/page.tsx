import { getTranslations } from "next-intl/server";

import { requireAuthentication } from "@/lib/auth/utils";
import { getJobs } from "@/lib/db/services/job.service";

import JobsTable from "./components/jobs-table";

export default async function Jobs() {
  const t = await getTranslations("App.Jobs");
  const { session } = await requireAuthentication();
  const jobs = await getJobs(session.user.id);

  return (
    <div className="flex flex-col items-start gap-6 p-8 sm:p-20">
      <h1 className="text-3xl font-bold">{t("title")}</h1>

      <JobsTable jobs={jobs} />
    </div>
  );
}
