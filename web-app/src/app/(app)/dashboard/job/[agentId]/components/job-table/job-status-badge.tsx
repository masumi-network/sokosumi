import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

import { JobStatus } from "./schema";

export default function JobStatusBadge({ status }: { status: JobStatus }) {
  const t = useTranslations("App.Job.JobTable.JobStatusBadge");

  if (status == "Completed")
    return (
      <Badge variant="default" className="bg-green-700 text-white">
        {t("completed")}
      </Badge>
    );

  if (status == "Failed")
    return <Badge variant="destructive">{t("failed")}</Badge>;

  if (status == "Pending")
    return (
      <Badge variant="default" className="bg-yellow-700 text-white">
        {t("pending")}
      </Badge>
    );

  if (status == "Cancelled")
    return <Badge variant="outline">{t("cancelled")}</Badge>;
}
